import {
  createPublicClient,
  http,
  encodeFunctionData,
  formatEther,
  type PrivateKeyAccount,
} from "viem";
import { CONFIG } from "../config";
import { canvasAbi } from "./abi";

export interface PainterState {
  address: `0x${string}`;
  balanceWei: bigint;
  /** Cuántos píxeles más se pueden pintar con el saldo actual. */
  paintsLeft: number;
  ready: boolean;
  lastError?: string;
}

/**
 * Envía las transacciones de pintado.
 *
 * El objetivo de todo este módulo es que pintar un píxel cueste **UNA sola
 * llamada RPC**. Un `sendTransaction` normal haría cuatro:
 *
 *   eth_estimateGas + eth_getTransactionCount + eth_feeHistory + eth_send…
 *
 * Con 100 personas pintando, eso son 4x más peticiones contra un RPC que
 * aguanta 15-25 por segundo. Así que:
 *
 *   · el gas va fijo (medido con forge, ver CONFIG.paintGas)
 *   · el nonce se lleva en local y se incrementa de forma optimista
 *   · las fees se refrescan en segundo plano cada 3s, no por transacción
 *   · la firma es 100% local (`account.signTransaction`, cero RPC)
 *
 * Queda una única llamada: `eth_sendRawTransaction`.
 */
export class Painter {
  private readonly client;
  private nonce = 0;
  private maxFeePerGas = 0n;
  private maxPriorityFeePerGas = 0n;
  private balanceWei = 0n;
  private ready = false;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly account: PrivateKeyAccount,
    private readonly onState: (state: PainterState) => void,
  ) {
    this.client = createPublicClient({
      chain: CONFIG.chain,
      transport: http(CONFIG.rpcUrl),
    });
  }

  get address(): `0x${string}` {
    return this.account.address;
  }

  async init(): Promise<void> {
    await Promise.all([this.resyncNonce(), this.refreshFees(), this.refreshBalance()]);

    // `refreshFees` se come sus errores, así que podríamos llegar aquí con
    // fees a cero y marcarnos listos: cada pintada fallaría con un error
    // confuso. Mejor reintentar hasta tenerlas.
    for (let attempt = 0; attempt < 5 && !this.hasFees(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      await this.refreshFees();
    }
    if (!this.hasFees()) {
      this.emit("No se pudieron obtener las fees del RPC. ¿Está bien VITE_RPC_URL?");
      return;
    }

    this.ready = true;
    this.emit();

    this.timers.push(setInterval(() => void this.refreshFees(), CONFIG.feeRefreshMs));
    // El saldo cambia despacio; no hace falta mirarlo seguido.
    this.timers.push(setInterval(() => void this.refreshBalance(), 15_000));
  }

  dispose(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  /**
   * Pinta un píxel. Devuelve el hash en cuanto el RPC lo acepta.
   *
   * No esperamos confirmación: la UI ya pintó el píxel de forma optimista y el
   * relay avisará cuando el evento llegue. Esperar aquí bloquearía el dedo del
   * usuario durante 600 ms por píxel.
   */
  async paint(idx: number, color: number): Promise<`0x${string}`> {
    if (!this.ready) throw new Error("El painter aún no está listo");

    const data = encodeFunctionData({
      abi: canvasAbi,
      functionName: "paint",
      args: [idx, color],
    });

    // Se reserva el nonce ANTES de firmar (operación sincrónica), así dos
    // toques rápidos no se pelean por el mismo número.
    const nonce = this.nonce++;

    try {
      const serializedTransaction = await this.account.signTransaction({
        to: CONFIG.canvasAddress,
        data,
        chainId: CONFIG.chain.id,
        nonce,
        gas: CONFIG.paintGas,
        maxFeePerGas: this.maxFeePerGas,
        maxPriorityFeePerGas: this.maxPriorityFeePerGas,
        value: 0n,
        type: "eip1559",
      });

      // La única llamada RPC del camino caliente.
      const hash = await this.client.sendRawTransaction({ serializedTransaction });

      // Descontamos el coste estimado sin consultar el saldo: en Monad se cobra
      // el gas limit, así que sabemos exactamente cuánto cuesta.
      this.balanceWei -= CONFIG.paintGas * this.maxFeePerGas;
      this.emit();
      return hash;
    } catch (error) {
      // Cualquier envío fallido deja un HUECO en la secuencia de nonces: ya
      // habíamos reservado el número y nadie lo va a usar. Las transacciones
      // siguientes quedarían con nonce futuro y se rechazarían en cascada.
      //
      // Antes solo resincronizábamos si el mensaje mencionaba "nonce", pero el
      // mensaje depende del nodo y es poco fiable. Resincronizar siempre cuesta
      // una llamada RPC solo en el camino de error, que es raro.
      await this.resyncNonce().catch(() => {});

      this.emit(describeError(error));
      throw error;
    }
  }

  private async resyncNonce(): Promise<void> {
    this.nonce = await this.client.getTransactionCount({
      address: this.account.address,
      blockTag: "pending",
    });
  }

  /**
   * Refresca las fees con MUCHO margen en el techo.
   *
   * Esto arregla un rechazo intermitente. viem calcula
   * `maxFeePerGas = baseFee * 1.2`, y nosotros cacheamos las fees 3 segundos
   * para no gastar una llamada RPC por píxel. Pero el controlador de base fee
   * de Monad sube hasta ~3,6% por bloque, y 3 segundos son ~10 bloques: el base
   * fee puede subir hasta 1,42x entre refresco y envío. Con un techo de solo
   * 1,2x, la transacción se rechaza por fee insuficiente de forma aleatoria.
   *
   * Subir el techo es GRATIS: en EIP-1559 pagas `base + priority`, y
   * `maxFeePerGas` es solo un límite superior. Esto NO es como el gas limit,
   * que en Monad se cobra entero.
   *
   * El único coste real es de Reserve Balance: consenso presupuesta las tx en
   * vuelo como `gas_bid * gas_limit`, así que un techo más alto reduce cuántas
   * puedes tener volando a la vez. Con 2x y 2 MON de saldo caben ~86 en vuelo,
   * muy por encima de lo que un dedo humano puede generar.
   */
  private async refreshFees(): Promise<void> {
    try {
      const fees = await this.client.estimateFeesPerGas();
      const tip = fees.maxPriorityFeePerGas;
      // Reconstruimos el base fee a partir de lo que devuelve viem y le damos
      // el doble de techo, que cubre de sobra 3 segundos de subida máxima.
      const base = fees.maxFeePerGas - tip;
      this.maxPriorityFeePerGas = tip;
      this.maxFeePerGas = base * 2n + tip;
    } catch {
      // Nos quedamos con las últimas conocidas; no vale la pena molestar al
      // usuario por un fallo puntual al refrescar fees.
    }
  }

  /** ¿Tenemos fees válidas? Firmar con maxFeePerGas = 0 produce un rechazo
   *  ("Transaction fee too low") que parece un bug del usuario y no lo es. */
  private hasFees(): boolean {
    return this.maxFeePerGas > 0n;
  }

  private async refreshBalance(): Promise<void> {
    try {
      this.balanceWei = await this.client.getBalance({
        address: this.account.address,
      });
      this.emit();
    } catch {
      /* idem */
    }
  }

  private emit(lastError?: string): void {
    const costPerPaint = CONFIG.paintGas * this.maxFeePerGas;
    this.onState({
      address: this.account.address,
      balanceWei: this.balanceWei,
      paintsLeft:
        costPerPaint > 0n ? Number(this.balanceWei / costPerPaint) : 0,
      ready: this.ready,
      ...(lastError !== undefined ? { lastError } : {}),
    });
  }
}

export const formatMon = (wei: bigint): string =>
  Number(formatEther(wei)).toFixed(3);

/**
 * Saca el mensaje ÚTIL de un error de viem.
 *
 * `error.message` de viem trae su texto genérico más la URL y el cuerpo entero
 * de la petición, que llena la pantalla y no dice nada. Peor: viem usa el mismo
 * texto ("Missing or invalid parameters") para los códigos -32602 y -32000, y
 * el -32000 es el genérico que los nodos devuelven para cualquier rechazo de
 * transacción. El motivo real viene en `details`.
 */
function describeError(error: unknown): string {
  const err = error as {
    details?: string;
    shortMessage?: string;
    message?: string;
    cause?: { message?: string; details?: string };
  };
  const detail =
    err.details ?? err.cause?.details ?? err.cause?.message ?? undefined;
  const summary = err.shortMessage ?? err.message ?? String(error);
  const text = detail ? `${detail}` : summary;
  return text.split("\n")[0]!.slice(0, 160);
}

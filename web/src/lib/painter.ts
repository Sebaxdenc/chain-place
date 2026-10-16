import {
  createPublicClient,
  http,
  encodeFunctionData,
  formatEther,
  type PrivateKeyAccount,
} from "viem";
import { CONFIG } from "../config";
import { canvasAbi } from "./abi";
import type { PaintSender, SenderState } from "./sender";

/**
 * Firma con una clave que vive en el navegador.
 *
 * El objetivo de este módulo es que pintar un píxel cueste **UNA sola llamada
 * RPC**. Un `sendTransaction` normal haría cuatro:
 *
 *   eth_estimateGas + eth_getTransactionCount + eth_feeHistory + eth_send…
 *
 * Con 50 personas pintando, eso es 4x más peticiones contra un RPC. Así que:
 *
 *   · el gas va fijo (medido con forge, ver CONFIG.paintGas)
 *   · el nonce se lleva en local y se incrementa de forma optimista
 *   · las fees se refrescan en segundo plano, no por transacción
 *   · la firma es 100% local (`account.signTransaction`, cero RPC)
 *
 * Queda una única llamada: `eth_sendRawTransaction`.
 *
 * Lo usan el modo "app" (clave del navegador) y el modo "sesión" (misma clave,
 * pero fondeada desde la wallet del usuario).
 */
export class LocalPainter implements PaintSender {
  private readonly client;
  private nonce = 0;
  private maxFeePerGas = 0n;
  private maxPriorityFeePerGas = 0n;
  private balanceWei = 0n;
  private ready = false;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly account: PrivateKeyAccount,
    private readonly onState: (state: SenderState) => void,
    /** Wallet real del usuario en modo sesión. Solo informativo. */
    private readonly walletAddress: `0x${string}` | null = null,
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
    await Promise.all([
      this.resyncNonce(),
      this.refreshFees(),
      this.refreshBalance(),
    ]);

    // `refreshFees` se come sus errores, así que podríamos llegar aquí con
    // fees a cero y marcarnos listos: cada pintada fallaría con un error
    // confuso. Mejor reintentar hasta tenerlas.
    for (let attempt = 0; attempt < 5 && this.maxFeePerGas === 0n; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      await this.refreshFees();
    }
    if (this.maxFeePerGas === 0n) {
      this.emit("No se pudieron obtener las fees del RPC. ¿Está bien VITE_RPC_URL?");
      return;
    }

    this.ready = true;
    this.emit();

    this.timers.push(
      setInterval(() => void this.refreshFees(), CONFIG.feeRefreshMs),
    );
    // El saldo cambia despacio; no hace falta mirarlo seguido.
    this.timers.push(setInterval(() => void this.refreshBalance(), 15_000));
  }

  dispose(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  /** Relee saldo y nonce ya. Se usa después de fondear la sesión: esperar los
   *  15 segundos del intervalo haría parecer que el fondeo no funcionó. */
  async refresh(): Promise<void> {
    await Promise.all([this.refreshBalance(), this.resyncNonce()]);
    this.emit();
  }

  /**
   * Devuelve el saldo restante a la wallet del usuario.
   *
   * Hay una trampa de Monad aquí. El mecanismo de Reserve Balance normalmente
   * impide que una cuenta baje de 10 MON, lo que haría imposible vaciar una
   * burner con 2 MON. La excepción es la "transacción que vacía la cuenta",
   * que SÍ puede bajar del reserve, pero solo si se cumplen dos condiciones:
   *
   *   · la cuenta no está delegada por EIP-7702 (la nuestra no lo está), y
   *   · no hay OTRA transacción del mismo remitente en los k=3 bloques
   *     previos (~1,2 segundos)
   *
   * Por eso esto puede fallar si se pulsa justo después de pintar: habría
   * pintadas en vuelo. El error se muestra y basta reintentar un segundo
   * después.
   *
   * Mandamos `balance - gas_limit * gas_bid`. Como el techo de fee lleva 2x de
   * margen sobre el base fee, en la práctica queda un poco de polvo sin
   * recuperar, lo cual es preferible a que la transacción no entre.
   */
  async sweepTo(to: `0x${string}`): Promise<`0x${string}`> {
    await this.refreshBalance();

    const gasReserved = 21_000n * this.maxFeePerGas;
    if (this.balanceWei <= gasReserved) {
      throw new Error("El saldo no alcanza ni para el gas del envío");
    }

    const value = this.balanceWei - gasReserved;
    const nonce = await this.client.getTransactionCount({
      address: this.account.address,
      blockTag: "pending",
    });

    const serializedTransaction = await this.account.signTransaction({
      to,
      value,
      chainId: CONFIG.chain.id,
      nonce,
      // 21.000 es el coste exacto de una transferencia nativa.
      gas: 21_000n,
      maxFeePerGas: this.maxFeePerGas,
      maxPriorityFeePerGas: this.maxPriorityFeePerGas,
      type: "eip1559",
    });

    const hash = await this.client.sendRawTransaction({ serializedTransaction });
    this.nonce = nonce + 1;
    return hash;
  }

  /**
   * Pinta un píxel. Devuelve el hash en cuanto el RPC lo acepta.
   *
   * No esperamos confirmación: la UI ya pintó el píxel de forma optimista y el
   * relay avisará cuando el evento llegue. Esperar aquí bloquearía el dedo del
   * usuario durante 600 ms por píxel.
   */
  async paint(idx: number, color: number): Promise<`0x${string}`> {
    if (!this.ready) throw new Error("El firmante aún no está listo");

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

      // Descontamos el coste sin consultar el saldo: en Monad se cobra el gas
      // limit, así que sabemos exactamente cuánto cuesta.
      this.balanceWei -= CONFIG.paintGas * this.maxFeePerGas;
      this.emit();
      return hash;
    } catch (error) {
      // Cualquier envío fallido deja un HUECO en la secuencia de nonces: ya
      // habíamos reservado el número y nadie lo va a usar. Las transacciones
      // siguientes quedarían con nonce futuro y se rechazarían en cascada.
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
   * viem calcula `maxFeePerGas = baseFee * 1.2`, y nosotros cacheamos las fees
   * unos segundos para no gastar una llamada RPC por píxel. Pero el controlador
   * de base fee de Monad sube hasta ~3,6% por bloque, y 3 segundos son ~10
   * bloques: el base fee puede subir hasta 1,42x entre refresco y envío. Con un
   * techo de 1,2x, la transacción se rechaza de forma aleatoria.
   *
   * Subir el techo es GRATIS: en EIP-1559 pagas `base + priority`, y
   * `maxFeePerGas` es solo un límite superior. Esto NO es como el gas limit,
   * que en Monad se cobra entero.
   */
  private async refreshFees(): Promise<void> {
    try {
      const fees = await this.client.estimateFeesPerGas();
      const tip = fees.maxPriorityFeePerGas;
      const base = fees.maxFeePerGas - tip;
      this.maxPriorityFeePerGas = tip;
      this.maxFeePerGas = base * 2n + tip;
    } catch {
      /* nos quedamos con las últimas conocidas */
    }
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
    const paintsLeft =
      costPerPaint > 0n ? Number(this.balanceWei / costPerPaint) : 0;

    this.onState({
      address: this.account.address,
      walletAddress: this.walletAddress,
      balanceWei: this.balanceWei,
      paintsLeft,
      ready: this.ready,
      blocked: this.ready && paintsLeft === 0 ? "sin-fondos" : null,
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
export function describeError(error: unknown): string {
  const err = error as {
    details?: string;
    shortMessage?: string;
    message?: string;
    code?: number;
    cause?: { message?: string; details?: string };
  };

  // 4001 es el código EIP-1193 de "el usuario canceló". No es un fallo.
  if (err.code === 4001) return "Cancelaste la transacción";

  const detail = err.details ?? err.cause?.details ?? err.cause?.message;
  const text = detail ?? err.shortMessage ?? err.message ?? String(error);
  return text.split("\n")[0]!.slice(0, 160);
}

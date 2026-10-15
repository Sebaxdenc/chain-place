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
      const message = (error as Error).message ?? String(error);

      // Si el nonce se desincronizó (tx rechazada, otra pestaña abierta,
      // reinicio del RPC), lo volvemos a leer de la cadena.
      if (/nonce|already known|replacement/i.test(message)) {
        await this.resyncNonce();
      }
      this.emit(message.slice(0, 140));
      throw error;
    }
  }

  private async resyncNonce(): Promise<void> {
    this.nonce = await this.client.getTransactionCount({
      address: this.account.address,
      blockTag: "pending",
    });
  }

  private async refreshFees(): Promise<void> {
    try {
      const fees = await this.client.estimateFeesPerGas();
      this.maxFeePerGas = fees.maxFeePerGas;
      this.maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
    } catch {
      // Nos quedamos con las últimas conocidas; no vale la pena molestar al
      // usuario por un fallo puntual al refrescar fees.
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

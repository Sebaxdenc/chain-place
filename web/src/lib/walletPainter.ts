import { createPublicClient, http, encodeFunctionData, numberToHex } from "viem";
import { CONFIG } from "../config";
import { canvasAbi } from "./abi";
import { getInjected, ensureMonadChain } from "./injected";
import { describeError } from "./painter";
import type { PaintSender, SenderState } from "./sender";

/**
 * Delega la firma a la wallet del usuario (MetaMask y similares).
 *
 * Esto significa **una ventana emergente POR PÍXEL**. Es lento para dibujar,
 * y a propósito no lo escondemos: el modo existe porque hay una cosa que los
 * otros dos no dan — que la transacción salga de la dirección real del
 * usuario, verificable en el explorador. Para un jurado, eso vale más que la
 * comodidad.
 *
 * Aquí no gestionamos nonce ni fees: de eso se encarga la wallet. Sí fijamos
 * el gas limit, porque en Monad se cobra el límite y no el gas usado, así que
 * dejar que la wallet ponga un margen grande se lo cobraría al usuario.
 */
export class WalletPainter implements PaintSender {
  private readonly client;
  private balanceWei = 0n;
  private ready = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly walletAddress: `0x${string}`,
    private readonly onState: (state: SenderState) => void,
  ) {
    this.client = createPublicClient({
      chain: CONFIG.chain,
      transport: http(CONFIG.rpcUrl),
    });
  }

  async init(): Promise<void> {
    const provider = getInjected();
    if (!provider) {
      this.emit("No se detectó ninguna wallet en el navegador");
      return;
    }
    await ensureMonadChain(provider);
    await this.refreshBalance();
    this.ready = true;
    this.emit();
    this.timer = setInterval(() => void this.refreshBalance(), 15_000);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async paint(idx: number, color: number): Promise<`0x${string}`> {
    const provider = getInjected();
    if (!provider) throw new Error("No se detectó ninguna wallet");

    const data = encodeFunctionData({
      abi: canvasAbi,
      functionName: "paint",
      args: [idx, color],
    });

    try {
      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: this.walletAddress,
            to: CONFIG.canvasAddress,
            data,
            gas: numberToHex(CONFIG.paintGas),
          },
        ],
      })) as `0x${string}`;

      // El saldo lo refresca el intervalo; aquí no lo estimamos porque las
      // fees las decide la wallet y no las conocemos.
      return hash;
    } catch (error) {
      this.emit(describeError(error));
      throw error;
    }
  }

  private async refreshBalance(): Promise<void> {
    try {
      this.balanceWei = await this.client.getBalance({
        address: this.walletAddress,
      });
      this.emit();
    } catch {
      /* ignoramos fallos puntuales al refrescar */
    }
  }

  private emit(lastError?: string): void {
    // Estimación con el base fee mínimo: solo es para avisar de saldo bajo.
    const approxCost = CONFIG.paintGas * 100_000_000_000n;
    const paintsLeft = Number(this.balanceWei / approxCost);

    this.onState({
      address: this.walletAddress,
      walletAddress: this.walletAddress,
      balanceWei: this.balanceWei,
      paintsLeft,
      ready: this.ready,
      blocked: this.ready && paintsLeft === 0 ? "sin-fondos" : null,
      ...(lastError !== undefined ? { lastError } : {}),
    });
  }
}

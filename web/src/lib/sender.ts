/** Los tres modos que el usuario puede elegir. */
export type WalletMode = "app" | "wallet" | "session";

/** Qué le falta al usuario para poder pintar. */
export type Blocker = null | "conectar" | "fondear" | "sin-fondos" | "sin-wallet";

export interface SenderState {
  /** Dirección que FIRMA las transacciones de pintado. En modo sesión es la
   *  burner, no la wallet del usuario. */
  address: `0x${string}` | null;
  /** Wallet real del usuario, si hay una conectada. Solo para identificarse. */
  walletAddress: `0x${string}` | null;
  balanceWei: bigint;
  /** Cuántos píxeles más caben con el saldo actual. */
  paintsLeft: number;
  ready: boolean;
  blocked: Blocker;
  lastError?: string;
}

/**
 * Lo que App necesita para pintar, sin importar de dónde salga la firma.
 *
 * Hay dos implementaciones:
 *
 *   LocalPainter   firma con una clave que vive en el navegador. Una sola
 *                  llamada RPC por píxel, cero ventanas emergentes. Lo usan el
 *                  modo "app" y el modo "sesión".
 *
 *   WalletPainter  delega la firma a la wallet del usuario (MetaMask y
 *                  similares). Una ventana emergente POR PÍXEL, que es el
 *                  precio de que la transacción salga de su propia dirección.
 */
export interface PaintSender {
  init(): Promise<void>;
  paint(idx: number, color: number): Promise<`0x${string}`>;
  dispose(): void;
}

export const MODE_LABEL: Record<WalletMode, string> = {
  app: "Wallet de la app",
  wallet: "Mi wallet",
  session: "Clave de sesión",
};

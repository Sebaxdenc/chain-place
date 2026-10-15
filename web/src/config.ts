import { monadTestnet } from "viem/chains";

/**
 * Los errores de configuración se recogen en una lista en vez de lanzar una
 * excepción. Un `throw` en el momento del import deja la página en blanco sin
 * explicación, que es la peor forma posible de descubrir que te falta un .env.
 * Así App puede mostrar una pantalla que diga qué falta.
 */
export const configErrors: string[] = [];

function required(name: string, value: string | undefined): string {
  if (!value) {
    configErrors.push(name);
    return "";
  }
  return value;
}

const canvasAddress = required(
  "VITE_CANVAS_ADDRESS",
  import.meta.env.VITE_CANVAS_ADDRESS,
);
const relayUrl = required("VITE_RELAY_URL", import.meta.env.VITE_RELAY_URL);

if (canvasAddress && !/^0x[0-9a-fA-F]{40}$/.test(canvasAddress)) {
  configErrors.push("VITE_CANVAS_ADDRESS (no es una dirección válida)");
}

export const CONFIG = {
  chain: monadTestnet,
  canvasAddress: canvasAddress as `0x${string}`,
  relayUrl,
  rpcUrl: import.meta.env.VITE_RPC_URL ?? "https://testnet-rpc.monad.xyz",

  width: 128,
  height: 128,

  /**
   * Gas fijo, medido con `forge test` bajo el modelo de gas de Monad:
   *   62.271 (píxel virgen) + 21.000 (intrínseco) = 83.271 en el peor caso.
   *
   * Va a mano por DOS razones:
   *  1. Nos ahorra un `eth_estimateGas` por píxel — el camino caliente baja a
   *     UNA sola llamada RPC.
   *  2. En Monad se cobra el GAS LIMIT, no el gas usado y sin reembolsos.
   *
   * Y por el punto 2, el margen de seguridad NO es gratis, se paga entero.
   * A base fee mínimo (100 MON-gwei):
   *
   *   límite 84.000  →  0.0084 MON por píxel  →  119 píxeles por MON
   *   límite 95.000  →  0.0095 MON por píxel  →  105 píxeles por MON
   *
   * Elegimos 95.000 (un 14% de margen sobre el peor caso medido) a propósito:
   * en testnet el MON es gratis, y una transacción que falla por out-of-gas
   * delante del público cuesta mucho más que un 12% de gas. Si algún día esto
   * va a mainnet con dinero real, bájalo a ~85.000 y vuelve a medir.
   */
  paintGas: 95_000n,

  /** Cada cuánto se refrescan las fees. No por transacción: eso añadiría una
   *  llamada RPC a cada píxel y es justo lo que queremos evitar. */
  feeRefreshMs: 3_000,
} as const;

export const TOTAL_PIXELS = CONFIG.width * CONFIG.height;

export const xyToIdx = (x: number, y: number): number => y * CONFIG.width + x;

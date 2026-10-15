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

const RELAY_STORAGE_KEY = "chain-place:relay";

/**
 * Resuelve la URL del relay EN TIEMPO DE EJECUCIÓN, no al compilar.
 *
 * Las variables `VITE_*` quedan embebidas en el bundle, así que si la URL del
 * relay viviera solo ahí, cambiarla obligaría a reconstruir y redesplegar todo
 * el frontend. Eso hace imposible combinar un frontend desplegado (Cloudflare
 * Pages) con un relay en un túnel, cuya URL cambia en cada arranque.
 *
 * Orden de preferencia:
 *   1. `?relay=wss://...` en la URL — así el QR del auditorio puede llevar la
 *      URL del relay de ese día, sin tocar el frontend desplegado
 *   2. localStorage — recuerda la última usada
 *   3. VITE_RELAY_URL — el valor por defecto de la compilación
 */
function resolveRelayUrl(): string {
  const fromQuery = new URLSearchParams(window.location.search).get("relay");
  if (fromQuery && /^wss?:\/\//.test(fromQuery)) {
    localStorage.setItem(RELAY_STORAGE_KEY, fromQuery);
    return fromQuery;
  }

  const stored = localStorage.getItem(RELAY_STORAGE_KEY);
  if (stored && /^wss?:\/\//.test(stored)) return stored;

  return import.meta.env.VITE_RELAY_URL ?? "";
}

/**
 * El relay es OPCIONAL. Sin él, el frontend habla directo con Monad ("modo
 * directo"): hidrata con un eth_call y se suscribe él mismo a los logs.
 *
 * Eso permite desplegar el frontend solo, gratis y para siempre, en Vercel o
 * Cloudflare Pages, sin ningún servidor detrás. El precio es que cada celular
 * carga el RPC por su cuenta, así que para un auditorio lleno conviene el
 * relay. Ver DEPLOY.md.
 */
const relayUrl = resolveRelayUrl();

/**
 * Un navegador BLOQUEA un WebSocket sin cifrar (`ws://`) desde una página
 * servida por `https://`. Es contenido mixto, y el síntoma es que el lienzo
 * carga pero se queda eternamente en "conectando" sin ningún error visible.
 * Vale la pena detectarlo y decirlo con claridad.
 */
export const mixedContentWarning =
  window.location.protocol === "https:" && relayUrl.startsWith("ws://")
    ? `La página va por HTTPS pero el relay es ${relayUrl} (sin cifrar). ` +
      `El navegador lo va a bloquear: cambia ws:// por wss://`
    : null;

if (canvasAddress && !/^0x[0-9a-fA-F]{40}$/.test(canvasAddress)) {
  configErrors.push("VITE_CANVAS_ADDRESS (no es una dirección válida)");
}

const rpcUrl = import.meta.env.VITE_RPC_URL ?? "https://testnet-rpc.monad.xyz";

export const CONFIG = {
  chain: monadTestnet,
  canvasAddress: canvasAddress as `0x${string}`,

  /** Vacío = modo directo, sin relay. */
  relayUrl,
  /** `"relay"` cuando hay relay configurado, `"directo"` cuando no. */
  mode: (relayUrl ? "relay" : "directo") as "relay" | "directo",

  rpcUrl,

  /** WebSocket del RPC, para el modo directo. Por defecto el mismo host que
   *  `rpcUrl` pero con esquema wss, que es como lo sirve Monad. */
  rpcWsUrl:
    import.meta.env.VITE_RPC_WS_URL ??
    rpcUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:"),

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

  /** Cada cuánto se agrupan los píxeles nuevos en modo directo. Mismo valor
   *  que usa el relay, para que las dos fuentes se sientan igual. */
  flushMs: 100,
} as const;

export const TOTAL_PIXELS = CONFIG.width * CONFIG.height;

export const xyToIdx = (x: number, y: number): number => y * CONFIG.width + x;

import { monad, monadTestnet } from "viem/chains";

/** Lee la dirección del contrato de la variable de entorno, sin valor por defecto:
 *  arrancar apuntando al contrato equivocado es peor que no arrancar. */
const canvasAddress = process.env.CANVAS_ADDRESS;
if (!canvasAddress || !/^0x[0-9a-fA-F]{40}$/.test(canvasAddress)) {
  console.error(
    "\n  Falta CANVAS_ADDRESS (o no es una dirección válida).\n\n" +
      "  Úsalo así:\n" +
      "    CANVAS_ADDRESS=0x... npm start\n\n" +
      "  O ponlo en un .env y cárgalo con:  node --env-file=../.env\n",
  );
  process.exit(1);
}

const useMainnet = process.env.MONAD_NETWORK === "mainnet";

export const CONFIG = {
  chain: useMainnet ? monad : monadTestnet,

  /** HTTP se usa solo para la hidratación inicial (un eth_call grande). */
  rpcHttp:
    process.env.MONAD_RPC_HTTP ??
    (useMainnet ? "https://rpc.monad.xyz" : "https://testnet-rpc.monad.xyz"),

  /** WebSocket para la suscripción a logs. UNA sola conexión para todo el auditorio. */
  rpcWs:
    process.env.MONAD_RPC_WS ??
    (useMainnet ? "wss://rpc.monad.xyz" : "wss://testnet-rpc.monad.xyz"),

  canvasAddress: canvasAddress as `0x${string}`,
  port: Number(process.env.PORT ?? 8787),

  /** Tienen que coincidir con las constantes del contrato. */
  width: 128,
  height: 128,

  /** Cada cuánto se agrupan los píxeles nuevos y se mandan a los clientes.
   *  100ms es un buen punto: por debajo saturas la red del celular sin que el
   *  ojo note la diferencia; por encima se empieza a sentir lento. */
  flushMs: 100,

  /** Cada cuánto se manda el bloque de estadísticas (TPS, altura de bloque). */
  statsMs: 500,
} as const;

export const TOTAL_PIXELS = CONFIG.width * CONFIG.height;

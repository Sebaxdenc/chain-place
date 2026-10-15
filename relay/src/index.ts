import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { createPublicClient, http, webSocket, hexToBytes } from "viem";
import { CONFIG, TOTAL_PIXELS } from "./config.js";
import { canvasAbi } from "./abi.js";
import { CanvasState, type PaintRecord } from "./canvas.js";

const canvas = new CanvasState();

// ─────────────────────────────────────────────────────────────────────────────
// Clientes RPC
//
// HTTP para la hidratación (un eth_call gordo) y WebSocket para la suscripción.
// Este proceso mantiene UNA conexión upstream para todo el auditorio. Si en vez
// de esto cada celular se suscribiera al RPC, los 15-25 req/s del endpoint
// público se agotarían en segundos y la demo se cae.
// ─────────────────────────────────────────────────────────────────────────────
const httpClient = createPublicClient({
  chain: CONFIG.chain,
  transport: http(CONFIG.rpcHttp),
});

const wsClient = createPublicClient({
  chain: CONFIG.chain,
  transport: webSocket(CONFIG.rpcWs, { reconnect: { attempts: 20, delay: 1_000 } }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Hidratación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lee el lienzo completo de la cadena. `colorsOf` devuelve un byte por píxel,
 * así que son 16 KB en UNA llamada en lugar de 16.384.
 *
 * El eth_call gasta ~6,7M de gas. Entra de sobra en el límite de 30M por
 * transacción, pero algunos proveedores de RPC ponen topes más bajos a
 * eth_call, así que si la llamada entera falla, lo reintentamos por trozos.
 */
async function hydrate(): Promise<Uint8Array> {
  const read = (start: number, count: number) =>
    httpClient.readContract({
      address: CONFIG.canvasAddress,
      abi: canvasAbi,
      functionName: "colorsOf",
      args: [start, count],
    });

  try {
    const hex = await read(0, TOTAL_PIXELS);
    return hexToBytes(hex);
  } catch (err) {
    console.warn(
      `  La hidratación completa falló (${(err as Error).message.slice(0, 80)}).`,
    );
    console.warn("  Reintentando por trozos de 4096 píxeles...");
    const out = new Uint8Array(TOTAL_PIXELS);
    const CHUNK = 4096;
    for (let start = 0; start < TOTAL_PIXELS; start += CHUNK) {
      const count = Math.min(CHUNK, TOTAL_PIXELS - start);
      out.set(hexToBytes(await read(start, count)), start);
    }
    return out;
  }
}

/** Comprueba que las dimensiones del contrato coinciden con las del relay.
 *  Si no cuadran, los índices de píxel significarían cosas distintas en cada
 *  lado y el lienzo saldría descuadrado sin ningún error visible. */
async function assertDimensions(): Promise<void> {
  const [w, h] = await Promise.all([
    httpClient.readContract({
      address: CONFIG.canvasAddress,
      abi: canvasAbi,
      functionName: "WIDTH",
    }),
    httpClient.readContract({
      address: CONFIG.canvasAddress,
      abi: canvasAbi,
      functionName: "HEIGHT",
    }),
  ]);
  if (Number(w) !== CONFIG.width || Number(h) !== CONFIG.height) {
    throw new Error(
      `El contrato es ${w}x${h} pero el relay está configurado a ` +
        `${CONFIG.width}x${CONFIG.height}. Ajusta CONFIG en config.ts.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Servidor: snapshot al conectar, deltas después
// ─────────────────────────────────────────────────────────────────────────────
const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        clients: wss.clients.size,
        painted: canvas.paintedCount(),
        totalPaints: canvas.totalPaints,
        block: canvas.blockNumber.toString(),
        contract: CONFIG.canvasAddress,
        chainId: CONFIG.chain.id,
      }),
    );
    return;
  }
  res.writeHead(404).end("chain-place relay");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket: WebSocket) => {
  // Lo primero que recibe cualquier cliente: el lienzo completo.
  socket.send(canvas.snapshotFrame());
  socket.send(JSON.stringify(statsPayload()));
  socket.on("error", () => socket.terminate());
});

function broadcast(data: Buffer | string): void {
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) client.send(data);
  }
}

function statsPayload() {
  return {
    type: "stats" as const,
    tps: canvas.tps(),
    peakTps: canvas.peakTps,
    block: canvas.blockNumber.toString(),
    totalPaints: canvas.totalPaints,
    painted: canvas.paintedCount(),
    clients: wss.clients.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suscripción a la cadena
// ─────────────────────────────────────────────────────────────────────────────
let unwatchLogs: (() => void) | undefined;
let unwatchBlocks: (() => void) | undefined;
let resyncing = false;

/** Cuando la suscripción se cae, podríamos perder píxeles. En vez de intentar
 *  rellenar huecos con getLogs, re-hidratamos: es UNA llamada, nos da el estado
 *  autoritativo y no hay forma de equivocarse. Lo único que se pierde es el
 *  feed de "quién pintó", que es cosmético.
 *
 *  Y no es solo elegancia: `eth_getLogs` en el RPC público de Monad está
 *  LIMITADO A 100 BLOQUES de rango (error -32614). A 300ms por bloque eso son
 *  30 segundos de historia. Reconstruir un hueco de dos minutos necesitaría
 *  decenas de llamadas y te comerías el rate limit. Re-hidratar es una sola
 *  llamada y da el estado exacto. */
async function resync(reason: string): Promise<void> {
  if (resyncing) return;
  resyncing = true;
  console.warn(`  Re-sincronizando (${reason})...`);
  try {
    canvas.replaceAll(await hydrate());
    broadcast(canvas.snapshotFrame());
    console.log(`  Re-sincronizado. ${canvas.paintedCount()} píxeles pintados.`);
  } catch (err) {
    console.error("  Falló la re-sincronización:", (err as Error).message);
  } finally {
    resyncing = false;
  }
}

function subscribe(): void {
  unwatchLogs = wsClient.watchContractEvent({
    address: CONFIG.canvasAddress,
    abi: canvasAbi,
    eventName: "Painted",
    onLogs: (logs) => {
      for (const log of logs) {
        const { idx, color, painter } = log.args as {
          idx?: number | bigint;
          color?: number | bigint;
          painter?: `0x${string}`;
        };
        if (idx === undefined || color === undefined || painter === undefined) continue;
        const record: PaintRecord = {
          idx: Number(idx),
          color: Number(color),
          painter,
        };
        canvas.apply(record);
      }
    },
    onError: (err) => void resync(`error en la suscripción: ${err.message}`),
  });

  unwatchBlocks = wsClient.watchBlockNumber({
    emitOnBegin: true,
    onBlockNumber: (bn) => {
      canvas.blockNumber = bn;
    },
    onError: (err) => console.warn("  newHeads:", err.message),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Arranque
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("\n  chain-place relay");
  console.log(`  red       ${CONFIG.chain.name} (${CONFIG.chain.id})`);
  console.log(`  contrato  ${CONFIG.canvasAddress}`);
  console.log(`  rpc       ${CONFIG.rpcHttp}`);
  console.log(`  ws        ${CONFIG.rpcWs}\n`);

  await assertDimensions();
  console.log(`  Dimensiones OK: ${CONFIG.width}x${CONFIG.height}`);

  const t0 = Date.now();
  canvas.replaceAll(await hydrate());
  console.log(
    `  Lienzo hidratado en ${Date.now() - t0}ms — ` +
      `${canvas.paintedCount()} de ${TOTAL_PIXELS} píxeles pintados`,
  );

  subscribe();
  console.log("  Suscrito a los eventos Painted");

  // Agrupa los píxeles nuevos y los manda en un frame cada flushMs.
  setInterval(() => {
    const frame = canvas.deltaFrame();
    if (frame) broadcast(frame);

    const feed = canvas.drainFeed();
    if (feed.length > 0) {
      broadcast(JSON.stringify({ type: "paints", items: feed }));
    }
  }, CONFIG.flushMs);

  setInterval(() => broadcast(JSON.stringify(statsPayload())), CONFIG.statsMs);

  httpServer.listen(CONFIG.port, () => {
    console.log(`  Escuchando en ws://localhost:${CONFIG.port}`);
    console.log(`  Salud en     http://localhost:${CONFIG.port}/health\n`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log("\n  Cerrando...");
    unwatchLogs?.();
    unwatchBlocks?.();
    wss.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000);
  });
}

main().catch((err) => {
  console.error("\n  El relay no pudo arrancar:\n ", err.message, "\n");
  process.exit(1);
});

import { createPublicClient, http, webSocket, hexToBytes } from "viem";
import { CONFIG, TOTAL_PIXELS } from "../config";
import { canvasAbi } from "./abi";
import type { CanvasSource, RelayHandlers, PaintRecord } from "./relay";

/**
 * Fuente de datos SIN relay: el navegador habla directo con Monad.
 *
 * Implementa la misma interfaz que RelayClient, así que App no distingue una de
 * otra. Esto es lo que permite desplegar el frontend solo — gratis y para
 * siempre en Vercel o Pages — sin ningún servidor detrás.
 *
 * El compromiso es real y conviene tenerlo claro:
 *
 *   modo directo   cada celular hidrata con su propio eth_call y mantiene su
 *                  propia suscripción. Cero infraestructura, pero la carga
 *                  contra el RPC crece con cada persona conectada.
 *
 *   modo relay     un solo proceso mantiene UNA suscripción y la reparte.
 *                  La carga del RPC no depende de cuánta gente haya.
 *
 * Para desarrollar y para demos pequeñas, el modo directo sobra. Para un
 * auditorio lleno, usa el relay: el RPC público aguanta 15-25 req/s.
 */
export class DirectClient implements CanvasSource {
  private readonly httpClient;
  private readonly wsClient;
  private unwatchLogs?: () => void;
  private unwatchBlocks?: () => void;
  private flushTimer?: ReturnType<typeof setInterval>;
  private closed = false;

  /** Deltas acumulados entre vuelcos, igual que hace el relay: si alguien
   *  repinta el mismo píxel dos veces en la misma ventana, solo mandamos el
   *  último color. */
  private readonly buffer = new Map<number, number>();
  private feed: PaintRecord[] = [];
  private paintTimes: number[] = [];
  private totalPaints = 0;
  private peakTps = 0;
  private blockNumber = 0n;
  private painted = 0;

  constructor(private readonly handlers: RelayHandlers) {
    this.httpClient = createPublicClient({
      chain: CONFIG.chain,
      transport: http(CONFIG.rpcUrl),
    });
    this.wsClient = createPublicClient({
      chain: CONFIG.chain,
      transport: webSocket(CONFIG.rpcWsUrl, {
        reconnect: { attempts: 20, delay: 1_000 },
      }),
    });
  }

  connect(): void {
    this.closed = false;
    this.handlers.onStatus("conectando");
    void this.start();
  }

  close(): void {
    this.closed = true;
    this.unwatchLogs?.();
    this.unwatchBlocks?.();
    if (this.flushTimer) clearInterval(this.flushTimer);
  }

  private async start(): Promise<void> {
    try {
      const colors = await this.hydrate();
      if (this.closed) return;
      this.painted = colors.reduce((n, v) => n + (v ? 1 : 0), 0);
      this.handlers.onSnapshot(colors);
      this.subscribe();
      this.flushTimer = setInterval(() => this.flush(), CONFIG.flushMs);
      this.handlers.onStatus("conectado");
      this.emitStats();
    } catch {
      this.handlers.onStatus("desconectado");
      // Reintento sencillo: sin relay, si el RPC falla al arrancar no hay a
      // quién más preguntar.
      if (!this.closed) setTimeout(() => void this.start(), 3_000);
    }
  }

  /**
   * Lee el lienzo completo. Troceado SIEMPRE, no como último recurso: en modo
   * directo no controlamos qué RPC usa el usuario, y el eth_call del lienzo
   * entero gasta ~6,7M de gas, por encima del tope que ponen algunos
   * proveedores.
   */
  private async hydrate(): Promise<Uint8Array> {
    const out = new Uint8Array(TOTAL_PIXELS);
    const CHUNK = 4096;
    for (let start = 0; start < TOTAL_PIXELS; start += CHUNK) {
      const count = Math.min(CHUNK, TOTAL_PIXELS - start);
      const hex = await this.httpClient.readContract({
        address: CONFIG.canvasAddress,
        abi: canvasAbi,
        functionName: "colorsOf",
        args: [start, count],
      });
      out.set(hexToBytes(hex), start);
      if (this.closed) break;
    }
    return out;
  }

  private subscribe(): void {
    this.unwatchLogs = this.wsClient.watchContractEvent({
      address: CONFIG.canvasAddress,
      abi: canvasAbi,
      eventName: "Painted",
      onLogs: (logs) => {
        const now = Date.now();
        for (const log of logs) {
          const { idx, color, painter } = log.args as {
            idx?: number | bigint;
            color?: number | bigint;
            painter?: `0x${string}`;
          };
          if (idx === undefined || color === undefined || painter === undefined) {
            continue;
          }
          const index = Number(idx);
          if (index < 0 || index >= TOTAL_PIXELS) continue;

          this.buffer.set(index, Number(color));
          this.feed.push({ idx: index, color: Number(color), painter });
          if (this.feed.length > 50) this.feed.shift();
          this.paintTimes.push(now);
          this.totalPaints++;
        }
      },
      onError: () => this.handlers.onStatus("desconectado"),
    });

    this.unwatchBlocks = this.wsClient.watchBlockNumber({
      emitOnBegin: true,
      onBlockNumber: (bn) => {
        this.blockNumber = bn;
      },
      onError: () => {},
    });
  }

  private flush(): void {
    if (this.buffer.size > 0) {
      const deltas = [...this.buffer].map(([idx, color]) => ({ idx, color }));
      this.buffer.clear();
      // `painted` solo puede crecer: no sabemos si el píxel ya tenía color sin
      // consultar el lienzo, y esto es solo para el contador.
      this.painted += deltas.filter((d) => d.color !== 0).length;
      this.handlers.onDeltas(deltas);
    }
    if (this.feed.length > 0) {
      this.handlers.onPaints(this.feed);
      this.feed = [];
    }
    this.emitStats();
  }

  private emitStats(): void {
    const cutoff = Date.now() - 1_000;
    let i = 0;
    while (i < this.paintTimes.length && this.paintTimes[i]! < cutoff) i++;
    if (i > 0) this.paintTimes = this.paintTimes.slice(i);
    const tps = this.paintTimes.length;
    if (tps > this.peakTps) this.peakTps = tps;

    this.handlers.onStats({
      tps,
      peakTps: this.peakTps,
      block: this.blockNumber.toString(),
      totalPaints: this.totalPaints,
      painted: this.painted,
      // En modo directo no hay servidor que cuente, así que cada cliente solo
      // se ve a sí mismo.
      clients: 1,
    });
  }
}

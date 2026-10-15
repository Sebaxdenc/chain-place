import { TOTAL_PIXELS } from "../config";

const FRAME = { SNAPSHOT: 0x00, DELTA: 0x01 } as const;

export interface RelayStats {
  tps: number;
  peakTps: number;
  block: string;
  totalPaints: number;
  painted: number;
  clients: number;
}

export interface PaintRecord {
  idx: number;
  color: number;
  painter: `0x${string}`;
}

export type RelayStatus = "conectando" | "conectado" | "desconectado";

export interface RelayHandlers {
  /** Lienzo completo. Llega al conectar y en cada re-sincronización. */
  onSnapshot(colors: Uint8Array): void;
  /** Píxeles que cambiaron. Agrupados por el relay cada 100 ms. */
  onDeltas(deltas: ReadonlyArray<{ idx: number; color: number }>): void;
  onStats(stats: RelayStats): void;
  onPaints(items: readonly PaintRecord[]): void;
  onStatus(status: RelayStatus): void;
}

/**
 * Cliente del relay.
 *
 * Una sola conexión WebSocket por celular, y el relay a su vez mantiene una
 * sola conexión a Monad. Si cada celular se suscribiera directo al RPC, los
 * 15-25 req/s del endpoint público se agotarían con un puñado de usuarios.
 */
export class RelayClient {
  private socket?: WebSocket;
  private reconnectDelay = 500;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly handlers: RelayHandlers,
  ) {}

  connect(): void {
    this.closed = false;
    this.handlers.onStatus("conectando");

    const socket = new WebSocket(this.url);
    // Sin esto los frames binarios llegan como Blob y habría que leerlos de
    // forma asíncrona, añadiendo latencia a cada delta.
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectDelay = 500;
      this.handlers.onStatus("conectado");
    };

    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        this.handleText(event.data);
      } else {
        this.handleBinary(event.data as ArrayBuffer);
      }
    };

    socket.onclose = () => {
      this.handlers.onStatus("desconectado");
      if (!this.closed) this.scheduleReconnect();
    };

    // Dejamos que onclose se encargue: 'error' siempre va seguido de 'close'.
    socket.onerror = () => socket.close();
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
  }

  /** Reconexión con backoff exponencial, con techo de 5s. El WiFi de un
   *  auditorio se cae, y queremos que el lienzo vuelva solo sin que nadie
   *  recargue la página. */
  private scheduleReconnect(): void {
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, 5_000);
    setTimeout(() => {
      if (!this.closed) this.connect();
    }, delay);
  }

  private handleText(raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg !== "object" || msg === null) return;
    const payload = msg as { type?: string };

    if (payload.type === "stats") {
      this.handlers.onStats(msg as unknown as RelayStats);
    } else if (payload.type === "paints") {
      const { items } = msg as { items?: PaintRecord[] };
      if (Array.isArray(items)) this.handlers.onPaints(items);
    }
  }

  private handleBinary(buffer: ArrayBuffer): void {
    const view = new DataView(buffer);
    const type = view.getUint8(0);

    if (type === FRAME.SNAPSHOT) {
      const width = view.getUint16(1, true);
      const height = view.getUint16(3, true);
      const expected = width * height;
      if (expected !== TOTAL_PIXELS) {
        console.error(
          `El relay manda un lienzo de ${width}x${height} pero el cliente ` +
            `espera otro tamaño. Revisa CONFIG en config.ts.`,
        );
        return;
      }
      this.handlers.onSnapshot(new Uint8Array(buffer, 5, expected));
      return;
    }

    if (type === FRAME.DELTA) {
      const n = view.getUint16(1, true);
      const deltas: Array<{ idx: number; color: number }> = [];
      for (let i = 0; i < n; i++) {
        const offset = 3 + i * 3;
        deltas.push({
          idx: view.getUint16(offset, true),
          color: view.getUint8(offset + 2),
        });
      }
      this.handlers.onDeltas(deltas);
    }
  }
}

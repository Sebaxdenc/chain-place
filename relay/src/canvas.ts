import { CONFIG, TOTAL_PIXELS } from "./config.js";

export interface PaintRecord {
  idx: number;
  color: number;
  painter: `0x${string}`;
}

/** Tipos de frame BINARIO que el relay manda a los clientes.
 *  El canal binario lleva solo datos del lienzo, que es el camino caliente:
 *  los celulares necesitan esto y nada más para dibujar. */
export const FRAME = {
  SNAPSHOT: 0x00,
  DELTA: 0x01,
} as const;

/**
 * Estado del lienzo en memoria.
 *
 * 16.384 bytes. Cabe de sobra en RAM y es la razón por la que no hace falta
 * base de datos: el lienzo entero es más pequeño que un logo en PNG.
 */
export class CanvasState {
  /** Un byte por píxel: el índice de color. 0 = sin pintar. */
  readonly pixels = new Uint8Array(TOTAL_PIXELS);

  /** Píxeles cambiados desde el último flush. Es un Map y no un array a
   *  propósito: si alguien repinta el mismo píxel tres veces en 100ms, solo
   *  mandamos el color final. */
  private readonly pending = new Map<number, number>();

  /** Cola del feed de pintores para el proyector (quién pintó qué). */
  private paintFeed: PaintRecord[] = [];

  /** Marcas de tiempo de las pintadas recientes, para calcular el TPS. */
  private paintTimes: number[] = [];

  totalPaints = 0;
  peakTps = 0;
  blockNumber = 0n;

  /** Aplica un píxel pintado. Devuelve false si el índice viene fuera de
   *  rango (no debería pasar, el contrato ya valida, pero nunca confíes
   *  ciegamente en datos de red). */
  apply(record: PaintRecord): boolean {
    if (!Number.isInteger(record.idx) || record.idx < 0 || record.idx >= TOTAL_PIXELS) {
      return false;
    }
    this.pixels[record.idx] = record.color;
    this.pending.set(record.idx, record.color);
    this.totalPaints++;
    this.paintTimes.push(Date.now());
    this.paintFeed.push(record);
    if (this.paintFeed.length > 50) this.paintFeed.shift();
    return true;
  }

  /** Reemplaza el lienzo completo (hidratación inicial o re-sincronización). */
  replaceAll(colors: Uint8Array): void {
    this.pixels.set(colors.subarray(0, TOTAL_PIXELS));
    this.pending.clear();
  }

  /**
   * Frame de snapshot: el lienzo completo. Se manda una sola vez, al conectar.
   *   [0x00][ancho u16][alto u16][colores...]
   * Son ~16 KB, menos que una foto. Por eso el cliente no necesita hacer
   * 16.384 llamadas RPC para arrancar.
   */
  snapshotFrame(): Buffer {
    const buf = Buffer.allocUnsafe(5 + TOTAL_PIXELS);
    buf.writeUInt8(FRAME.SNAPSHOT, 0);
    buf.writeUInt16LE(CONFIG.width, 1);
    buf.writeUInt16LE(CONFIG.height, 3);
    Buffer.from(this.pixels.buffer, this.pixels.byteOffset, TOTAL_PIXELS).copy(buf, 5);
    return buf;
  }

  /**
   * Frame de deltas: solo lo que cambió.
   *   [0x01][n u16][(idx u16, color u8) × n]
   * 3 bytes por píxel. Mil píxeles en una ráfaga son 3 KB.
   * Devuelve null si no hubo cambios (así no mandamos frames vacíos).
   */
  deltaFrame(): Buffer | null {
    if (this.pending.size === 0) return null;
    const n = this.pending.size;
    const buf = Buffer.allocUnsafe(3 + n * 3);
    buf.writeUInt8(FRAME.DELTA, 0);
    buf.writeUInt16LE(n, 1);
    let off = 3;
    for (const [idx, color] of this.pending) {
      buf.writeUInt16LE(idx, off);
      buf.writeUInt8(color, off + 2);
      off += 3;
    }
    this.pending.clear();
    return buf;
  }

  /** Vacía y devuelve el feed de pintores acumulado. */
  drainFeed(): PaintRecord[] {
    const out = this.paintFeed;
    this.paintFeed = [];
    return out;
  }

  /** Transacciones por segundo en la última ventana. */
  tps(windowMs = 1000): number {
    const cutoff = Date.now() - windowMs;
    let i = 0;
    while (i < this.paintTimes.length && this.paintTimes[i]! < cutoff) i++;
    if (i > 0) this.paintTimes = this.paintTimes.slice(i);
    const current = this.paintTimes.length;
    if (current > this.peakTps) this.peakTps = current;
    return current;
  }

  /** Cuántos píxeles llevan color (para el contador del proyector). */
  paintedCount(): number {
    let n = 0;
    for (let i = 0; i < TOTAL_PIXELS; i++) if (this.pixels[i] !== 0) n++;
    return n;
  }
}

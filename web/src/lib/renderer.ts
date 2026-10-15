import { CONFIG, TOTAL_PIXELS } from "../config";
import { PALETTE_RGB } from "../palette";

/**
 * Dibuja el lienzo en un <canvas>.
 *
 * El canvas tiene un buffer real de 128x128 y se agranda con CSS
 * (`image-rendering: pixelated`). Eso significa que dibujar cuesta lo mismo
 * esté el lienzo al 100% o al 2400% de zoom.
 *
 * Lo que NO se hace: 16.384 divs. Un nodo del DOM por píxel tumba cualquier
 * celular. Aquí todo el lienzo es un único elemento y un ImageData de 64 KB.
 *
 * Hay dos capas de estado:
 *   · `confirmed` — lo que el relay dice que está en la cadena
 *   · `pending`   — píxeles que acabas de tocar y aún no han confirmado
 *
 * Los pendientes se dibujan pulsando, así el usuario ve que algo pasa sin
 * tener que esperar los ~600 ms de confirmación.
 */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly confirmed = new Uint8Array(TOTAL_PIXELS);
  private readonly pending = new Map<number, number>();
  private dirty = true;
  private frame = 0;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = CONFIG.width;
    canvas.height = CONFIG.height;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("No se pudo obtener el contexto 2D del canvas");
    this.ctx = ctx;
    this.image = ctx.createImageData(CONFIG.width, CONFIG.height);

    // Alpha a 255 de una vez: nunca lo cambiamos, el blend se hace sobre RGB.
    const data = this.image.data;
    for (let i = 3; i < data.length; i += 4) data[i] = 255;

    this.redrawAll();
    this.loop();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
  }

  /** Lienzo completo: al conectar y en cada re-sincronización del relay. */
  setSnapshot(colors: Uint8Array): void {
    this.confirmed.set(colors.subarray(0, TOTAL_PIXELS));
    // Un snapshot es la verdad de la cadena. Si teníamos un pendiente que ya
    // viene incluido, dejarlo marcado como pendiente sería mentir.
    for (const [idx, color] of this.pending) {
      if (this.confirmed[idx] === color) this.pending.delete(idx);
    }
    this.redrawAll();
  }

  /** Píxeles confirmados que llegan del relay.
   *  Devuelve los índices que estaban pendientes y acaban de confirmarse, para
   *  que la UI pueda medir la latencia real de cada uno. */
  applyDeltas(deltas: ReadonlyArray<{ idx: number; color: number }>): number[] {
    const resolved: number[] = [];
    for (const { idx, color } of deltas) {
      if (idx < 0 || idx >= TOTAL_PIXELS) continue;
      this.confirmed[idx] = color;
      if (this.pending.has(idx)) {
        this.pending.delete(idx);
        resolved.push(idx);
      }
      this.paintInto(idx, color, 1);
    }
    this.dirty = true;
    return resolved;
  }

  /** Marca un píxel como pendiente (pintado optimista, antes de confirmar). */
  addPending(idx: number, color: number): void {
    this.pending.set(idx, color);
    this.dirty = true;
  }

  /** Descarta un pendiente: la transacción falló. */
  dropPending(idx: number): void {
    if (this.pending.delete(idx)) {
      this.paintInto(idx, this.confirmed[idx] ?? 0, 1);
      this.dirty = true;
    }
  }

  colorAt(idx: number): number {
    return this.pending.get(idx) ?? this.confirmed[idx] ?? 0;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  private redrawAll(): void {
    for (let idx = 0; idx < TOTAL_PIXELS; idx++) {
      this.paintInto(idx, this.confirmed[idx] ?? 0, 1);
    }
    this.dirty = true;
  }

  /**
   * Escribe un píxel en el ImageData.
   * `strength` de 0 a 1 mezcla el color con blanco: es lo que da el efecto de
   * "pendiente" sin necesitar una segunda capa ni transparencias.
   */
  private paintInto(idx: number, color: number, strength: number): void {
    const base = color * 3;
    const r = PALETTE_RGB[base] ?? 255;
    const g = PALETTE_RGB[base + 1] ?? 255;
    const b = PALETTE_RGB[base + 2] ?? 255;

    const offset = idx * 4;
    const data = this.image.data;
    if (strength >= 1) {
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
    } else {
      const inverse = 1 - strength;
      data[offset] = Math.round(r * strength + 255 * inverse);
      data[offset + 1] = Math.round(g * strength + 255 * inverse);
      data[offset + 2] = Math.round(b * strength + 255 * inverse);
    }
  }

  /** Bucle de animación. Solo recalcula los píxeles pendientes, que son unos
   *  pocos, y solo vuelca el ImageData si algo cambió. */
  private loop = (): void => {
    if (this.pending.size > 0) {
      const pulse = 0.45 + 0.35 * Math.sin(performance.now() / 180);
      for (const [idx, color] of this.pending) {
        this.paintInto(idx, color, pulse);
      }
      this.dirty = true;
    }

    if (this.dirty) {
      this.ctx.putImageData(this.image, 0, 0);
      this.dirty = false;
    }

    this.frame = requestAnimationFrame(this.loop);
  };
}

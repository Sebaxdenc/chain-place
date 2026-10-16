import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIG, xyToIdx } from "../config";
import { IconExpand } from "./Icon";

interface Props {
  onCanvasReady: (canvas: HTMLCanvasElement) => void;
  selected: number | null;
  onSelect: (idx: number | null) => void;
}

/** Zoom al que se salta al tocar desde la vista general, en píxeles de
 *  pantalla por píxel del lienzo. A 14 el objetivo es cómodo para un dedo. */
const ZOOM_IN = 14;
const ZOOM_LEVELS = [14, 28] as const;

export function CanvasView({ onCanvasReady, selected, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerDown = useRef<{ x: number; y: number; t: number } | null>(null);

  const [fitZoom, setFitZoom] = useState(3);
  const [zoom, setZoom] = useState(3);

  const zoomedIn = zoom > fitZoom;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const recompute = () => {
      const next = Math.max(
        1,
        Math.floor(
          Math.min(element.clientWidth, element.clientHeight) / CONFIG.width,
        ),
      );
      setFitZoom(next);
      setZoom((current) => (current <= next ? next : current));
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (canvasRef.current) onCanvasReady(canvasRef.current);
  }, [onCanvasReady]);

  /** Deja un píxel concreto en el centro de la pantalla. */
  const centerOn = useCallback((idx: number, atZoom: number) => {
    const element = containerRef.current;
    if (!element) return;
    const x = idx % CONFIG.width;
    const y = Math.floor(idx / CONFIG.width);
    element.scrollLeft = x * atZoom + atZoom / 2 - element.clientWidth / 2;
    element.scrollTop = y * atZoom + atZoom / 2 - element.clientHeight / 2;
  }, []);

  const changeZoom = useCallback(
    (next: number) => {
      const element = containerRef.current;
      if (!element) {
        setZoom(next);
        return;
      }
      // Si hay un píxel elegido, el zoom gira alrededor de él; si no, del
      // centro de la vista actual.
      const anchor =
        selected ??
        xyToIdx(
          Math.floor((element.scrollLeft + element.clientWidth / 2) / zoom),
          Math.floor((element.scrollTop + element.clientHeight / 2) / zoom),
        );
      setZoom(next);
      requestAnimationFrame(() => centerOn(anchor, next));
    },
    [selected, zoom, centerOn],
  );

  const handlePointerDown = (event: React.PointerEvent) => {
    pointerDown.current = { x: event.clientX, y: event.clientY, t: Date.now() };
  };

  /**
   * Un toque hace una de dos cosas, estilo r/place:
   *
   *   · desde la vista general → ACERCA a ese punto y lo elige
   *   · ya estando cerca       → mueve la elección a ese píxel
   *
   * Pintar nunca ocurre aquí: hace falta pulsar el botón de confirmar. Son dos
   * toques en vez de uno, pero a cambio no pintas donde no querías, que en un
   * lienzo de 128 píxeles en una pantalla de teléfono pasaba todo el rato.
   *
   * El arrastre lo gestiona el scroll nativo (inercia gratis), así que solo
   * reaccionamos si el dedo casi no se movió.
   */
  const handlePointerUp = (event: React.PointerEvent) => {
    const start = pointerDown.current;
    pointerDown.current = null;
    if (!start) return;
    if (
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10 ||
      Date.now() - start.t > 500
    ) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    // getBoundingClientRect ya refleja el zoom, así que no hay que replicar la
    // transformación a mano.
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * CONFIG.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * CONFIG.height);
    if (x < 0 || y < 0 || x >= CONFIG.width || y >= CONFIG.height) return;

    const idx = xyToIdx(x, y);
    onSelect(idx);

    if (!zoomedIn) {
      setZoom(ZOOM_IN);
      requestAnimationFrame(() => centerOn(idx, ZOOM_IN));
    }
  };

  const cursorX = selected === null ? 0 : (selected % CONFIG.width) * zoom;
  const cursorY =
    selected === null ? 0 : Math.floor(selected / CONFIG.width) * zoom;

  return (
    <div className="canvas-area">
      <div className="canvas-scroll" ref={containerRef}>
        <div
          className="canvas-stage"
          style={{ width: CONFIG.width * zoom, height: CONFIG.height * zoom }}
        >
          <canvas
            ref={canvasRef}
            className="pixel-canvas"
            style={{ width: CONFIG.width * zoom, height: CONFIG.height * zoom }}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => (pointerDown.current = null)}
          />
          {selected !== null && (
            <div
              className="cursor"
              style={{ left: cursorX, top: cursorY, width: zoom, height: zoom }}
            />
          )}
        </div>
      </div>

      <div className="zoom-controls">
        {zoomedIn && (
          <button
            className="icon-btn"
            onClick={() => {
              onSelect(null);
              changeZoom(fitZoom);
            }}
            aria-label="Ver el lienzo completo"
          >
            <IconExpand size={18} />
          </button>
        )}
        {ZOOM_LEVELS.map((level) => (
          <button
            key={level}
            className="icon-btn"
            onClick={() => changeZoom(level)}
            aria-pressed={level === zoom}
          >
            {level === ZOOM_IN ? "1×" : "2×"}
          </button>
        ))}
      </div>
    </div>
  );
}

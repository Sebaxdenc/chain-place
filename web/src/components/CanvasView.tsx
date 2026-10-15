import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIG, xyToIdx } from "../config";

interface Props {
  onCanvasReady: (canvas: HTMLCanvasElement) => void;
  onPixelTap: (idx: number) => void;
}

/** Niveles de zoom en píxeles de pantalla por píxel del lienzo.
 *  El primero se calcula para que el lienzo entero quepa. */
const ZOOM_STEPS = [6, 12, 24] as const;

export function CanvasView({ onCanvasReady, onPixelTap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerDown = useRef<{ x: number; y: number; t: number } | null>(null);

  const [fitZoom, setFitZoom] = useState(3);
  const [zoom, setZoom] = useState(3);
  const [userZoomed, setUserZoomed] = useState(false);

  // El zoom "fit" depende del ancho de la pantalla, así que se recalcula al
  // rotar el teléfono. Si el usuario ya tocó el zoom, no le cambiamos la vista.
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
      if (!userZoomed) setZoom(next);
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(element);
    return () => observer.disconnect();
  }, [userZoomed]);

  useEffect(() => {
    if (canvasRef.current) onCanvasReady(canvasRef.current);
  }, [onCanvasReady]);

  /** Cambia el zoom manteniendo centrado el mismo punto del lienzo. Sin esto,
   *  ampliar te manda a una esquina al azar y es desorientador. */
  const changeZoom = useCallback(
    (next: number) => {
      const element = containerRef.current;
      setUserZoomed(true);
      if (!element) {
        setZoom(next);
        return;
      }
      const centerX = (element.scrollLeft + element.clientWidth / 2) / zoom;
      const centerY = (element.scrollTop + element.clientHeight / 2) / zoom;
      setZoom(next);
      requestAnimationFrame(() => {
        element.scrollLeft = centerX * next - element.clientWidth / 2;
        element.scrollTop = centerY * next - element.clientHeight / 2;
      });
    },
    [zoom],
  );

  const handlePointerDown = (event: React.PointerEvent) => {
    pointerDown.current = { x: event.clientX, y: event.clientY, t: Date.now() };
  };

  /**
   * Distinguimos "toque" de "arrastre": el arrastre lo gestiona el scroll
   * nativo del contenedor (que da inercia gratis y se siente mucho mejor que
   * cualquier pan hecho a mano), y solo pintamos si el dedo casi no se movió.
   */
  const handlePointerUp = (event: React.PointerEvent) => {
    const start = pointerDown.current;
    pointerDown.current = null;
    if (!start) return;

    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    const elapsed = Date.now() - start.t;
    if (moved > 10 || elapsed > 500) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Mapeamos con getBoundingClientRect, así funciona con cualquier zoom sin
    // tener que replicar la transformación a mano.
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * CONFIG.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * CONFIG.height);
    if (x < 0 || y < 0 || x >= CONFIG.width || y >= CONFIG.height) return;

    onPixelTap(xyToIdx(x, y));
  };

  const levels = [fitZoom, ...ZOOM_STEPS.filter((z) => z > fitZoom)];

  return (
    <div className="canvas-area">
      <div className="canvas-scroll" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="pixel-canvas"
          style={{
            width: CONFIG.width * zoom,
            height: CONFIG.height * zoom,
          }}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => (pointerDown.current = null)}
        />
      </div>

      <div className="zoom-controls">
        {levels.map((level) => (
          <button
            key={level}
            className={level === zoom ? "zoom-btn active" : "zoom-btn"}
            onClick={() => changeZoom(level)}
          >
            {level === fitZoom ? "ajustar" : `${level}×`}
          </button>
        ))}
      </div>
    </div>
  );
}

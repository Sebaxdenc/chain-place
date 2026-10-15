import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIG, configErrors } from "./config";
import { PALETTE } from "./palette";
import { CanvasRenderer } from "./lib/renderer";
import { RelayClient, type RelayStats, type RelayStatus } from "./lib/relay";
import { Painter, type PainterState } from "./lib/painter";
import { resolveBurner, type WalletOrigin } from "./lib/wallet";
import { CanvasView } from "./components/CanvasView";
import { Palette } from "./components/Palette";
import { StatusBar } from "./components/StatusBar";

export default function App() {
  if (configErrors.length > 0) return <SetupScreen missing={configErrors} />;
  return <Canvas />;
}

function SetupScreen({ missing }: { missing: string[] }) {
  return (
    <div className="setup">
      <h1>Falta configuración</h1>
      <p>Copia <code>web/.env.example</code> a <code>web/.env</code> y rellena:</p>
      <ul>
        {missing.map((name) => (
          <li key={name}>
            <code>{name}</code>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Vite solo lee el <code>.env</code> al arrancar: reinicia{" "}
        <code>npm run dev</code> después de crearlo.
      </p>
    </div>
  );
}

function Canvas() {
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [color, setColor] = useState(5);
  const [selected, setSelected] = useState<number | null>(null);
  const [painterState, setPainterState] = useState<PainterState | null>(null);
  const [stats, setStats] = useState<RelayStats | null>(null);
  const [status, setStatus] = useState<RelayStatus>("conectando");
  const [pending, setPending] = useState(0);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [origin, setOrigin] = useState<WalletOrigin>("nueva");

  const rendererRef = useRef<CanvasRenderer | null>(null);
  const painterRef = useRef<Painter | null>(null);
  /** idx → instante del toque, para medir la latencia real de cada píxel. */
  const sentAt = useRef(new Map<number, number>());

  // ── Wallet + painter ──────────────────────────────────────────────────────
  useEffect(() => {
    const burner = resolveBurner();
    setOrigin(burner.origin);

    const painter = new Painter(burner.account, setPainterState);
    painterRef.current = painter;
    void painter.init();

    return () => {
      painter.dispose();
      painterRef.current = null;
    };
  }, []);

  // ── Renderizador + relay ──────────────────────────────────────────────────
  // Se crean juntos y solo cuando el canvas existe, para que no llegue un
  // snapshot antes de tener dónde dibujarlo.
  useEffect(() => {
    if (!canvasEl) return;

    const renderer = new CanvasRenderer(canvasEl);
    rendererRef.current = renderer;

    const relay = new RelayClient(CONFIG.relayUrl, {
      onSnapshot: (colors) => {
        renderer.setSnapshot(colors);
        setPending(renderer.pendingCount());
      },
      onDeltas: (deltas) => {
        const resolved = renderer.applyDeltas(deltas);
        const now = performance.now();
        for (const idx of resolved) {
          const started = sentAt.current.get(idx);
          if (started !== undefined) {
            setLastLatencyMs(Math.round(now - started));
            sentAt.current.delete(idx);
          }
        }
        setPending(renderer.pendingCount());
      },
      onStats: setStats,
      onPaints: () => {
        /* el feed de pintores lo usa la vista del proyector (paso 6) */
      },
      onStatus: setStatus,
    });
    relay.connect();

    return () => {
      relay.close();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [canvasEl]);

  /** Confirma el píxel elegido. Se llama desde el botón, no desde el toque:
   *  elegir y pintar van separados para no pintar donde no querías. */
  const confirmPaint = useCallback(() => {
    const renderer = rendererRef.current;
    const painter = painterRef.current;
    if (selected === null || !renderer || !painter || !painterState?.ready) return;

    const idx = selected;

    // Pintar el mismo color que ya tiene no aporta nada y gastaría gas.
    if (renderer.colorAt(idx) === color) return;

    // 1. Pintado optimista: el píxel aparece YA, pulsando. El usuario no
    //    espera los ~600 ms de confirmación.
    renderer.addPending(idx, color);
    sentAt.current.set(idx, performance.now());
    setPending(renderer.pendingCount());

    // Soltamos la selección pero NO el zoom, para poder seguir dibujando
    // píxeles vecinos a golpe de toque.
    setSelected(null);

    // 2. La transacción sale en paralelo. Si falla, se revierte el píxel.
    painter.paint(idx, color).catch(() => {
      renderer.dropPending(idx);
      sentAt.current.delete(idx);
      setPending(renderer.pendingCount());
    });
  }, [selected, color, painterState?.ready]);

  const selectedXY =
    selected === null
      ? null
      : ([selected % CONFIG.width, Math.floor(selected / CONFIG.width)] as const);

  return (
    <div className="app">
      <StatusBar
        painter={painterState}
        stats={stats}
        status={status}
        pending={pending}
        lastLatencyMs={lastLatencyMs}
        origin={origin}
      />

      <CanvasView
        onCanvasReady={setCanvasEl}
        selected={selected}
        onSelect={setSelected}
      />

      {selectedXY && (
        <div className="confirm-bar">
          <span className="mono muted">
            ({selectedXY[0]}, {selectedXY[1]})
          </span>
          <button
            className="confirm-btn"
            style={{ background: PALETTE[color]?.hex }}
            onClick={confirmPaint}
            disabled={!painterState?.ready}
          >
            Pintar
          </button>
          <button className="cancel-btn" onClick={() => setSelected(null)}>
            ✕
          </button>
        </div>
      )}

      <Palette selected={color} onSelect={setColor} />
    </div>
  );
}

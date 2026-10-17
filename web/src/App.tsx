import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIG, configErrors, mixedContentWarning } from "./config";
import { PALETTE } from "./palette";
import { CanvasRenderer } from "./lib/renderer";
import {
  RelayClient,
  type CanvasSource,
  type RelayHandlers,
  type RelayStats,
  type RelayStatus,
} from "./lib/relay";
import { DirectClient } from "./lib/direct";
import { LocalPainter, describeError } from "./lib/painter";
import { WalletPainter } from "./lib/walletPainter";
import {
  connectInjected,
  hasInjected,
  sendValue,
  watchInjected,
} from "./lib/injected";
import type { PaintSender, SenderState, WalletMode } from "./lib/sender";
import { resolveBurner, loadMode, saveMode } from "./lib/wallet";
import { CanvasView } from "./components/CanvasView";
import { Palette } from "./components/Palette";
import { StatusBar } from "./components/StatusBar";
import { ModePicker } from "./components/ModePicker";
import { SessionCard } from "./components/SessionCard";
import { IconCheck, IconX } from "./components/Icon";

export default function App() {
  if (configErrors.length > 0) return <SetupScreen missing={configErrors} />;
  return <Canvas />;
}

function SetupScreen({ missing }: { missing: string[] }) {
  return (
    <div className="setup">
      <h1>Falta configuración</h1>
      <p>
        Copia <code>web/.env.example</code> a <code>web/.env</code> y rellena:
      </p>
      <ul>
        {missing.map((name) => (
          <li key={name}>
            <code>{name}</code>
          </li>
        ))}
      </ul>
      <p className="muted">
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
  const [senderState, setSenderState] = useState<SenderState | null>(null);
  const [stats, setStats] = useState<RelayStats | null>(null);
  const [status, setStatus] = useState<RelayStatus>("conectando");
  const [pending, setPending] = useState(0);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);

  const [mode, setMode] = useState<WalletMode | null>(() => loadMode());
  const [showModes, setShowModes] = useState(() => loadMode() === null);
  const [walletAddress, setWalletAddress] = useState<`0x${string}` | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rendererRef = useRef<CanvasRenderer | null>(null);
  const senderRef = useRef<PaintSender | null>(null);
  /** idx → instante del toque, para medir la latencia real de cada píxel. */
  const sentAt = useRef(new Map<number, number>());

  // La clave del navegador se resuelve una sola vez y se reutiliza: la usan
  // tanto el modo "app" como el modo "sesión".
  const burnerRef = useRef(resolveBurner());
  const burner = burnerRef.current;

  const walletAvailable = hasInjected();

  // ── Firmante, según el modo ───────────────────────────────────────────────
  useEffect(() => {
    if (mode === null) return;

    // El modo "mi wallet" no puede arrancar sin cuenta conectada.
    if (mode === "wallet" && !walletAddress) {
      senderRef.current = null;
      setSenderState({
        address: null,
        walletAddress: null,
        balanceWei: 0n,
        paintsLeft: 0,
        ready: false,
        blocked: walletAvailable ? "conectar" : "sin-wallet",
      });
      return;
    }

    const sender: PaintSender =
      mode === "wallet" && walletAddress
        ? new WalletPainter(walletAddress, setSenderState)
        : new LocalPainter(
            burner.account,
            setSenderState,
            mode === "session" ? walletAddress : null,
          );

    senderRef.current = sender;
    void sender.init();

    return () => {
      sender.dispose();
      senderRef.current = null;
    };
  }, [mode, walletAddress, walletAvailable, burner.account]);

  // Si el usuario cambia de cuenta o de red en su wallet, hay que enterarse:
  // seguir firmando con una cuenta que ya no está activa falla en silencio.
  useEffect(() => {
    if (mode !== "wallet" && mode !== "session") return;
    return watchInjected(() => {
      setWalletAddress(null);
      setActionError("Cambiaste de cuenta o de red en la wallet. Vuelve a conectar.");
    });
  }, [mode]);

  // ── Renderizador + fuente de datos ────────────────────────────────────────
  // Se crean juntos y solo cuando el canvas existe, para que no llegue un
  // snapshot antes de tener dónde dibujarlo.
  useEffect(() => {
    if (!canvasEl) return;

    const renderer = new CanvasRenderer(canvasEl);
    rendererRef.current = renderer;

    const handlers: RelayHandlers = {
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
    };

    const source: CanvasSource = CONFIG.relayUrl
      ? new RelayClient(CONFIG.relayUrl, handlers)
      : new DirectClient(handlers);
    source.connect();

    return () => {
      source.close();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [canvasEl]);

  // ── Acciones ──────────────────────────────────────────────────────────────
  const chooseMode = useCallback((next: WalletMode) => {
    setMode(next);
    saveMode(next);
    setActionError(null);
    setShowModes(false);
  }, []);

  const connect = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      setWalletAddress(await connectInjected());
    } catch (error) {
      setActionError(describeError(error));
    } finally {
      setBusy(false);
    }
  }, []);

  /** Conecta (si hace falta) y manda MON de la wallet del usuario a la clave
   *  de sesión. Una sola transacción, y después se pinta sin confirmaciones. */
  const fundSession = useCallback(
    async (amountWei: bigint) => {
      setBusy(true);
      setActionError(null);
      try {
        const from = walletAddress ?? (await connectInjected());
        setWalletAddress(from);
        await sendValue(from, burner.account.address, amountWei);

        // La transferencia confirma en ~600ms, pero damos varios intentos por
        // si la red va lenta. Sin esto habría que esperar al intervalo de 15s
        // y parecería que el fondeo no funcionó.
        const sender = senderRef.current;
        if (sender instanceof LocalPainter) {
          for (let i = 0; i < 6; i++) {
            await new Promise((r) => setTimeout(r, 700));
            await sender.refresh();
          }
        }
      } catch (error) {
        setActionError(describeError(error));
      } finally {
        setBusy(false);
      }
    },
    [walletAddress, burner.account.address],
  );

  /** Devuelve el saldo de la sesión a la wallet del usuario. */
  const sweepSession = useCallback(async () => {
    const sender = senderRef.current;
    if (!(sender instanceof LocalPainter) || !walletAddress) return;

    setBusy(true);
    setActionError(null);
    try {
      await sender.sweepTo(walletAddress);
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 700));
        await sender.refresh();
      }
    } catch (error) {
      setActionError(describeError(error));
    } finally {
      setBusy(false);
    }
  }, [walletAddress]);

  const confirmPaint = useCallback(() => {
    const renderer = rendererRef.current;
    const sender = senderRef.current;
    if (selected === null || !renderer || !sender || !senderState?.ready) return;

    const idx = selected;
    // Pintar el mismo color que ya tiene no aporta nada y gastaría gas.
    if (renderer.colorAt(idx) === color) return;

    // Pintado optimista: el píxel aparece YA, pulsando. El usuario no espera
    // los ~600 ms de confirmación.
    renderer.addPending(idx, color);
    sentAt.current.set(idx, performance.now());
    setPending(renderer.pendingCount());

    // Soltamos la selección pero NO el zoom, para seguir dibujando vecinos.
    setSelected(null);

    sender.paint(idx, color).catch(() => {
      renderer.dropPending(idx);
      sentAt.current.delete(idx);
      setPending(renderer.pendingCount());
    });
  }, [selected, color, senderState?.ready]);

  const selectedXY =
    selected === null
      ? null
      : ([selected % CONFIG.width, Math.floor(selected / CONFIG.width)] as const);

  return (
    <div className="app">
      <StatusBar
        sender={senderState}
        stats={stats}
        status={status}
        pending={pending}
        lastLatencyMs={lastLatencyMs}
        mode={mode}
        onOpenModes={() => setShowModes(true)}
      />

      {mixedContentWarning && (
        <div className="notice notice-error">{mixedContentWarning}</div>
      )}

      {actionError && <div className="notice notice-warn">{actionError}</div>}

      {/* En modo sesión sin fondos, el bloqueo ES la tarjeta de sesión: lleva
          el selector de monto y la dirección de destino a la vista. */}
      {mode === "session" && senderState?.blocked === "sin-fondos" ? (
        <SessionCard
          burnerAddress={burner.account.address}
          walletAddress={walletAddress}
          balanceWei={senderState.balanceWei}
          paintsLeft={senderState.paintsLeft}
          funded={false}
          busy={busy}
          onFund={fundSession}
          onSweep={sweepSession}
        />
      ) : (
        <Blocker
          mode={mode}
          sender={senderState}
          busy={busy}
          burnerAddress={burner.account.address}
          onConnect={connect}
        />
      )}

      <CanvasView
        onCanvasReady={setCanvasEl}
        selected={selected}
        onSelect={setSelected}
      />

      {selectedXY && (
        <div className="confirm-bar">
          <span className="coord">
            {selectedXY[0]}, {selectedXY[1]}
          </span>
          <button
            className="confirm-btn"
            onClick={confirmPaint}
            disabled={!senderState?.ready}
          >
            <span
              className="confirm-chip"
              style={{ background: PALETTE[color]?.hex }}
              aria-hidden="true"
            />
            <IconCheck size={18} />
            Pintar
          </button>
          <button
            className="ghost-btn"
            onClick={() => setSelected(null)}
            aria-label="Cancelar selección"
          >
            <IconX size={18} />
          </button>
        </div>
      )}

      <Palette selected={color} onSelect={setColor} />

      {showModes && (
        <ModePicker
          current={mode}
          walletAvailable={walletAvailable}
          onSelect={chooseMode}
          onClose={() => setShowModes(false)}
          dismissible={mode !== null}
          footer={
            mode === "session" && senderState ? (
              <SessionCard
                burnerAddress={burner.account.address}
                walletAddress={walletAddress}
                balanceWei={senderState.balanceWei}
                paintsLeft={senderState.paintsLeft}
                funded={senderState.paintsLeft > 0}
                busy={busy}
                onFund={fundSession}
                onSweep={sweepSession}
              />
            ) : undefined
          }
        />
      )}
    </div>
  );
}

/** Lo que el usuario tiene que hacer antes de poder pintar, si algo falta. */
function Blocker({
  mode,
  sender,
  busy,
  burnerAddress,
  onConnect,
}: {
  mode: WalletMode | null;
  sender: SenderState | null;
  busy: boolean;
  burnerAddress: `0x${string}`;
  onConnect: () => void;
}) {
  if (!sender || sender.blocked === null) return null;

  if (sender.blocked === "sin-wallet") {
    return (
      <div className="notice notice-warn">
        No se detectó ninguna wallet en este navegador. Ábrelo desde el
        navegador de tu wallet, o cambia a la wallet de la app.
      </div>
    );
  }

  if (sender.blocked === "conectar") {
    return (
      <div className="notice">
        Conecta tu wallet para pintar desde tu propia dirección.
        <br />
        <button className="notice-action" onClick={onConnect} disabled={busy}>
          {busy ? "Conectando…" : "Conectar wallet"}
        </button>
      </div>
    );
  }

  // sin-fondos. El caso de "session" lo cubre SessionCard, que trae selector
  // de monto y dirección de destino.
  if (mode === "app") {
    return (
      <div className="notice notice-warn">
        Esta wallet no tiene fondos. Pide MON en{" "}
        <a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">
          faucet.monad.xyz
        </a>{" "}
        para esta dirección:
        <br />
        <code className="mono">{burnerAddress}</code>
      </div>
    );
  }

  return (
    <div className="notice notice-warn">
      Tu wallet no tiene MON de testnet. Pide en{" "}
      <a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">
        faucet.monad.xyz
      </a>
      .
    </div>
  );
}

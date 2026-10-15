import type { PainterState } from "../lib/painter";
import { formatMon } from "../lib/painter";
import type { RelayStats, RelayStatus } from "../lib/relay";

interface Props {
  painter: PainterState | null;
  stats: RelayStats | null;
  status: RelayStatus;
  pending: number;
  lastLatencyMs: number | null;
  origin: string;
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function StatusBar({
  painter,
  stats,
  status,
  pending,
  lastLatencyMs,
  origin,
}: Props) {
  const lowBalance = painter !== null && painter.paintsLeft < 10;

  return (
    <header className="status">
      <div className="status-row">
        <span className="mono">
          {painter ? short(painter.address) : "cargando…"}
        </span>
        <span className={`dot dot-${status}`} title={`relay: ${status}`} />
        <span className="muted">{status}</span>
      </div>

      <div className="status-row">
        {painter && (
          <span className={lowBalance ? "warn" : "muted"}>
            {formatMon(painter.balanceWei)} MON · {painter.paintsLeft} píxeles
          </span>
        )}
        {pending > 0 && <span className="pending">{pending} en vuelo</span>}
        {lastLatencyMs !== null && (
          <span className="latency">⚡ {lastLatencyMs} ms</span>
        )}
      </div>

      {stats && (
        <div className="status-row muted small">
          <span>{stats.tps} TPS</span>
          <span>pico {stats.peakTps}</span>
          <span>{stats.painted} pintados</span>
          <span>{stats.clients} conectados</span>
        </div>
      )}

      {origin === "nueva" && painter?.paintsLeft === 0 && (
        <div className="banner">
          Esta wallet es nueva y no tiene fondos. Mándale MON a{" "}
          <code className="mono">{painter.address}</code> o entra con un QR
          pre-fondeado.
        </div>
      )}

      {painter?.lastError && <div className="banner error">{painter.lastError}</div>}
    </header>
  );
}

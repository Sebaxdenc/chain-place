import { CONFIG } from "../config";
import { formatMon } from "../lib/painter";
import { MODE_LABEL, type SenderState, type WalletMode } from "../lib/sender";
import type { RelayStats, RelayStatus } from "../lib/relay";
import { IconBolt, IconSliders } from "./Icon";

interface Props {
  sender: SenderState | null;
  stats: RelayStats | null;
  status: RelayStatus;
  pending: number;
  lastLatencyMs: number | null;
  mode: WalletMode | null;
  onOpenModes: () => void;
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

const sourceLabel = (() => {
  if (CONFIG.mode === "directo") return "directo";
  try {
    return new URL(CONFIG.relayUrl).host;
  } catch {
    return CONFIG.relayUrl;
  }
})();

export function StatusBar({
  sender,
  stats,
  status,
  pending,
  lastLatencyMs,
  mode,
  onOpenModes,
}: Props) {
  const lowFunds = sender !== null && sender.ready && sender.paintsLeft < 10;

  return (
    <>
      <header className="topbar">
        <span className="wordmark">CHAIN&middot;PLACE</span>
        <span className="topbar-spacer" />

        {/* El estado se comunica con color Y con texto, nunca solo con color */}
        <span className={`conn conn-${status}`}>
          <span className="conn-dot" aria-hidden="true" />
          {status}
        </span>

        <button
          className="ghost-btn"
          onClick={onOpenModes}
          aria-label={`Cambiar modo. Actual: ${mode ? MODE_LABEL[mode] : "sin elegir"}`}
        >
          <IconSliders size={18} />
        </button>
      </header>

      <div className="metrics">
        <div className="metric">
          <span className="metric-value mono">
            {sender?.address ? short(sender.address) : "—"}
          </span>
          <span className="metric-label">
            {mode ? MODE_LABEL[mode] : "modo"}
          </span>
        </div>

        {sender && (
          <div className="metric">
            <span className={`metric-value${lowFunds ? " is-warn" : ""}`}>
              {formatMon(sender.balanceWei)}
            </span>
            <span className="metric-label">MON</span>
          </div>
        )}

        {sender && sender.ready && (
          <div className="metric">
            <span className={`metric-value${lowFunds ? " is-warn" : ""}`}>
              {sender.paintsLeft}
            </span>
            <span className="metric-label">píxeles</span>
          </div>
        )}

        {pending > 0 && (
          <div className="metric">
            <span className="metric-value">{pending}</span>
            <span className="metric-label">en vuelo</span>
          </div>
        )}

        {lastLatencyMs !== null && (
          <div className="metric">
            <span className="metric-value is-ok">
              <IconBolt size={12} /> {lastLatencyMs}
            </span>
            <span className="metric-label">ms</span>
          </div>
        )}

        {stats && (
          <>
            <div className="metric">
              <span className="metric-value">{stats.tps}</span>
              <span className="metric-label">tx/s</span>
            </div>
            <div className="metric">
              <span className="metric-value">{stats.painted}</span>
              <span className="metric-label">pintados</span>
            </div>
            <div className="metric">
              <span className="metric-value mono">{stats.block}</span>
              <span className="metric-label">bloque</span>
            </div>
          </>
        )}

        <div className="metric">
          <span className="metric-value mono">{sourceLabel}</span>
          <span className="metric-label">fuente</span>
        </div>
      </div>
    </>
  );
}

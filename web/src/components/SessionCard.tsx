import { useState } from "react";
import { formatEther, parseEther } from "viem";
import { CONFIG } from "../config";
import { formatMon } from "../lib/painter";
import { IconKey } from "./Icon";

interface Props {
  burnerAddress: `0x${string}`;
  walletAddress: `0x${string}` | null;
  balanceWei: bigint;
  paintsLeft: number;
  funded: boolean;
  busy: boolean;
  onFund: (amountWei: bigint) => void;
  onSweep: () => void;
}

/** Montos ofrecidos. Que el usuario elija, en vez de imponerle una cifra. */
const AMOUNTS = ["0.5", "2", "5"] as const;

/** Coste aproximado de un píxel al base fee mínimo (100 MON-gwei).
 *  Solo sirve para el "~N píxeles" informativo. */
const APPROX_COST_PER_PAINT = CONFIG.paintGas * 100_000_000_000n;

function approxPaints(amountWei: bigint): number {
  return Number(amountWei / APPROX_COST_PER_PAINT);
}

/**
 * Gestión de la clave de sesión.
 *
 * Esta pantalla existe por una razón concreta: el paso de fondear la sesión
 * consiste en "manda MON a esta dirección", que es exactamente la forma que
 * tiene un drenador de wallets. La diferencia entre una app legítima y un
 * fraude no está en el flujo, sino en que el usuario **entienda qué está
 * firmando y pueda recuperar su dinero**.
 *
 * De ahí las cuatro cosas: dirección de destino completa y a la vista, dónde
 * vive la clave, monto a elección, y un botón para devolver el saldo.
 */
export function SessionCard({
  burnerAddress,
  walletAddress,
  balanceWei,
  paintsLeft,
  funded,
  busy,
  onFund,
  onSweep,
}: Props) {
  const [amount, setAmount] = useState<string>("2");

  return (
    <div className="session-card">
      <div className="session-head">
        <span className="mode-icon" aria-hidden="true">
          <IconKey size={20} />
        </span>
        <div>
          <div className="session-title">Tu clave de sesión</div>
          <p className="session-note">
            Es una clave que vive <strong>solo en este navegador</strong>. La
            fondeas una vez desde tu wallet y después pintas sin confirmar cada
            píxel. El saldo sigue siendo tuyo: puedes devolverlo cuando quieras.
          </p>
        </div>
      </div>

      {/* La dirección completa y seleccionable. El usuario tiene derecho a
          saber a dónde va su dinero antes de firmar. */}
      <div className="session-field">
        <span className="session-label">Destino de los fondos</span>
        <code className="session-address mono">{burnerAddress}</code>
      </div>

      {walletAddress && (
        <div className="session-field">
          <span className="session-label">Devolución a tu wallet</span>
          <code className="session-address mono">{walletAddress}</code>
        </div>
      )}

      {funded ? (
        <>
          <div className="session-field">
            <span className="session-label">Saldo de la sesión</span>
            <span className="session-balance">
              {formatMon(balanceWei)} MON
              <span className="muted"> · ~{paintsLeft} píxeles</span>
            </span>
          </div>
          <button
            className="notice-action session-wide"
            onClick={onSweep}
            disabled={busy || !walletAddress}
          >
            {busy ? "Devolviendo…" : "Devolver el saldo a mi wallet"}
          </button>
          <p className="session-note muted">
            Si acabas de pintar, espera un segundo: Monad no deja vaciar una
            cuenta que tiene transacciones en vuelo.
          </p>
        </>
      ) : (
        <>
          <div className="session-field">
            <span className="session-label">Cuánto quieres fondear</span>
            <div className="amount-row" role="radiogroup" aria-label="Monto">
              {AMOUNTS.map((value) => (
                <button
                  key={value}
                  className="amount-btn"
                  onClick={() => setAmount(value)}
                  aria-pressed={amount === value}
                >
                  <span className="amount-value">{value} MON</span>
                  <span className="amount-sub">
                    ~{approxPaints(parseEther(value))} px
                  </span>
                </button>
              ))}
            </div>
          </div>

          <button
            className="notice-action session-wide"
            onClick={() => onFund(parseEther(amount))}
            disabled={busy}
          >
            {busy
              ? "Fondeando…"
              : `Fondear ${amount} MON desde mi wallet`}
          </button>
          <p className="session-note muted">
            Una sola transacción de {amount} MON (
            {formatEther(parseEther(amount))} MON exactos) más el gas. Después
            no te vuelve a pedir nada.
          </p>
        </>
      )}
    </div>
  );
}

import { useEffect, useRef } from "react";
import type { WalletMode } from "../lib/sender";
import { IconDevice, IconWallet, IconKey, IconCheck } from "./Icon";

interface Props {
  current: WalletMode | null;
  walletAvailable: boolean;
  onSelect: (mode: WalletMode) => void;
  onClose: () => void;
  /** Si es la primera vez, no se puede cerrar sin elegir. */
  dismissible: boolean;
  /** Contenido extra bajo la lista, p. ej. la gestión de la sesión. */
  footer?: React.ReactNode;
}

interface ModeInfo {
  mode: WalletMode;
  name: string;
  badge?: { text: string; tone: "ok" | "warn" };
  desc: string;
  icon: typeof IconDevice;
  needsWallet: boolean;
}

const MODES: ModeInfo[] = [
  {
    mode: "session",
    name: "Clave de sesión",
    badge: { text: "recomendado", tone: "ok" },
    desc: "Conectas tu wallet y una sola transacción fondea una clave local. Después pintas sin confirmar nada.",
    icon: IconKey,
    needsWallet: true,
  },
  {
    mode: "wallet",
    name: "Mi wallet",
    badge: { text: "1 firma por píxel", tone: "warn" },
    desc: "Cada píxel sale de tu propia dirección, verificable en el explorador. A cambio, tu wallet pide confirmación cada vez.",
    icon: IconWallet,
    needsWallet: true,
  },
  {
    mode: "app",
    name: "Wallet de la app",
    desc: "El navegador te crea una wallet. No necesitas instalar nada, pero hay que fondearla desde el faucet.",
    icon: IconDevice,
    needsWallet: false,
  },
];

export function ModePicker({
  current,
  walletAvailable,
  onSelect,
  onClose,
  dismissible,
  footer,
}: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Mover el foco a la hoja al abrirla, y devolver Escape. Sin esto, quien
  // navega con teclado queda atrapado detrás del scrim.
  useEffect(() => {
    sheetRef.current?.focus();
    if (!dismissible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissible, onClose]);

  return (
    <div
      className="sheet-backdrop"
      onClick={dismissible ? onClose : undefined}
      role="presentation"
    >
      <div
        className="sheet"
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mode-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="sheet-title" id="mode-title">
          ¿Cómo quieres pintar?
        </h2>
        <p className="sheet-sub">
          Puedes cambiarlo en cualquier momento.
        </p>

        <div className="mode-list">
          {MODES.map((info) => {
            const blocked = info.needsWallet && !walletAvailable;
            const Icon = info.icon;
            const selected = current === info.mode;

            return (
              <button
                key={info.mode}
                className="mode-card"
                onClick={() => onSelect(info.mode)}
                disabled={blocked}
                aria-pressed={selected}
              >
                <span className="mode-icon">
                  <Icon size={22} />
                </span>
                <span className="mode-body">
                  <span className="mode-name">
                    {info.name}
                    {info.badge && (
                      <span className={`badge badge-${info.badge.tone}`}>
                        {info.badge.text}
                      </span>
                    )}
                  </span>
                  <span className="mode-desc">
                    {blocked
                      ? "No se detectó ninguna wallet en este navegador. Ábrelo desde el navegador de tu wallet, o usa la wallet de la app."
                      : info.desc}
                  </span>
                </span>
                {selected && (
                  <span className="mode-icon" aria-hidden="true">
                    <IconCheck size={18} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {footer}

        {dismissible && (
          <button className="sheet-close" onClick={onClose}>
            Cerrar
          </button>
        )}
      </div>
    </div>
  );
}

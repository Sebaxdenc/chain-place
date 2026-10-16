import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";
import type { WalletMode } from "./sender";

const KEY = "chain-place:pk";
const KEY_HISTORY = "chain-place:pk-history";
const MODE = "chain-place:mode";

export type WalletOrigin = "qr" | "almacenada" | "nueva";

export interface BurnerWallet {
  account: PrivateKeyAccount;
  origin: WalletOrigin;
}

function isPrivateKey(value: string | null | undefined): value is `0x${string}` {
  return !!value && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Guarda la clave actual, conservando la anterior en un historial.
 *
 * Esto arregla un fallo real: antes, entrar con una clave nueva (por ejemplo
 * escaneando un QR) PISABA la guardada sin avisar. Si esa wallet anterior
 * tenía MON, su clave se perdía para siempre y los fondos quedaban atrapados
 * en una dirección inaccesible.
 *
 * El historial es barato (una clave son 66 caracteres) y evita destruir fondos
 * en silencio, que es de las peores cosas que puede hacer una app de este tipo.
 */
function storeKey(next: `0x${string}`): void {
  const previous = localStorage.getItem(KEY);
  if (isPrivateKey(previous) && previous !== next) {
    let history: string[] = [];
    try {
      const raw = localStorage.getItem(KEY_HISTORY);
      if (raw) history = JSON.parse(raw) as string[];
    } catch {
      history = [];
    }
    if (!history.includes(previous)) {
      history.push(previous);
      // Nos quedamos con las últimas 10; más que eso no aporta nada.
      localStorage.setItem(KEY_HISTORY, JSON.stringify(history.slice(-10)));
    }
  }
  localStorage.setItem(KEY, next);
}

/**
 * Resuelve la wallet del navegador, en este orden:
 *
 *   1. `#pk=0x...` en la URL — el flujo del QR pre-fondeado
 *   2. localStorage — si ya habías entrado antes
 *   3. una clave nueva — no tendrá fondos
 *
 * Importante: solo se crea una clave la PRIMERA vez. En visitas posteriores se
 * reutiliza la misma, que es lo que permite fondearla una vez y seguir
 * pintando después.
 */
export function resolveBurner(): BurnerWallet {
  const fromUrl = readKeyFromUrl();
  if (fromUrl) {
    storeKey(fromUrl);
    return { account: privateKeyToAccount(fromUrl), origin: "qr" };
  }

  const stored = localStorage.getItem(KEY);
  if (isPrivateKey(stored)) {
    return { account: privateKeyToAccount(stored), origin: "almacenada" };
  }

  const fresh = generatePrivateKey();
  storeKey(fresh);
  return { account: privateKeyToAccount(fresh), origin: "nueva" };
}

/**
 * Lee la clave del fragmento de la URL y **la borra inmediatamente** de la
 * barra de direcciones con replaceState.
 *
 * Si la clave se queda en la URL acaba en el historial del navegador, en
 * capturas de pantalla y en cualquier enlace que alguien comparta sin darse
 * cuenta. Se usa el fragmento (`#`) y no un query param (`?`) porque el
 * fragmento no se manda al servidor ni aparece en sus logs de acceso.
 */
function readKeyFromUrl(): `0x${string}` | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const candidate = params.get("pk");
  if (!isPrivateKey(candidate)) return null;

  history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
  return candidate;
}

/** Claves anteriores, por si hay que recuperar fondos de una wallet pisada. */
export function keyHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY_HISTORY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function loadMode(): WalletMode | null {
  const stored = localStorage.getItem(MODE);
  return stored === "app" || stored === "wallet" || stored === "session"
    ? stored
    : null;
}

export function saveMode(mode: WalletMode): void {
  localStorage.setItem(MODE, mode);
}

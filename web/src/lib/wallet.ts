import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";

const STORAGE_KEY = "chain-place:pk";

export type WalletOrigin = "qr" | "almacenada" | "nueva";

export interface BurnerWallet {
  account: PrivateKeyAccount;
  origin: WalletOrigin;
}

function isPrivateKey(value: string | null | undefined): value is `0x${string}` {
  return !!value && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Resuelve la wallet del navegador, en este orden:
 *
 *   1. `#pk=0x...` en la URL — el flujo del QR pre-fondeado
 *   2. localStorage — si ya habías entrado antes
 *   3. una clave nueva — no tendrá fondos, hay que fondearla
 *
 * Esto es lo que hace el modo QR: el asistente escanea, la clave se guarda y
 * ya puede pintar. Cero instalación de wallet, cero faucet en el momento.
 */
export function resolveBurner(): BurnerWallet {
  const fromUrl = readKeyFromUrl();
  if (fromUrl) {
    localStorage.setItem(STORAGE_KEY, fromUrl);
    return { account: privateKeyToAccount(fromUrl), origin: "qr" };
  }

  const stored = localStorage.getItem(STORAGE_KEY);
  if (isPrivateKey(stored)) {
    return { account: privateKeyToAccount(stored), origin: "almacenada" };
  }

  const fresh = generatePrivateKey();
  localStorage.setItem(STORAGE_KEY, fresh);
  return { account: privateKeyToAccount(fresh), origin: "nueva" };
}

/**
 * Lee la clave del fragmento de la URL y **la borra inmediatamente** de la
 * barra de direcciones con replaceState.
 *
 * Esto importa: si la clave se queda en la URL acaba en el historial del
 * navegador, en capturas de pantalla y en cualquier enlace que el asistente
 * comparta por WhatsApp sin darse cuenta. Usamos el fragmento (`#`) y no un
 * query param (`?`) precisamente porque el fragmento no se manda al servidor
 * ni aparece en los logs de acceso.
 */
function readKeyFromUrl(): `0x${string}` | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const candidate = params.get("pk");
  if (!isPrivateKey(candidate)) return null;

  history.replaceState(null, "", window.location.pathname + window.location.search);
  return candidate;
}

/** Olvida la wallet actual y genera otra. Útil para probar el flujo del QR. */
export function resetBurner(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Exporta la clave para generar el QR de esta sesión.
 *  Solo se usa en la pantalla de ajustes, nunca se muestra sin pedirlo. */
export function exportKey(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

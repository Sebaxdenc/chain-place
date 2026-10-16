import type { EIP1193Provider } from "viem";
import { numberToHex } from "viem";
import { CONFIG } from "../config";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const CHAIN_ID_HEX = numberToHex(CONFIG.chain.id); // 10143 -> 0x279f

export function getInjected(): EIP1193Provider | null {
  return typeof window !== "undefined" && window.ethereum ? window.ethereum : null;
}

export function hasInjected(): boolean {
  return getInjected() !== null;
}

/** Pide las cuentas al usuario. Abre la ventana de la wallet. */
export async function connectInjected(): Promise<`0x${string}`> {
  const provider = getInjected();
  if (!provider) throw new Error("No se detectó ninguna wallet en el navegador");

  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as `0x${string}`[];

  const address = accounts[0];
  if (!address) throw new Error("La wallet no devolvió ninguna cuenta");

  await ensureMonadChain(provider);
  return address;
}

/**
 * Deja la wallet apuntando a Monad. Si la red no está dada de alta, la añade.
 *
 * OJO con los `rpcUrls`: aquí va el RPC PÚBLICO a propósito, nunca el endpoint
 * privado de Alchemy. Esto se guarda en la configuración de la wallet de cada
 * usuario, así que meter la clave privada de Alchemy la repartiría a todo el
 * auditorio y nos agotaría la cuota. El RPC dedicado se usa solo en nuestro
 * propio cliente.
 */
export async function ensureMonadChain(provider: EIP1193Provider): Promise<void> {
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current.toLowerCase() === CHAIN_ID_HEX.toLowerCase()) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (error) {
    // 4902 = la cadena no está en la wallet. Cualquier otro error se propaga
    // (por ejemplo 4001, que es el usuario cancelando).
    if ((error as { code?: number }).code !== 4902) throw error;

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_ID_HEX,
          chainName: CONFIG.chain.name,
          nativeCurrency: CONFIG.chain.nativeCurrency,
          rpcUrls: ["https://testnet-rpc.monad.xyz"],
          blockExplorerUrls: ["https://testnet.monadexplorer.com"],
        },
      ],
    });
  }
}

/** Manda MON desde la wallet del usuario a otra dirección. Una sola ventana.
 *  Es el paso que fondea la clave de sesión. */
export async function sendValue(
  from: `0x${string}`,
  to: `0x${string}`,
  valueWei: bigint,
): Promise<`0x${string}`> {
  const provider = getInjected();
  if (!provider) throw new Error("No se detectó ninguna wallet en el navegador");

  await ensureMonadChain(provider);

  return (await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to,
        value: numberToHex(valueWei),
        // 21.000 es el coste exacto de una transferencia nativa. Lo fijamos
        // porque en Monad se cobra el gas limit, no el gas usado: dejar que la
        // wallet ponga un margen grande se lo cobraría al usuario.
        gas: numberToHex(21_000),
      },
    ],
  })) as `0x${string}`;
}

/** Avisa cuando el usuario cambia de cuenta o de red en su wallet.
 *  Sin esto, seguiríamos firmando con una cuenta que ya no está activa. */
export function watchInjected(onChange: () => void): () => void {
  const provider = getInjected();
  if (!provider) return () => {};

  const handler = () => onChange();
  provider.on?.("accountsChanged", handler);
  provider.on?.("chainChanged", handler);

  return () => {
    provider.removeListener?.("accountsChanged", handler);
    provider.removeListener?.("chainChanged", handler);
  };
}

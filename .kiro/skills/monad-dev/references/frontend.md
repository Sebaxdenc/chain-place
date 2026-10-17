# Frontend con viem en Monad

Requiere **viem >= 2.40.0**, que es cuando entraron las cadenas de Monad:

```ts
import { monad, monadTestnet } from "viem/chains";
// monadTestnet.id === 10143 · monad.id === 143
```

## Una transacción = una llamada RPC

Un `sendTransaction` normal hace **cuatro** llamadas:

```
eth_estimateGas + eth_getTransactionCount + eth_feeHistory + eth_sendRawTransaction
```

Con 50 usuarios activos eso es 4x el tráfico contra un RPC que aguanta 15-25
req/s. En Monad se puede bajar a **una**, y conviene:

```ts
// 1. GAS FIJO, medido con forge. No estimado en caliente.
//    En Monad se cobra el límite, así que además debe ser ajustado.
const GAS = 95_000n;

// 2. NONCE LOCAL con incremento optimista: permite ráfagas sin consultar.
let nonce = await client.getTransactionCount({ address, blockTag: "pending" });

// 3. FEES EN CACHÉ, refrescadas en segundo plano (ver el aviso de abajo).
let maxFeePerGas = 0n, maxPriorityFeePerGas = 0n;

async function send(data: `0x${string}`) {
  // 4. FIRMA 100% LOCAL: cero llamadas RPC. [medido] ~3,5 ms.
  const serializedTransaction = await account.signTransaction({
    to: CONTRATO,
    data,
    chainId: monadTestnet.id,
    nonce: nonce++,            // reservado de forma sincrónica
    gas: GAS,
    maxFeePerGas,
    maxPriorityFeePerGas,
    value: 0n,
    type: "eip1559",
  });

  // La única llamada del camino caliente.
  return client.sendRawTransaction({ serializedTransaction });
}
```

Para comprobar que la firma no toca la red, fírmala sin transporte configurado:
si algo intentara un RPC, fallaría.

## ⚠️ Las fees en caché de viem provocan rechazos aleatorios

Este es un bug sutil y difícil de diagnosticar.

`estimateFeesPerGas()` de viem devuelve `maxFeePerGas = baseFee * 1.2 + tip`.
**[medido]** con base fee en el mínimo: `maxFeePerGas: 122 gwei`,
`maxPriorityFeePerGas: 2 gwei`, `baseFeePerGas: 100 gwei`.

Si cacheas las fees unos segundos para no gastar una llamada por transacción,
el problema es que **el controlador de base fee de Monad sube hasta ~3,6% por
bloque**. Tres segundos son ~10 bloques, o sea hasta **1,42x** de subida. Un
techo de 1,2x no lo cubre, y la transacción se rechaza **según cómo se haya
movido el base fee** — intermitente, imposible de reproducir a voluntad.

**Arreglo:**

```ts
const fees = await client.estimateFeesPerGas();
const tip = fees.maxPriorityFeePerGas;
const base = fees.maxFeePerGas - tip;
maxPriorityFeePerGas = tip;
maxFeePerGas = base * 2n + tip;      // 2x cubre 3 s de subida máxima
```

**Subir el techo es gratis en dinero**: en EIP-1559 pagas `base + priority`, y
`maxFeePerGas` es solo un límite superior. Esto **no** es como el gas limit.

Pero **no es gratis en concurrencia**: Reserve Balance presupuesta las
transacciones en vuelo como `gas_bid * gas_limit`, así que un techo más alto
reduce cuántas caben a la vez. Ver `reserve-balance.md`.

## ⚠️ Los errores de viem engañan

viem usa **el mismo texto** `"Missing or invalid parameters."` para dos códigos
distintos:

- `-32602` → parámetros realmente mal formados
- `-32000` → **el genérico que los nodos devuelven para cualquier rechazo de
  transacción** (nonce, saldo, fee, reserve balance...)

Y `error.message` incluye la URL y el cuerpo entero de la petición, así que el
motivo real queda sepultado. **Está en `error.details`.**

```ts
function describeError(error: unknown): string {
  const err = error as {
    details?: string; shortMessage?: string; message?: string; code?: number;
    cause?: { message?: string; details?: string };
  };
  // 4001 es el código EIP-1193 de "el usuario canceló". No es un fallo.
  if (err.code === 4001) return "Cancelaste la transacción";
  const detail = err.details ?? err.cause?.details ?? err.cause?.message;
  return (detail ?? err.shortMessage ?? err.message ?? String(error))
    .split("\n")[0]!.slice(0, 160);
}
```

Mensajes reales que vas a ver **[medido]**: `Signer had insufficient balance`,
`Transaction fee too low`, `eth_getLogs is limited to a 100 range`.

## Huecos de nonce

Con nonce local optimista, **cualquier envío fallido deja un hueco**: reservaste
el número y nadie lo va a usar. Las siguientes transacciones quedan con nonce
futuro y se rechazan en cascada.

**Resincroniza ante cualquier fallo**, no solo si el mensaje menciona el nonce
(el texto depende del nodo y es poco fiable):

```ts
catch (error) {
  await resyncNonce().catch(() => {});   // cuesta 1 RPC solo en el error
  throw error;
}
```

## Conectar wallets inyectadas (EIP-1193)

```ts
declare global { interface Window { ethereum?: EIP1193Provider } }

const accounts = await provider.request({ method: "eth_requestAccounts" });
```

Para dejar la wallet en Monad, con alta de la red si no la tiene:

```ts
const CHAIN_ID_HEX = numberToHex(10143);   // 0x279f

const current = await provider.request({ method: "eth_chainId" });
if (current.toLowerCase() !== CHAIN_ID_HEX.toLowerCase()) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (error) {
    // 4902 = la cadena no está dada de alta. Otros errores se propagan
    // (4001 es el usuario cancelando).
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: CHAIN_ID_HEX,
        chainName: "Monad Testnet",
        nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
        rpcUrls: ["https://testnet-rpc.monad.xyz"],   // ⚠️ ver abajo
        blockExplorerUrls: ["https://testnet.monadexplorer.com"],
      }],
    });
  }
}
```

> ### ⚠️ En `wallet_addEthereumChain` usa el RPC PÚBLICO
>
> Esa configuración **se guarda en la wallet de cada usuario**. Si pones ahí tu
> endpoint privado de Alchemy, reparte tu clave a todos tus usuarios y te agota
> la cuota. El RPC dedicado se usa solo en tu propio cliente.

Y escucha los cambios, porque seguir firmando con una cuenta que el usuario ya
cambió falla en silencio:

```ts
provider.on?.("accountsChanged", onChange);
provider.on?.("chainChanged", onChange);
```

## Patrones de wallet para apps interactivas

Si tu app manda **muchas** transacciones (un juego, un lienzo, un bot), la
wallet inyectada abre **una ventana emergente por transacción**, lo que la hace
injugable. Tres modos, y conviene ofrecer más de uno:

| Modo | Firmas | Cuándo |
|---|---|---|
| **Wallet directa** | 1 por tx | Cuando importa que la tx salga de la dirección real del usuario (demos, auditoría) |
| **Clave de sesión** | 1 en total | El práctico: una tx de la wallet fondea una clave local, y después se firma local sin ventanas |
| **Clave local** | 0 | Para quien no tiene wallet; hay que fondearla del faucet |

La clave de sesión se implementa con una clave generada en el navegador
(`generatePrivateKey` de viem) guardada en `localStorage`, y una transferencia
nativa desde la wallet del usuario.

### Dos cosas que hay que hacer bien

**1. Nunca pises una clave guardada sin conservarla.** Si la app genera o
importa una clave nueva encima de una que tenía fondos, esos fondos quedan
atrapados en una dirección inaccesible para siempre. Guarda un historial antes
de sobrescribir.

**2. Haz el fondeo transparente.** "Manda MON a esta dirección" es literalmente
la forma de un drenador de wallets. Lo que distingue una app legítima no es el
flujo, es que el usuario vea a dónde va su dinero y pueda recuperarlo: dirección
de destino completa y sin truncar, explicación de dónde vive la clave, monto a
elección, y un botón para devolver el saldo (ver `reserve-balance.md` sobre las
condiciones para vaciar una cuenta).

### Si pasas la clave por URL

Usa el **fragmento** (`#pk=...`), nunca un query param: el fragmento no se
manda al servidor ni aparece en sus logs. Y **bórralo de la barra de direcciones
en cuanto lo leas**:

```ts
history.replaceState(null, "", location.pathname + location.search);
```

Si se queda, acaba en el historial del navegador, en capturas de pantalla y en
cualquier enlace que el usuario comparta sin darse cuenta.

## Variables de entorno en el build

En Vite (y equivalentes), **todo lo que empieza por `VITE_` queda embebido en el
JavaScript** que descarga cualquiera. Se puede comprobar:

```bash
curl -s https://tu-app/assets/index-*.js | grep -o 'TU_VALOR'
```

**Ninguna variable `VITE_` puede ser secreta.** Para una clave de RPC en el
frontend el secreto es imposible, así que la protección es **restringirla por
dominio** en el panel del proveedor (Alchemy y QuickNode lo permiten).

## Fuentes

- [EIP-1559 en Monad](https://docs.monad.xyz/developer-essentials/gas-on-monad)
- [Guía para wallets](https://docs.monad.xyz/developer-essentials/wallet-developers)
- [EIP-7702 en Monad](https://docs.monad.xyz/developer-essentials/summary)

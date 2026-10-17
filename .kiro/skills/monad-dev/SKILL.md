---
name: monad-dev
description: Desarrollar y desplegar en Monad (EVM paralela, bloques de 300ms). Úsala al escribir o desplegar contratos en Monad, configurar Foundry para Monad, estimar gas, diseñar storage para ejecución paralela, montar frontends con viem que manden transacciones, consumir datos en tiempo real por WebSocket, o desplegar dapps de Monad. Cubre las diferencias que rompen código que funciona en Ethereum: el gas se cobra por gas_limit y no por gas usado, el storage se calienta por páginas de 128 slots, Reserve Balance limita las transacciones en vuelo, eth_getLogs está topado a 100 bloques, y no hay mempool global. Incluye números de gas medidos y errores documentados en los docs oficiales.
license: MIT
metadata:
  version: "1.0"
  verified-against: Monad mainnet v0.16.1 / testnet v0.16.2 (MONAD_TEN), Foundry 1.8.5, viem 2.57
---

# Desarrollar en Monad

Monad es EVM-compatible pero **cuatro cosas rompen código que funciona en
Ethereum**. Si solo lees una sección, que sea esta.

## Las cuatro trampas

| # | Qué | Consecuencia si lo ignoras |
|---|---|---|
| 1 | **El gas se cobra por `gas_limit`, no por gas usado.** Sin reembolsos. | Un límite inflado se lo paga el usuario entero |
| 2 | **El storage se calienta por páginas de 128 slots** (8.100 gas/página, no 2.100/slot) | Mides el gas con el modelo de Ethereum, fijas el límite bajo, y **todas las tx fallan por out-of-gas** |
| 3 | **Reserve Balance**: el presupuesto de gas de las tx en vuelo de una cuenta es `min(10 MON, saldo)` | Ráfagas de transacciones rechazadas; imposible vaciar una cuenta con poco saldo |
| 4 | **No hay mempool global** y `eth_getLogs` está topado a **100 bloques** (30 s de historia) | Indexadores que intentan rellenar huecos con logs no funcionan |

## Datos de red

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | `10143` | `143` |
| RPC | `https://testnet-rpc.monad.xyz` | `https://rpc.monad.xyz` |
| WebSocket | `wss://testnet-rpc.monad.xyz` | `wss://rpc.monad.xyz` |
| Faucet | `https://faucet.monad.xyz` | — |
| Explorador | `https://testnet.monadexplorer.com` | MonadVision / Monadscan |

**Rendimiento:** bloques de 300 ms · finalidad especulativa 300 ms (1 slot) ·
finalidad 600 ms (2 slots) · límite de bloque 150M gas · límite por tx 30M gas
· base fee mínimo 100 MON-gwei · 10.000+ TPS de capacidad de diseño.

Los bloques se producen **por reloj, no por demanda**: si nadie transacciona se
producen bloques vacíos igual. Medido: 3-4 bloques comparten el mismo
`TIMESTAMP`, que tiene granularidad de segundos.

Fuente canónica, prefiérela siempre a la memoria:
<https://docs.monad.xyz/ai/current-facts>

## Versiones mínimas

```
foundry  >= 1.8.0    (trae el entorno de ejecución de Monad)
viem     >= 2.40.0   (trae las cadenas monad / monadTestnet)
```

## Lo primero al abrir un proyecto Foundry

```toml
# foundry.toml
[profile.default]
network = "monad"
```

**Sin esta línea `forge test --gas-report` te da el gas de Ethereum.** Medido
sobre el mismo contrato:

```
modelo Monad      62.271 gas  ->  límite de tx 83.271
modelo Ethereum   50.987 gas  ->  límite de tx 71.987
```

Si configuras con el modelo de Ethereum fijas 72.000 y **todas las
transacciones mueren por out-of-gas**. Comprueba siempre que esa línea está.

## Reglas de decisión rápidas

**Diseñando storage de un contrato** → lee `references/gas-and-storage.md`.
Resumen: un slot por entidad en vez de empaquetar varias, declara los arrays
primero para alinearlos a página, y nunca pongas contadores globales ni
acumules `msg.value` en el camino caliente.

**Fijando el gas de una transacción** → mide con `forge test` y fíjalo a mano.
Nunca `eth_estimateGas` en el camino caliente. Añade margen con criterio: el
margen **se paga entero**.

**Fijando `maxFeePerGas`** → sé generoso, es **gratis** (pagas `base + tip`; el
máximo es solo un techo). Pero ojo, consume presupuesto de Reserve Balance.
Ver `references/frontend.md`.

**Una cuenta manda muchas tx seguidas** → lee
`references/reserve-balance.md`. El presupuesto en vuelo es `min(10 MON,
saldo)` dividido entre `gas_bid * gas_limit` por tx.

**Vaciar una cuenta / devolver un saldo** → necesita ser una "transacción que
vacía la cuenta": sin delegación EIP-7702 y **sin otra tx del mismo remitente
en los k=3 bloques previos** (~1,2 s). Ver `references/reserve-balance.md`.

**Montando un indexador o datos en vivo** → lee
`references/rpc-and-realtime.md`. No uses `newPendingTransactions` (no
existe), no rellenes huecos con `eth_getLogs` (topado a 100 bloques), y
considera `monadLogs` para recibir en estado *Proposed* con avance de consenso.

**Frontend que manda transacciones** → lee `references/frontend.md`. Incluye el
patrón de **una sola llamada RPC por transacción** y por qué las fees en caché
de viem provocan rechazos aleatorios.

**Desplegando o verificando** → lee `references/foundry.md` (incluye dos
errores en la documentación oficial) y `references/deployment.md` (hosting,
límites de Vercel, avisos de phishing).

## Errores que cuestan horas

- **`eth_estimateGas` por transacción** en el camino caliente. Mide una vez,
  fija el número.
- **Medir gas sin `network = "monad"`**. Da números de Ethereum.
- **Empaquetar varias entidades por slot** "para ahorrar gas". Mata el
  paralelismo: dos escrituras al mismo slot entran en conflicto y se
  re-ejecutan en serie.
- **Rellenar huecos de un indexador con `eth_getLogs`**. Topado a 100 bloques.
  Re-lee el estado del contrato.
- **Meter tu RPC privado en `wallet_addEthereumChain`**. Se guarda en la wallet
  de cada usuario: reparte tu clave y agota tu cuota.
- **Creer que un error de viem dice la verdad**. Usa el mismo texto para
  `-32602` y `-32000`; el motivo real está en `error.details`.
- **Usar el RPC público con público de verdad**. Aguanta 15-25 req/s.

## Referencias

| Archivo | Cuándo leerlo |
|---|---|
| `references/gas-and-storage.md` | Diseñar contratos, estimar gas, ejecución paralela |
| `references/reserve-balance.md` | Ráfagas de tx, vaciar cuentas, EIP-7702 |
| `references/foundry.md` | Configurar, desplegar, verificar, keystores |
| `references/rpc-and-realtime.md` | Indexadores, WebSocket, estados de consenso |
| `references/frontend.md` | viem, firmar, fees, errores, wallets |
| `references/deployment.md` | Hosting, dominios, variables de entorno |

Los números marcados **[medido]** se obtuvieron ejecutando código contra
Monad; los marcados **[docs]** vienen de la documentación oficial.

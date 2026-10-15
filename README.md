# chain-place

Lienzo colaborativo on-chain sobre [Monad](https://monad.xyz). Cada píxel es una
transacción real, firmada por quien lo pinta, confirmada en ~600 ms. Pensado para
que un auditorio entero pinte a la vez desde sus celulares.

Un r/place en Ethereum es injugable: un píxel costaría dólares y tardaría
segundos. En Monad (bloques de 300 ms, finalidad de 600 ms, 10.000+ TPS de
capacidad de diseño) se convierte en un juego de verdad.

## Estado

| Paso | Qué | Estado |
|---|---|---|
| 1 | Contrato + tests + medición de gas | ✅ |
| 2 | Deploy a Monad testnet | ⏳ |
| 3 | Relay / indexer (WebSocket) | ⏳ |
| 4 | Frontend móvil (3 modos de wallet) | ⏳ |
| 5 | Vista proyector (TPS + etapas de consenso) | ⏳ |

## Estructura

```
chain-place/
├── contracts/     Foundry — BlitzCanvas.sol
├── relay/         (paso 3) indexer Node + fan-out WebSocket
└── web/           (paso 4-5) frontend móvil + vista proyector
```

## Arquitectura

El error que mata una demo así es poner 100 celulares a suscribirse al RPC
público: los límites son de 15–25 rps y te cortan en segundos.

La escritura va directa del celular al RPC (así cada píxel **es** una tx del
asistente, no de un relayer). La lectura va por **una sola** conexión upstream
que se reparte a todos:

```
                    ┌──────────────────────────┐
  1 sola conexión   │   Monad (300ms blocks)   │
  ws upstream       └────────────┬─────────────┘
                                 │ eth_subscribe(monadLogs)
                    ┌────────────┴─────────────┐
                    │  Relay / Indexer (Node)  │
                    │  Uint8Array(16384)       │
                    │  batch cada ~100 ms      │
                    └────────────┬─────────────┘
                     WS propio   │ fan-out
          ┌──────────┬───────────┼───────────┬──────────┐
       📱 burner   📱 burner   📱 burner   📱 ...    🖥️ proyector
          └──────────┴───────────┴───────────┴──────────┘
                     tx directa al RPC ──────────▶ Monad
```

Si usaras un relayer central para escribir, sus nonces secuenciales se vuelven
el embudo y pierdes el argumento entero del proyecto.

## Decisiones de diseño

### Un slot de storage por píxel

Es lo contrario de lo que harías en Ethereum, donde empaquetarías 32 píxeles por
slot para ahorrar gas. Aquí eso sería un desastre: Monad ejecuta en paralelo de
forma optimista y **re-ejecuta las transacciones que leyeron estado que una tx
anterior escribió**. Dos personas pintando píxeles vecinos escribirían el mismo
slot → conflicto → re-ejecución → el lienzo se serializa.

Pagamos más gas a cambio de paralelismo real. Por lo mismo: ningún contador
global (`totalPaints++` haría que *todas* las tx toquen el mismo slot) y pintar
es gratis (cobrar con `msg.value` convertiría el balance del contrato en un
punto caliente compartido). Las estadísticas se derivan de los eventos en el
indexador.

### El array va declarado primero, alineado a página

Monad calienta el storage en **páginas de 128 slots consecutivos** (8.100 gas por
página, no por slot). Como el lienzo es de 128 de ancho y el índice es
`y*128 + x`, **cada fila ocupa exactamente una página**. Declarando el array
primero, Solidity le asigna el slot 0 — múltiplo de 128 — y queda alineado.

Cualquier otra variable de storage antes del array lo desplazaría, cada fila
cruzaría dos páginas y los trazos costarían el doble en acceso en frío.

Medido con `forge test` (32 píxeles, misma tx, solo cambia la geometría):

| | gas total | por píxel |
|---|---|---|
| Fila (1 página) | 687.134 | 21.472 |
| Columna (32 páginas) | 1.011.889 | 31.621 |

La columna cuesta **47% más**.

## Números de gas verificados

Medidos con el modelo de ejecución de Monad activado (`network = "monad"`):

| | gas |
|---|---|
| `paint()` píxel virgen (slot nuevo) | 62.271 |
| `paint()` repintado (slot existente) | 35.271 |
| **Gas limit para la tx** (+21k intrínseco) | **83.271** |
| **A fijar en el frontend** (+15% margen) | **95.000** |

A base fee mínimo (100 MON-gwei) un píxel cuesta **~0.0083 MON**, así que
**0.5 MON solo da para ~60 píxeles**. Fondea cada celular con **2–3 MON** en
testnet.

> ⚠️ Con el modelo de gas de Ethereum el mismo test da 71.987. Si configuras
> Foundry sin `network = "monad"` fijarías ese límite y **todas las
> transacciones fallarían con out-of-gas**. El storage en Monad cuesta ~4x el de
> Ethereum en acceso en frío.

## Trampas de Monad que afectan a este proyecto

1. **Se cobra el `gas_limit`, no el gas usado, y no hay reembolsos.**
   Un límite inflado se lo paga el usuario. Fija el gas a mano, medido.

2. **Reserve Balance.** Consenso trabaja con un estado retrasado k=3 bloques
   (~1.2 s), así que el presupuesto de gas de las tx *en vuelo* de una cuenta es
   `min(10 MON, balance)`. La excepción de "transacción que vacía la cuenta"
   solo aplica si no hay otra tx del mismo remitente en los 3 bloques previos —
   justo lo contrario de alguien tocando rápido. Fondear con 2–3 MON lo
   resuelve.

3. **No hay mempool global** y los full nodes **no sirven estado histórico
   arbitrario**. El feed en vivo lee logs, no el mempool (`newPendingTransactions`
   no existe en Monad), y el indexador mantiene su propio estado en memoria.

4. **`TIMESTAMP` tiene granularidad de segundos** y los bloques son de 300 ms, así
   que 3-4 bloques comparten timestamp. Un `cooldown = 1` es en la práctica
   "1 píxel por ~4 bloques".

## Modos de wallet

Con una wallet real, cada píxel abre un popup de confirmación — injugable para
un lienzo en vivo. De ahí los tres caminos sobre la misma interfaz:

| Modo | Popups | Para quién |
|---|---|---|
| A. Wallet directa | 1 por píxel | El jurado, para ver la tx desde *su* address |
| B. Wallet + clave de sesión ⭐ | 1 en total | Recomendado: una tx fondea una burner local, luego pintas sin fricción |
| C. QR pre-fondeado | 0 | Quien no tiene wallet |

El contrato es idéntico para los tres.

## Desarrollo

Requiere **Foundry >= 1.8.0** (es la versión que trae el entorno de ejecución de
Monad). En Windows necesitas **WSL2 o Git BASH**: `foundryup` no soporta
PowerShell ni CMD.

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
forge --version          # >= 1.8.0

cd contracts
forge install --no-git foundry-rs/forge-std@v1.11.0
forge test -vv                        # 12 tests + reporte de gas
```

> El `--no-git` importa: sin él, `forge install` registra la librería como
> **submódulo de git** y la deja lista para commit, lo que choca con tener
> `lib/` en el `.gitignore`. La versión va fijada en el comando, así que la
> instalación es reproducible sin necesidad de versionar la librería.

## Red

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | `10143` | `143` |
| RPC | `https://testnet-rpc.monad.xyz` | `https://rpc.monad.xyz` |
| WebSocket | `wss://testnet-rpc.monad.xyz` | `wss://rpc.monad.xyz` |
| Faucet | `https://faucet.monad.xyz` | — |

Datos de [Current Facts for AI Agents](https://docs.monad.xyz/ai/current-facts)
(fuente canónica de Monad).

## Referencias

- [Gas Pricing en Monad](https://docs.monad.xyz/developer-essentials/gas-on-monad)
- [Reserve Balance](https://docs.monad.xyz/developer-essentials/reserve-balance)
- [Diferencias con Ethereum](https://docs.monad.xyz/developer-essentials/differences)
- [Ejecución paralela](https://docs.monad.xyz/monad-arch/execution/parallel-execution)
- [Resumen de despliegue](https://docs.monad.xyz/developer-essentials/summary)

# RPC, WebSocket y datos en tiempo real

## Límites del RPC público

**[docs]** Los endpoints públicos están limitados y compartidos con todo el
mundo:

| Endpoint (mainnet) | Proveedor | Límite | Batch |
|---|---|---|---|
| `rpc.monad.xyz` | QuickNode | 25 rps | 100 |
| `rpc1.monad.xyz` | Alchemy | 15 rps | 100 |
| `rpc2.monad.xyz` | Goldsky | 300 / 10 s | 10 |
| `rpc3.monad.xyz` | Ankr | 300 / 10 s | 10 |
| `rpc-mainnet.monadinfra.com` | MF | 20 rps | 1 |

**15-25 peticiones por segundo.** Para cualquier cosa con usuarios reales
necesitas un RPC dedicado (Alchemy y QuickNode tienen tier gratis). El síntoma
de agotarlo son transacciones y lecturas rechazadas de forma aparentemente
aleatoria.

Formato de Alchemy para Monad:

```
https://monad-testnet.g.alchemy.com/v2/TU_CLAVE
wss://monad-testnet.g.alchemy.com/v2/TU_CLAVE      # mismo host, esquema wss
```

## ⚠️ `eth_getLogs` está topado a 100 bloques

**[medido]** Rango mayor a 100 bloques devuelve:

```
-32614: eth_getLogs is limited to a 100 range
```

**A 300 ms por bloque, 100 bloques son 30 segundos de historia.**

Esto invalida el patrón habitual de indexador "si me caigo, relleno el hueco con
`getLogs`": reconstruir dos minutos necesitaría decenas de llamadas y te
comerías el rate limit.

**Patrón correcto:** cuando la suscripción se cae, **re-lee el estado del
contrato** con una función `view` que devuelva todo lo que necesitas. Es una
llamada, da el estado autoritativo y no hay forma de equivocarse. Lo único que
se pierde es el detalle histórico de "quién hizo qué", que suele ser cosmético.

Diseña tus contratos pensando en esto: incluye una función de lectura masiva
compacta (devolver bytes empaquetados en vez de structs reduce mucho la
respuesta). Ver `gas-and-storage.md` sobre el coste de esas lecturas.

## Suscripciones disponibles

**[docs]** `eth_subscribe` soporta:

| Tipo | Qué da |
|---|---|
| `newHeads` | Cabeceras de bloque, estándar |
| `logs` | Logs filtrados, estándar |
| `monadNewHeads` | Igual que `newHeads` pero emite en estado **Proposed** y trae `blockId` + `commitState` |
| `monadLogs` | Igual que `logs` pero emite en **Proposed** tras la ejecución especulativa |

**No soportados:** `newPendingTransactions` y `syncing`. Devuelven
`-32602 Invalid params`.

> Monad **no tiene mempool global**: cada validador mantiene su mempool local y
> los RPC reenvían las transacciones a los próximos líderes. No hay nada que
> observar antes de que un bloque se proponga, así que cualquier diseño que
> dependa de ver transacciones pendientes no funciona.

## Estados de consenso de un bloque

**[docs]** Un bloque pasa por cuatro estados:

| Estado | Cuándo | Qué garantiza |
|---|---|---|
| **Proposed** | inmediato | El líder lo propuso y tu nodo lo ejecutó especulativamente. **Nadie ha votado todavía.** |
| **Voted** | T+1 (~300 ms) | Hay un *quorum certificate*: pasó la primera votación. Es el tag `"safe"`. |
| **Finalized** | T+2 (~600 ms) | Parte de la cadena canónica, no se puede revertir sin hard fork. Tag `"finalized"`. |
| **Verified** | T+5 | Una supermayoría verificó que el resultado de la ejecución coincide. |

Los recibos (`eth_getTransactionReceipt`) están disponibles ya en **Proposed**.

**Para la UI:** actualizar en *Proposed* es razonable para casi todo, porque la
reversión de la finalidad especulativa es extremadamente rara. Si manejas lógica
financiera off-chain (exchanges, puentes, emisores), espera a **Verified**.

### La parte difícil: antes de finalizar, el número de bloque no identifica

**[docs]** Antes de la finalización pueden competir **dos bloques candidatos
por el mismo número**. Se distinguen por **`blockId`**, no por número. Vas a ver
datos en tiempo real de los dos.

Y el abandono es **implícito**: cuando se finaliza el bloque N, los otros
candidatos a N se descartan **sin ningún evento que lo anuncie**.

Si consumes `monadLogs` y mantienes estado de bloques no finalizados, en cada
finalización tienes que buscar bloques con el mismo número y distinto `blockId`,
y descartar su estado.

No hay reorganizaciones estilo Geth: en su lugar te dicen explícitamente qué
está haciendo el consenso con los bloques que ya viste.

**Recomendación práctica:** monta primero con `logs` normal (simple y robusto) y
añade `monadLogs` con estados de consenso como una segunda capa. Así, si la
complejidad se te va de las manos, tienes algo que funciona.

## Datos históricos

**[docs]** Los full nodes dan todos los datos históricos del ledger (bloques,
transacciones, recibos, eventos, trazas) pero **no estado histórico
arbitrario**: no puedes hacer un `eth_call` contra un bloque viejo cualquiera.
Hay un servicio RPC aparte para datos históricos.

Consecuencia: un indexador debe mantener su propio estado. No asumas que puedes
reconstruirlo consultando el pasado.

## Arquitectura para muchos clientes

Si N usuarios necesitan los mismos datos en vivo, **no pongas a N clientes a
suscribirse al RPC**. Con 15-25 rps, unas pocas decenas de usuarios lo agotan.

```
            ┌──────────┐
  1 conexión│  RELAY   │◀── 1 suscripción ──▶ Monad
  upstream  │ (estado  │
            │ en RAM)  │
            └────┬─────┘
       WS propio │ fan-out
    ┌────────────┼────────────┐
   cliente    cliente     cliente  ... xN
```

Un proceso mantiene **una** suscripción, guarda el estado en memoria y lo
reparte por su propio WebSocket. Monad ve 1 conexión en lugar de N.

**Las escrituras siguen yendo directas** de cada cliente al RPC. Meter un
relayer para escribir convierte sus nonces secuenciales en el embudo, y además
pierdes la propiedad de que cada transacción esté firmada por su autor real.

Patrón de protocolo que funciona bien: *snapshot* binario completo al conectar
y luego **deltas agrupados cada ~100 ms**. Agrupar en un `Map` por clave hace
que varias actualizaciones del mismo dato en una ventana manden solo la última.

**[medido]** Para un estado de 16 KB: snapshot de 16.389 bytes, deltas de 3
bytes por elemento, hidratación completa en ~1,1 s.

## Verificar un endpoint

```bash
curl -s -X POST $RPC -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```

Métodos que sí funcionan y conviene conocer **[medido]**:
`eth_getTransactionCount` con los tags `pending`, `latest`, `safe` y
`finalized`; `eth_getBalance`; `eth_maxPriorityFeePerGas`; `eth_feeHistory`.

## Fuentes

- [Network Information](https://docs.monad.xyz/developer-essentials/network-information/)
- [Datos en tiempo real](https://docs.monad.xyz/monad-arch/realtime-data/data-sources)
- [Datos especulativos en tiempo real](https://docs.monad.xyz/monad-arch/realtime-data/spec-realtime)
- [Mempool local](https://docs.monad.xyz/developer-essentials/summary)
- [Límites del RPC](https://docs.monad.xyz/reference/rpc-limits)

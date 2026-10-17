# Reserve Balance

El mecanismo que más sorprende a quien viene de Ethereum, y el que rompe dos
patrones comunes: **ráfagas de transacciones desde una cuenta** y **vaciar una
cuenta**.

## Por qué existe

**[docs]** Monad tiene **ejecución asíncrona**: se alcanza consenso sobre un
bloque *antes* de ejecutarlo, y la ejecución debe completarse en los siguientes
k bloques (actualmente **k=3**). Eso significa que consenso decide la validez de
un bloque con un estado retrasado 3 bloques.

Problema: ¿cómo sabe consenso que las transacciones de un bloque se pueden
pagar, si no tiene el estado actual? Sin una regla, alguien podría gastar su
saldo y luego meter muchas transacciones gratis.

La solución es que consenso y ejecución acuerdan por adelantado un umbral:
`user_reserve_balance`, **10 MON**.

## Las reglas

**[docs]** El gasto de MON de una cuenta se parte en dos:

| | Si la cuenta es el remitente | Si no lo es (vía EIP-7702) |
|---|---|---|
| Gasto de gas | `gas_price * gas_limit` | 0 |
| Gasto de valor | el `value` de la tx | lo que salga al ejecutar su código |

**En tiempo de consenso:** cada cuenta tiene un presupuesto para el gasto de gas
de **todas sus transacciones en vuelo**, y ese presupuesto es:

```
min(10 MON, saldo según el estado retrasado)
```

**En tiempo de ejecución:** una transacción revierte si el saldo final de la
cuenta (antes de reembolsos) baja del reserve, salvo la excepción de abajo.

## Consecuencia 1: cuántas transacciones en vuelo caben

Esto es lo que importa si tu app manda muchas transacciones seguidas desde la
misma cuenta (un juego, un bot, una burner de sesión):

```
tx en vuelo máximas ≈ min(10 MON, saldo) / (gas_bid * gas_limit)
```

**Ejemplo [medido]** con `gas_limit = 95.000` y `gas_bid = 202 gwei`:

| Saldo | Presupuesto | Coste por tx | Tx en vuelo |
|---|---|---|---|
| 0.05 MON | 0.05 MON | 0.0192 MON | **2** ⚠️ |
| 0.5 MON | 0.5 MON | 0.0192 MON | 26 |
| 2 MON | 2 MON | 0.0192 MON | 104 |
| 50 MON | **10 MON** (tope) | 0.0192 MON | 520 |

Fíjate en dos cosas:

1. **Fondear con poco saldo limita las ráfagas**, no solo el total de
   operaciones. Con 0.05 MON solo caben 2 transacciones en ~1,2 s.
2. **Subir `maxFeePerGas` reduce las tx en vuelo**, porque el presupuesto se
   calcula con el *bid*, no con lo que se paga de verdad. Es el contrapeso a
   "subir el techo de fee es gratis": gratis en dinero, no en concurrencia.

**Regla práctica:** si tu app hace ráfagas, fondea con holgura. Con 2-3 MON
caben más transacciones en vuelo de las que un humano puede generar.

## Consecuencia 2: vaciar una cuenta necesita una excepción

Sin excepciones, una cuenta **nunca podría bajar de 10 MON**, lo que haría
imposible devolver el saldo de una burner con 2 MON.

**[docs]** La excepción es la **"transacción que vacía la cuenta"**
(*emptying transaction*). Se permite bajar del reserve si:

1. La cuenta **no está delegada** por EIP-7702 en los k=3 bloques previos (y no
   hay solicitudes de delegación o des-delegación recientes), **y**
2. **No hay otra transacción del mismo remitente en los k=3 bloques previos**
   (~1,2 segundos)

La condición 2 es la que muerde: **no puedes vaciar una cuenta justo después de
usarla**. Hay que esperar ~1,2 s a que no queden transacciones en vuelo.

### Patrón para devolver un saldo

```ts
// Reservamos el gas al TECHO de fee, no al precio real: si la tx no entra,
// el usuario no recupera nada. Perder algo de polvo es preferible.
const gasReserved = 21_000n * maxFeePerGas;
if (balance <= gasReserved) throw new Error("no alcanza ni para el gas");

const value = balance - gasReserved;
// ...firmar con gas: 21_000n y mandar
```

**[medido]** Con 2 MON de saldo y techo de 202 gwei:

```
saldo             2.000000 MON
reservado p/ gas  0.004242 MON
se devuelve       1.995758 MON   (99,79%)
gas real pagado   0.002142 MON
polvo que queda   0.002100 MON
```

Avisa al usuario de que espere un momento si acaba de operar. Si falla,
reintentar un segundo después suele funcionar.

## EIP-7702: el caso especial

**[docs]** Monad soporta EIP-7702 (transacciones tipo 4), con dos salvedades:

- **Una EOA delegada no puede bajar de 10 MON.** No tiene la excepción de
  vaciado. Si la des-delegas, vuelve a poder.
- **Una EOA delegada no puede usar `CREATE` ni `CREATE2`** cuando se la llama
  como contrato.

Los flujos de gas patrocinado típicos **sí funcionan**: una EOA delegada que
empieza vacía y solo recibe MON está bien. Lo que se bloquea es que una EOA
delegada con, digamos, 6 MON intente transferir 1 MON hacia fuera.

**Implicación de diseño:** si piensas usar 7702 para claves de sesión en Monad,
cuenta con que esa cuenta necesita mantener 10 MON o no podrá gastar nada por
sí misma. Una burner normal (no delegada) es más simple para montos pequeños.

## Transacciones incluidas que revierten

**[docs]** Por estas reglas verás en la cadena transacciones **incluidas pero
revertidas**, por ejemplo intentos de transferir más MON del que hay. Son
transacciones válidas que **pagan su gas** y cuyo único efecto es ese cobro.

Se incluyen porque en el momento del consenso el proponente no puede saber si
la cuenta va a recibir MON de alguien más. Ethereum también incluye
transacciones que revierten, pero sus constructores de bloques suelen filtrar
las de saldo insuficiente, así que el comportamiento se nota distinto.

**No interpretes un revert como bug de tu contrato sin mirar el motivo.**

## Detectar el dip desde un contrato

**[docs]** El precompilado en `0x1001` expone `dippedIntoReserve()`
(selector `0x3a61584e`, 100 gas) que devuelve un bool. Hay que invocarlo con
`CALL`: con `STATICCALL`, `DELEGATECALL` o `CALLCODE` revierte. No es `view` a
propósito, para que Solidity genere `CALL`.

## Fuentes

- [Reserve Balance](https://docs.monad.xyz/developer-essentials/reserve-balance)
- [Diferencias con Ethereum](https://docs.monad.xyz/developer-essentials/differences)
- [MIP-4](https://docs.monad.xyz/developer-essentials/reserve-balance) (precompilado)

# Gas, storage y ejecución paralela en Monad

## El gas se cobra por `gas_limit`

**[docs]** El gas cobrado por una transacción es el **gas limit**, no el gas
usado. No hay reembolsos. Total descontado del remitente:

```
value + gas_price * gas_limit
```

Es una medida contra DoS necesaria por la ejecución asíncrona: los líderes
construyen bloques antes de ejecutarlos, así que si se cobrara el gas usado,
alguien podría reservar mucho espacio de bloque pagando poco.

**Consecuencias prácticas:**

- Fija el gas a mano cuando el coste es conocido. Te ahorra un
  `eth_estimateGas` y te da control.
- **El margen de seguridad se paga entero.** No es gratis "poner un poco más
  por si acaso".
- Las wallets que ponen márgenes grandes perjudican al usuario. Los
  [docs de wallets](https://docs.monad.xyz/developer-essentials/wallet-developers)
  lo llaman la diferencia más grande con Ethereum desde el lado de la wallet.

Ejemplo real de ese compromiso **[medido]** con un contrato cuyo peor caso son
83.271 gas:

| Límite | Coste por tx | Operaciones por MON |
|---|---|---|
| 84.000 (ajustado) | 0.0084 MON | 119 |
| 95.000 (+14% margen) | 0.0095 MON | 105 |

El margen del 14% cuesta un 12% de las operaciones. En testnet da igual; en
mainnet con dinero real, mídelo y ajústalo.

## Precios de opcodes que cambian

**[docs]** Igual que Ethereum (ver evm.codes) **excepto**:

| Concepto | Ethereum | Monad |
|---|---|---|
| Acceso en frío a cuenta | 2.600 | **10.100** |
| Acceso en frío a storage | 2.100 **por slot** | **8.100 por página de 128 slots** |
| `SSTORE` escritura | 20.000 slot nuevo / 2.900 sobrescritura | **2.800 primera escritura por página** + **17.000 por slot nuevo neto en la página** |
| Expansión de memoria | `3*w + w²/512` | **`w/2`** (lineal), tope 8 MB por tx |

Afectados por el acceso en frío a cuenta: `BALANCE`, `EXTCODESIZE`,
`EXTCODECOPY`, `EXTCODEHASH`, `CALL`, `CALLCODE`, `DELEGATECALL`,
`STATICCALL`, `SELFDESTRUCT`.

Otras diferencias: contrato hasta **128 KB** (initcode 256 KB), precompilado
secp256r1/P256 en `0x0100` (EIP-7951, habilita verificar passkeys on-chain),
precompilado de staking en `0x1000`, precompilado de reserve balance en
`0x1001`.

## Páginas de storage: la optimización que nadie espera

**[docs]** Los slots se agrupan en **páginas de 128 slots consecutivos**. El
primer `SLOAD`/`SSTORE` a una página paga el coste en frío; los otros 127 slots
quedan calientes para el resto de la transacción.

Esto significa que **la disposición de tus datos cambia el gas de forma
drástica**. Ejemplo real: un lienzo de 128×128 con un slot por píxel e índice
`y*128 + x`, o sea cada fila ocupa exactamente una página.

**[medido]** 32 píxeles en una sola transacción, mismo contrato, solo cambia la
geometría:

| | gas total | por píxel |
|---|---|---|
| Una **fila** (1 página) | 687.134 | 21.472 |
| Una **columna** (32 páginas) | 1.011.889 | 31.621 |

**La columna cuesta 47% más.** El ahorro viene de pagar 8.100 una vez en lugar
de 32 veces, más los 2.800 de primera escritura por página.

### Alinear a página

Un array declarado **primero** en el contrato arranca en el slot 0, que es
múltiplo de 128, así que queda alineado a página. Si pones cualquier otra
variable de storage antes, el array se desplaza y cada "fila" cruza dos
páginas, duplicando el coste en frío de los recorridos.

```solidity
contract Bueno {
    uint256[16384] private _datos;   // slot 0 -> alineado
    mapping(address => uint64) public otraCosa;
}

contract Malo {
    uint64 public contador;          // ocupa el slot 0
    uint256[16384] private _datos;   // arranca en el 1 -> desalineado
}
```

Los mappings no importan para esto: sus slots son keccak, están dispersos por
definición, y cada entrada paga su propia página en frío.

## Ejecución paralela: diseña para no tener conflictos

**[docs]** Monad ejecuta transacciones **optimistamente en paralelo**: las corre
a la vez, rastrea las entradas que usó cada una y las compara con las salidas de
las anteriores. Si difieren, re-ejecuta. El resultado es idéntico a ejecutarlas
en serie — el paralelismo es un detalle de implementación.

Pero **el paralelismo disponible no lo da la cadena, lo da tu contrato**. Si
todas las transacciones tocan el mismo slot, se serializan.

### Antipatrones que matan el paralelismo

```solidity
// ❌ Contador global: TODAS las tx escriben el mismo slot
uint256 public total;
function hacer() external { total++; /* ... */ }

// ❌ Empaquetar varias entidades por slot: entidades vecinas colisionan
uint256 packed;  // 32 entidades de 1 byte
```

```solidity
// ❌ Cobrar en el camino caliente: acreditar el balance del contrato
//    es estado compartido y serializa
function hacer() external payable { /* ... */ }
```

### El patrón correcto

```solidity
// ✅ Un slot por entidad: escrituras independientes, cero contención
uint256[16384] private _items;

// ✅ Estado por usuario: cada quien escribe su propio slot keccak
mapping(address => uint64) public ultimaVez;
```

Las estadísticas (totales, contadores, rankings) **se derivan de los eventos en
un indexador**, nunca de un contador on-chain. Eso es la otra mitad de la
decisión: si no hay contador en el contrato, hace falta un indexador que lo
calcule.

### El compromiso explícito

Un slot por entidad **gasta más gas** que empaquetar. Lo cambias por
paralelismo. Si tu caso de uso no tiene escrituras concurrentes, empaquetar
sigue siendo correcto. Decídelo a conciencia, no por inercia de Ethereum.

## Medir de verdad

```bash
forge test --gas-report          # con network = "monad" en foundry.toml
forge test --network ethereum    # para comparar modelos
```

Para obtener el límite de la **transacción** suma el coste intrínseco de
**21.000** al gas de la llamada que reporta `forge`, más el calldata.

**[medido]** Ejemplo de una función que escribe un slot y emite un evento:

```
pixel virgen (slot nuevo)   62.271   -> + 21.000 = 83.271
sobrescritura               35.271   -> + 21.000 = 56.271
```

La diferencia de 27.000 entre ambos es, básicamente, el `17.000` de slot nuevo
neto más el crecimiento de estado.

## Lecturas masivas con `eth_call`

**[medido]** Las funciones `view` que recorren mucho storage son viables pero
hay que medirlas:

| Operación | Gas | Respuesta |
|---|---|---|
| Leer 16.384 slots, devolver 1 byte cada uno | ~6,7M | 16 KB |
| Leer 16.384 slots, devolver 3 bytes cada uno | ~17,1M | 48 KB |

Entran en el límite de 30M por transacción, pero **algunos proveedores de RPC
topan el gas de `eth_call` más bajo**. Si tu lectura pasa de ~5M, trocéala por
defecto en lugar de como último recurso.

## Timing

**[docs]** `TIMESTAMP` tiene granularidad de **segundos**, y los bloques son de
300 ms, así que **3-4 bloques comparten el mismo timestamp** [medido]. Un
cooldown de 1 segundo es en la práctica "una vez cada ~4 bloques". No uses
`block.timestamp` para nada que necesite resolución de sub-segundo.

## Fuentes

- [Gas Pricing](https://docs.monad.xyz/developer-essentials/gas-on-monad)
- [Opcode Pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing)
- [Diferencias con Ethereum](https://docs.monad.xyz/developer-essentials/differences)
- [Ejecución paralela](https://docs.monad.xyz/monad-arch/execution/parallel-execution)
- [Resumen de despliegue](https://docs.monad.xyz/developer-essentials/summary)

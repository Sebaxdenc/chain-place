# Foundry con Monad

Requiere **Foundry >= 1.8.0**, que es la versión donde el soporte de Monad pasó
a la distribución oficial. Si encuentras guías que mandan instalar desde
`foundry.category.xyz` o usar `foundryup --network monad`, están obsoletas.

## Configuración

```toml
# foundry.toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]

# ───────────────────────────────────────────────────────────────────────
# OBLIGATORIO. Activa el entorno de ejecución de Monad: modelo de gas,
# precios de opcodes (páginas de storage de 128 slots), reglas de
# transacción, precompilados y límite de contrato de 128 KB.
# Sin esto el gas report te da números de ETHEREUM.
# ───────────────────────────────────────────────────────────────────────
network = "monad"

optimizer = true
optimizer_runs = 1000

# Embute el código fuente literal en la metadata, para que Sourcify
# encuentre las fuentes al verificar. AFECTA AL BYTECODE: tiene que estar
# puesto ANTES de desplegar, o la verificación falla por mismatch.
use_literal_content = true

[rpc_endpoints]
monad_testnet = "https://testnet-rpc.monad.xyz"
monad_mainnet = "https://rpc.monad.xyz"
```

También se puede por comando: `forge test --network monad`.

**Hardfork:** por defecto usa el último soportado (actualmente `MonadTen`). Se
puede fijar con `hardfork = "MonadTen"`. Al hacer fork de una red real, Foundry
detecta el hardfork por el chain ID y el timestamp del bloque.

## ⚠️ Dos errores en la documentación oficial

**1. Las claves de metadata de los docs de BlockVision no existen en Foundry.**

La [guía de verificación de BlockVision](https://docs.blockvision.org/reference/verify-smart-contract-on-monad-explorer)
recomienda:

```toml
metadata = true          # ❌ no existe
metadata_hash = "none"   # ❌ no existe
use_literal_content = true   # ✅ sí existe
```

`forge` reporta las dos primeras como `unknown config` y **no hacen nada**. Los
equivalentes reales serían `bytecode_hash` y `cbor_metadata`, pero quitar el
hash de metadata degrada la verificación a *partial match*, así que lo normal es
dejarlos en su valor por defecto.

**2. El comando para crear keystore del README de `foundry-monad` está roto.**

El [README oficial](https://github.com/monad-developers/foundry-monad) propone:

```bash
# ❌ falla en Foundry 1.8.x
cast wallet import monad-deployer --private-key $(cast wallet new | grep 'Private key:' | awk '{print $3}')
```

Falla con `a value is required for '--private-key'`. El motivo: `cast wallet new`
manda el texto legible a **stderr**, y a **stdout** escribe solo
`dirección⇥clave` separadas por tabulador. El `$( )` captura stdout, donde no
existe la cadena `Private key:`, así que el `grep` devuelve vacío.

**La forma correcta, y además mejor** — genera y cifra en un paso, sin que la
clave aparezca nunca en pantalla ni en el historial del shell:

```bash
cast wallet new monad-deployer
```

Pide contraseña dos veces y solo imprime la dirección. El keystore cifrado
queda en `~/.foundry/keystores/monad-deployer`.

```bash
cast wallet address --account monad-deployer   # pide la contraseña
cast wallet list
```

> **Nunca uses `--private-key` en la línea de comandos.** Queda en
> `~/.bash_history` en texto plano. Siempre `--account` con keystore.

## Instalar librerías

```bash
forge install --no-git foundry-rs/forge-std@v1.11.0
```

El **`--no-git` importa**: sin él, `forge install` registra la librería como
**submódulo de git** y deja `.gitmodules` preparado para commit, lo que choca
con tener `lib/` en el `.gitignore`. Fijar la versión en el comando mantiene la
instalación reproducible sin versionar la librería.

(Si prefieres el camino estándar de Foundry, versiona `lib/` como submódulos y
no uses `--no-git`. Lo que no funciona es mezclar las dos cosas.)

## Desplegar

```bash
forge create src/MiContrato.sol:MiContrato \
  --account monad-deployer \
  --rpc-url monad_testnet \
  --broadcast \
  --constructor-args 0
```

Guarda la salida: `forge create` no deja un archivo de broadcast fiable.

```bash
forge create ... | tee ~/deploy.log
grep "Deployed to" ~/deploy.log
```

### Recuperar una dirección perdida

La dirección de un `CREATE` es determinista a partir del remitente y su nonce:

```bash
cast nonce $WALLET --rpc-url monad_testnet      # ¿cuántas tx mandé?
cast compute-address $WALLET --nonce 0          # si el deploy fue la primera
cast code <DIRECCION> --rpc-url monad_testnet   # ¿tiene código?
```

Si `cast nonce` da `0`, el deploy nunca ocurrió. Si `cast code` devuelve `0x`,
esa dirección no tiene contrato — probablemente estés mirando tu **wallet** en
vez del **contrato**, que es un error muy común: son dos direcciones distintas.

## Verificar

```bash
forge verify-contract <DIRECCION> src/MiContrato.sol:MiContrato \
  --chain 10143 \
  --verifier sourcify \
  --verifier-url 'https://sourcify-api-monad.blockvision.org/' \
  --constructor-args $(cast abi-encode "constructor(uint64)" 0)
```

Detalles que cuestan tiempo:

- **La barra final del `--verifier-url` importa.** BlockVision, que opera el
  servicio, dice que debe llevarla. Si sale
  `Provided URL ... is host only`, prueba quitándola.
- **Si falla con un error de `etherscan`**, corre `forge config | grep etherscan`
  y quita cualquier `etherscan_api_key`: entra en conflicto con Sourcify.
- Mainnet y testnet usan **el mismo** endpoint de Sourcify; la red se detecta
  por el RPC.

## Linter

Foundry 1.8 trae `forge lint`. Para casts intencionales de empaquetado, suprime
**en el sitio y con el motivo escrito**, en lugar de desactivar la regla
globalmente:

```solidity
// Una address ES exactamente 160 bits: no se trunca nada.
// forge-lint: disable-next-line(unsafe-typecast)
_datos[i] = uint256(uint160(msg.sender)) | (uint256(x) << 160);
```

`disable-next-line` cubre **una** línea: si la expresión es multilínea, la
supresión no alcanza a los casts de las siguientes. O la pones en una línea, o
suprimes cada una. `forge lint --report-unused-suppressions` detecta
supresiones que no suprimen nada.

Alternativa global, si de verdad aplica a todo el proyecto:

```toml
[lint]
exclude_lints = ["unsafe-typecast"]
```

## Interactuar con `cast`

```bash
# Llamar (lectura, gratis, msg.sender = dirección cero)
cast call <CONTRATO> "pixel(uint32)(uint8,address,uint48)" 8256 --rpc-url monad_testnet

# Enviar (transacción real, firmada, cuesta gas)
cast send <CONTRATO> "paint(uint32,uint8)" 8256 7 \
  --account monad-deployer --rpc-url monad_testnet --gas-limit 95000

# Leer un slot crudo de storage
cast storage <CONTRATO> 8256 --rpc-url monad_testnet

# Saldo
cast balance <DIRECCION> --rpc-url monad_testnet --ether
```

Pasar `--gas-limit` explícito en `cast send` es buena costumbre en Monad: se
cobra el límite.

## Anvil

```bash
anvil --network monad                                  # local
anvil --network monad --fork-url monad_testnet         # fork
```

Por defecto usa `MonadTen` para cadenas locales nuevas.

**Nota de entorno:** el binario de `anvil` requiere **glibc >= 2.35**. En
distribuciones viejas `forge` y `cast` funcionan pero `anvil` falla con
`version 'GLIBC_2.35' not found`. `forge test` no necesita anvil (trae su
propio EVM), así que esto solo bloquea el nodo local.

## Entorno en Windows

`foundryup` **no soporta PowerShell ni CMD**: hace falta **WSL2** o Git BASH.
Recomendado WSL2 con Ubuntu.

Tres trampas que cuestan horas:

1. **Clona dentro de WSL, no en `/mnt/c/`.** Trabajar en `/mnt/c/...` cruza el
   límite entre sistemas de archivos y `forge build` pasa de 1 s a 30 s. Usa
   `~/proyecto`.
2. **Instala Node dentro de WSL.** WSL hereda el `PATH` de Windows, así que si
   no hay Node en Linux, `npm` resuelve al de Windows, que no sabe manejar
   rutas UNC (`\\wsl.localhost\...`) y revienta instalando binarios nativos.
3. **Si algo se comporta raro, usa `type`, no `which`.** Bash cachea la
   ubicación de los comandos ya ejecutados: `which npm` hace una búsqueda nueva
   y puede decir `/usr/bin/npm` mientras la ejecución sigue usando el de
   Windows. `type npm` muestra `npm is hashed (...)`. Se arregla con `hash -r`.

```bash
which node npm git forge cast   # todo debe apuntar a rutas de Linux
```

## Fuentes

- [Foundry para Monad](https://docs.monad.xyz/tooling-and-infra/toolkits/monad-foundry)
- [Verificar un contrato](https://docs.monad.xyz/guides/verify-smart-contract/foundry)
- [Verificación en BlockVision](https://docs.blockvision.org/reference/verify-smart-contract-on-monad-explorer)
- [Template foundry-monad](https://github.com/monad-developers/foundry-monad)

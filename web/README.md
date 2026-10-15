# web

Frontend móvil del lienzo. Toca un píxel y sale una transacción firmada por ti.

## Arrancar

```bash
npm install
cp .env.example .env     # y rellena VITE_CANVAS_ADDRESS
npm run dev              # expuesto en la red local (--host)
```

Necesitas el **relay corriendo** (ver `../relay`). Abre la URL de red que
imprime Vite (`http://192.168.x.x:5173`) desde el celular, con el teléfono en
la misma WiFi.

| Variable | Qué |
|---|---|
| `VITE_CANVAS_ADDRESS` | Dirección del contrato (obligatoria) |
| `VITE_RELAY_URL` | `ws://localhost:8787` en local, `wss://…` por túnel |
| `VITE_RPC_URL` | A dónde manda cada celular sus transacciones |

> Todo lo que empieza por `VITE_` queda **embebido en el bundle y es público**.
> Nunca pongas una private key ahí.

## Fondear la wallet del navegador

La primera vez, el navegador genera una wallet nueva **sin fondos**. La barra de
estado muestra su dirección. Mándale MON desde tu wallet de despliegue:

```bash
cast send <DIRECCION_DEL_NAVEGADOR> \
  --value 2ether --account monad-deployer --rpc-url monad_testnet
```

Con 2 MON tienes ~210 píxeles.

## Probar el flujo del QR

El modo QR mete la clave en el fragmento de la URL. Puedes simularlo a mano:

```
http://192.168.x.x:5173/#pk=0xTU_CLAVE_PRIVADA
```

Al cargar, la clave se guarda en `localStorage` y **desaparece de la barra de
direcciones**. Se usa el fragmento (`#`) y no un query param (`?`) porque el
fragmento no se envía al servidor ni queda en sus logs.

## Decisiones de diseño

### Un píxel = una llamada RPC

Un `sendTransaction` normal haría cuatro llamadas por píxel:
`eth_estimateGas` + `eth_getTransactionCount` + `eth_feeHistory` +
`eth_sendRawTransaction`. Con 100 personas pintando, eso es 4× más tráfico
contra un RPC que aguanta 15–25 req/s.

Así que: gas fijo (medido, no estimado), nonce en local con incremento
optimista, fees refrescadas en segundo plano cada 3 s, y **firma 100% local**
con `account.signTransaction`. Queda una única llamada:
`eth_sendRawTransaction`.

Verificado: firmar tarda **3,5 ms y no toca la red**.

### Pintado optimista

Al tocar, el píxel aparece **al instante** pulsando, y la transacción sale en
paralelo. Cuando el relay confirma el evento, el píxel se vuelve sólido y se
mide la latencia real (se muestra en la barra de estado). Si la transacción
falla, el píxel se revierte.

Nadie espera 600 ms con el dedo en la pantalla.

### Un `<canvas>`, no 16.384 divs

El canvas tiene un buffer real de 128×128 y se agranda con CSS
(`image-rendering: pixelated`). Dibujar cuesta lo mismo al 100% que al 2400% de
zoom. Un nodo del DOM por píxel tumba cualquier celular.

El bucle de animación solo recalcula los píxeles **pendientes**, que son unos
pocos, y únicamente vuelca el `ImageData` si algo cambió.

### El pan lo hace el scroll nativo

Arrastrar usa el scroll del contenedor, que trae inercia de serie y se siente
mejor que cualquier pan hecho a mano. Un toque se distingue de un arrastre por
umbral: menos de 10 px de movimiento y menos de 500 ms.

### Sin `StrictMode`

En desarrollo, StrictMode monta cada efecto dos veces. Aquí serían dos
conexiones WebSocket y dos `Painter`, y el segundo leería el mismo nonce que el
primero: dos transacciones con el mismo nonce y una rechazada. No compensa.

## Coste por píxel

Monad cobra el **gas limit**, no el gas usado, así que el margen de seguridad
se paga entero:

| Límite | Coste por píxel | Píxeles por MON |
|---|---|---|
| 84.000 (ajustado) | 0.0084 MON | 119 |
| **95.000 (el nuestro)** | **0.0095 MON** | **105** |

Elegimos el margen: en testnet el MON es gratis, y una transacción que revienta
por out-of-gas delante del público cuesta mucho más que un 12% de gas.

## Pendiente

- Modos de wallet A (wallet directa) y B (wallet + clave de sesión) — paso 5
- Vista proyector con TPS y etapas de consenso — paso 6
- `paintMany` para trazos de varios píxeles en una transacción

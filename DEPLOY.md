# Desplegar

## Respuesta corta

**Sí, se puede dejar desplegado gratis y para siempre en Vercel.** El frontend
funciona **sin relay**: habla directo con Monad. Un solo sitio estático, cero
servidores, cero coste.

Para un auditorio lleno conviene añadir el relay, pero eso es una mejora
opcional, no un requisito.

## Los dos modos

El frontend tiene dos fuentes de datos con la misma interfaz, y elige según si
hay relay configurado:

| | **modo directo** | **modo relay** |
|---|---|---|
| Infraestructura | ninguna | un proceso con WebSocket |
| Carga del RPC | crece con cada persona | fija, da igual cuánta gente |
| Hidratación | cada celular su `eth_call` | una vez, en el servidor |
| Suscripción a logs | una por celular | **una en total** |
| Gratis y permanente | ✅ | depende del host |
| Bueno para | desarrollo, demos pequeñas | auditorio lleno |

El relay existe porque el RPC público de Monad aguanta **15–25 peticiones por
segundo**. Con 80 personas suscritas cada una por su cuenta, se agota. Con
relay, la carga no depende del público.

La barra de estado muestra en qué modo estás.

## 1. Frontend en Vercel (gratis, permanente)

1. [vercel.com/new](https://vercel.com/new) → importa el repo (funciona con
   repos privados)
2. Configuración:

| Campo | Valor |
|---|---|
| Framework Preset | `Vite` |
| Root Directory | `web` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

3. Variables de entorno:

```
VITE_CANVAS_ADDRESS = 0x33F5eC093f6Cc61ee0Dd407ceb7ccba136B86E8e
VITE_RPC_URL        = https://testnet-rpc.monad.xyz
```

**No pongas `VITE_RELAY_URL`.** Sin ella arranca en modo directo, que es lo que
hace que esto funcione sin servidor.

Te queda una URL fija tipo `https://chain-place.vercel.app`, y cada push a
`main` redespliega solo. Eso es todo: ya está desplegado para siempre.

> Cloudflare Pages funciona igual de bien con la misma configuración, si
> prefieres tenerlo todo en Cloudflare.

## 2. Añadir relay el día del evento (opcional)

### La URL del relay va en tiempo de ejecución

`VITE_RELAY_URL` queda **embebida en el bundle** al compilar, así que si fuera
el único sitio donde vive, cambiarla obligaría a redesplegar.

Por eso el frontend acepta `?relay=` en la URL:

```
https://chain-place.vercel.app/?relay=wss://abc-def.trycloudflare.com
```

Se guarda en `localStorage` y sobrescribe el valor de compilación. Así
**despliegas el frontend una sola vez** y cada día le pasas el relay que tengas.
El QR del auditorio puede llevar las dos cosas:

```
https://chain-place.vercel.app/?relay=wss://abc-def.trycloudflare.com#pk=0x...
```

### Dónde correr el relay

**Túnel desde tu máquina** — gratis, sin arranque en frío:

```bash
cd relay
CANVAS_ADDRESS=0x33F5eC093f6Cc61ee0Dd407ceb7ccba136B86E8e npm start
# en otra terminal
cloudflared tunnel --url http://localhost:8787
```

**Render** — URL fija, no depende de tu laptop. New → Web Service → Root
Directory `relay`, Build `npm install`, Start `npm start`, Health Check
`/health`, y la variable `CANVAS_ADDRESS`. El relay ya lee `PORT` del entorno.

El tier gratis de Render **apaga el servicio tras ~15 min de inactividad** y
tarda ~30 s en despertar, así que ábrelo un minuto antes de presentar.

### Por qué el relay no puede ir en Vercel

Vercel soporta WebSockets desde junio de 2026, pero cada conexión queda
**fijada a una instancia**, sin estado compartido ni fan-out, y se corta a los
pocos minutos. El relay necesita justo lo contrario: **un** proceso con **una**
suscripción a Monad y el lienzo en memoria compartido entre todos los clientes.
En Vercel tendrías N instancias con N suscripciones, que es el problema que el
relay existe para resolver.

Si algún día quieres el relay sin servidor, la pieza correcta son los
**Durable Objects** de Cloudflare: una instancia única con estado y WebSockets
hibernables. Pero es reescribir el relay.

## 3. Lo más importante: un RPC dedicado

Más importante que dónde despliegues. El RPC público aguanta **15–25 req/s**, y
el síntoma de agotarlo son transacciones rechazadas al azar en pleno pitch.

Saca una clave gratis en [Alchemy](https://www.alchemy.com) o
[QuickNode](https://www.quicknode.com) y ponla en:

- `VITE_RPC_URL` en Vercel — por donde los celulares envían las transacciones
- `MONAD_RPC_HTTP` y `MONAD_RPC_WS` en el relay, si lo usas

En modo directo esto no es opcional: cada celular habla con el RPC por su
cuenta.

## Checklist previo al evento

- [ ] Frontend en Vercel con URL fija
- [ ] RPC **dedicado** en `VITE_RPC_URL`
- [ ] Probado desde un celular con **datos móviles**, no solo con el WiFi del sitio
- [ ] Probado con varios celulares pintando a la vez
- [ ] Burners pre-fondeadas con 2–3 MON cada una
- [ ] QRs impresos
- [ ] Si hay mucha gente: relay levantado y `?relay=` en los QR

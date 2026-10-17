# Desplegar una dapp de Monad

## Qué necesita cada pieza

| Pieza | Necesita | Dónde |
|---|---|---|
| Frontend | servir estáticos | Vercel, Cloudflare Pages, Netlify — gratis y permanente |
| Indexador / relay | **proceso vivo con WebSocket** | no serverless; ver abajo |
| RPC | **endpoint dedicado** | Alchemy, QuickNode (tier gratis) |

## El frontend es la parte fácil

Build estático en Vercel o Pages: gratis, URL fija, redespliegue en cada push.
Configuración típica para un monorepo con el frontend en `web/`:

```
Framework Preset   Vite
Root Directory     web
Build Command      npm run build
Output Directory   dist
```

Las variables `VITE_*` son **de compilación**: si las cambias hay que
redesplegar. Y son públicas (ver `frontend.md`).

## ⚠️ Un relay con WebSocket no va en serverless

Vercel soporta WebSockets desde junio de 2026, pero con límites que lo
inhabilitan para este caso:

- cada conexión queda **fijada a una instancia**
- **sin estado compartido ni fan-out** entre instancias
- se corta a los pocos minutos

Un relay necesita justo lo contrario: **un** proceso con **una** suscripción a
Monad y el estado compartido entre todos los clientes. En serverless tendrías N
instancias con N suscripciones, que es exactamente el problema de rate limit que
el relay existe para resolver.

Opciones reales:

| Opción | A favor | En contra |
|---|---|---|
| **Túnel desde tu máquina** (`cloudflared tunnel --url http://localhost:PORT`) | gratis, sin arranque en frío | depende de tu máquina; URL cambia en cada arranque |
| **Render** (tier gratis) | URL fija, independiente | **se apaga tras ~15 min de inactividad**, despertar tarda ~30 s |
| **Fly.io** | sin arranque en frío | pago por uso |
| **Cloudflare Durable Objects** | la pieza arquitectónicamente correcta: instancia única con estado y WebSockets hibernables | reescribir el relay |

Railway **ya no tiene tier gratis**.

### Haz la URL del relay configurable en tiempo de ejecución

Si la URL del relay vive solo en una variable de build, cambiarla obliga a
redesplegar el frontend entero — lo que hace **incompatible** un frontend
desplegado con un relay en un túnel, cuya URL cambia en cada arranque.

Acepta un parámetro en la URL:

```
https://tu-app.com/?relay=wss://abc-def.trycloudflare.com
```

Guárdalo en `localStorage` y que sobrescriba el valor de build. Así despliegas
el frontend una vez y le pasas el relay que tengas ese día.

### Contenido mixto: la trampa del túnel

Un navegador **bloquea** un WebSocket `ws://` desde una página servida por
`https://`. El síntoma es un "conectando" eterno **sin ningún error visible**.
Detéctalo y dilo claro:

```ts
if (location.protocol === "https:" && relayUrl.startsWith("ws://")) {
  // avisar: hace falta wss://
}
```

### Mejor aún: que el frontend funcione sin relay

Si puedes, implementa dos fuentes de datos con la misma interfaz:

- **modo directo** — el navegador habla con el RPC: cero infraestructura, pero
  la carga crece con cada usuario
- **modo relay** — una suscripción compartida: la carga no depende del público

Así el frontend se despliega solo, gratis y para siempre, y el relay se añade
el día que haya mucha gente sin tocar el despliegue.

## ⚠️ Avisos de phishing en subdominios gratuitos

**Si tu dapp vive en `*.vercel.app` (o similar), las wallets van a mostrar un
aviso de phishing o de drenaje de fondos al conectar.**

No es tu código. Esos subdominios son de los hospedajes más usados por los
drenadores reales — una búsqueda rápida devuelve `opensea-login.vercel.app`,
`trust-wallet-en.vercel.app`, `ledger-wallet-app-*.vercel.app`,
`claim-jupuary.vercel.app`. Los motores de seguridad aplican la regla razonable
de **subdominio gratuito nuevo + pide conectar wallet = sospechoso**, y tu app
encaja en el patrón.

Agrava el caso cualquier flujo tipo "manda fondos a esta dirección", como el
fondeo de una clave de sesión.

**Soluciones, en orden de eficacia:**

1. **Dominio propio.** Es el arreglo de verdad, y cuesta unos dólares al año.
   También se ve mucho más serio.
2. **Pedir la revisión del falso positivo.** MetaMask acepta issues en
   [`MetaMask/eth-phishing-detect`](https://github.com/MetaMask/eth-phishing-detect/issues);
   Phantom y Rabby usan **Blockaid**, que tiene formulario. Tarda días. Ayuda
   enlazar el repo público y el contrato verificado.
3. **No depender de conectar wallets en la demo.** Usa claves locales o de
   sesión, y deja la wallet directa como prueba puntual.

**Lo que no hay que hacer** es intentar esquivar la detección. No funciona de
forma estable, y esas heurísticas existen porque protegen a gente real. El
camino es quedar bien clasificado.

## Lo más importante de todo: un RPC dedicado

Importa más que dónde despliegues. El RPC público aguanta **15-25 req/s** y el
síntoma de agotarlo son transacciones rechazadas al azar.

Ponlo en los dos sitios:

- en el frontend, por donde los usuarios mandan transacciones
- en el relay, para la hidratación y la suscripción

Y recuerda: **en `wallet_addEthereumChain` va el RPC público**, no el tuyo
(ver `frontend.md`).

## Checklist antes de una demo con público

- [ ] RPC **dedicado** configurado en frontend y relay
- [ ] Dominio propio, si va a haber wallets conectándose
- [ ] Contrato verificado en el explorador
- [ ] Probado desde un móvil con **datos móviles**, no solo con el WiFi del sitio
- [ ] Probado con **varios dispositivos a la vez** (es donde aparecen los
      problemas de rate limit y de nonce)
- [ ] Cuentas fondeadas con holgura — el saldo bajo limita las **ráfagas**, no
      solo el total (ver `reserve-balance.md`)
- [ ] Gas limit medido con `network = "monad"`, no estimado
- [ ] Si el relay está en un tier que se duerme, despiértalo antes de empezar

## Fuentes

- [Network Information](https://docs.monad.xyz/developer-essentials/network-information/)
- [Proveedores de RPC](https://docs.monad.xyz/tooling-and-infra/rpc-providers)
- [Blocklist de MetaMask](https://github.com/MetaMask/eth-phishing-detect)

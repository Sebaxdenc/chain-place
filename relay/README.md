# relay

Indexer y fan-out WebSocket del lienzo. Mantiene **una sola** conexión a Monad
y la reparte a todos los clientes.

## Por qué existe

El RPC público de Monad aguanta 15–25 peticiones por segundo. Si 100 celulares
se suscriben cada uno a los eventos, te cortan en segundos y la demo se cae en
el escenario. Este proceso colapsa eso a una conexión upstream.

```
Monad ──monadLogs/logs──▶ RELAY ──WebSocket propio──▶ 📱📱📱🖥️
                       (1 upstream)      (N clientes)
```

La escritura **no** pasa por aquí: cada celular manda su transacción directo al
RPC. Así cada píxel es una tx firmada por el asistente, no por un servidor.

## Uso

```bash
npm install
CANVAS_ADDRESS=0x... npm start
```

Verifícalo sin necesidad de frontend:

```bash
npm run probe        # dibuja el lienzo en ASCII y muestra los píxeles en vivo
curl localhost:8787/health
```

| Variable | Default | Qué |
|---|---|---|
| `CANVAS_ADDRESS` | — (obligatoria) | Dirección del contrato |
| `PORT` | `8787` | Puerto del WebSocket |
| `MONAD_NETWORK` | `testnet` | `mainnet` para producción |
| `MONAD_RPC_HTTP` | RPC público | Para la hidratación |
| `MONAD_RPC_WS` | RPC público | Para la suscripción |

> Para el evento usa un RPC dedicado (Alchemy o QuickNode tienen tier gratis).
> El público sirve para desarrollar, no para 100 personas pintando.

## Exponerlo con cloudflared

Los celulares del auditorio necesitan una URL pública. Un túnel es lo más
simple y aguanta que el WiFi del venue sea malo:

```bash
# instalar (una vez)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/

# levantar el túnel (con el relay ya corriendo)
cloudflared tunnel --url http://localhost:8787
```

Te da una URL `https://algo-aleatorio.trycloudflare.com`. El frontend se conecta
a la **misma URL pero con `wss://`**:

```
wss://algo-aleatorio.trycloudflare.com
```

Compruébalo desde otra máquina:

```bash
RELAY_URL=wss://algo-aleatorio.trycloudflare.com npm run probe
```

## Protocolo

Dos canales sobre la misma conexión. **Binario** para el lienzo (el camino
caliente, es lo único que un celular necesita para dibujar) y **texto JSON**
para estadísticas y el feed de pintores (que usa sobre todo el proyector).

### Frames binarios

**Snapshot** — se manda una vez, al conectar. ~16 KB.

```
┌────────┬──────────┬──────────┬─────────────────────┐
│ 0x00   │ ancho u16│ alto u16 │ colores (w*h bytes) │
└────────┴──────────┴──────────┴─────────────────────┘
```

**Delta** — cada 100 ms, solo lo que cambió. 3 bytes por píxel.

```
┌────────┬────────┬──────────────────────────────────┐
│ 0x01   │ n u16  │ (idx u16, color u8) × n          │
└────────┴────────┴──────────────────────────────────┘
```

Todos los enteros son little-endian. El índice es `y * 128 + x`.

### Frames de texto

```json
{ "type": "stats", "tps": 847, "peakTps": 1203, "block": "71299448",
  "totalPaints": 5120, "painted": 3044, "clients": 83 }

{ "type": "paints", "items": [ { "idx": 8256, "color": 7, "painter": "0x1b40…" } ] }
```

## Decisiones de diseño

**Deltas agrupados cada 100 ms, no uno por evento.** Por debajo saturas la red
del celular sin que el ojo lo note; por encima se empieza a sentir lento. Los
deltas van en un `Map`, así que repintar el mismo píxel tres veces en una
ventana manda solo el color final.

**Re-hidratar en vez de rellenar huecos.** Si la suscripción se cae, llamamos a
`colorsOf(0, 16384)` otra vez: una llamada, estado autoritativo, imposible
equivocarse.

Esto no es solo elegancia. **`eth_getLogs` en el RPC público de Monad está
limitado a 100 bloques** (error `-32614`), que a 300 ms por bloque son **30
segundos de historia**. Reconstruir dos minutos de hueco necesitaría decenas de
llamadas y agotaría el rate limit. Re-hidratar cuesta una.

**Las estadísticas se calculan aquí, no en el contrato.** Un contador on-chain
(`totalPaints++`) haría que todas las transacciones escribieran el mismo slot
de storage, serializando la ejecución paralela. El TPS y los totales salen de
los eventos.

**El lienzo cabe en 16 KB de RAM.** No hace falta base de datos: el estado
entero es más pequeño que un logo en PNG.

## Verificado contra testnet

- Hidratación del lienzo completo: **1.080 ms** en una sola llamada
- Snapshot al cliente: **16.389 bytes**
- Altura de bloque avanzando a **3 bloques/segundo** (los 300 ms de Monad)
- El ABI de `Painted` decodifica los logs reales de la cadena correctamente

/**
 * Cliente de prueba para el relay. Sirve para comprobar que todo el circuito
 * funciona ANTES de escribir una línea de frontend: si la sonda ve píxeles,
 * el navegador también los verá.
 *
 *   npm run probe                      (se conecta a ws://localhost:8787)
 *   RELAY_URL=wss://tu-tunel npm run probe
 */
import WebSocket from "ws";

const url = process.env.RELAY_URL ?? "ws://localhost:8787";
const FRAME = { SNAPSHOT: 0x00, DELTA: 0x01 } as const;

let width = 128;
let height = 128;
let pixels = new Uint8Array(width * height);

/** Dibuja el lienzo en la terminal, submuestreado para que quepa.
 *  Cada carácter representa un bloque de 2x4 píxeles. */
function render(): string {
  const stepX = 2;
  const stepY = 4;
  const rows: string[] = [];
  for (let y = 0; y < height; y += stepY) {
    let row = "";
    for (let x = 0; x < width; x += stepX) {
      let painted = false;
      for (let dy = 0; dy < stepY && !painted; dy++) {
        for (let dx = 0; dx < stepX && !painted; dx++) {
          if (pixels[(y + dy) * width + (x + dx)]) painted = true;
        }
      }
      row += painted ? "#" : "·";
    }
    rows.push("  " + row);
  }
  return rows.join("\n");
}

let statsTick = 0;
const socket = new WebSocket(url);

socket.on("open", () => console.log(`\n  Conectado a ${url}\n`));

socket.on("message", (data: Buffer, isBinary: boolean) => {
  if (!isBinary) {
    const msg = JSON.parse(data.toString());
    if (msg.type === "stats") {
      const line =
        `  bloque ${msg.block} · ${msg.tps} TPS (pico ${msg.peakTps}) · ` +
        `${msg.painted} píxeles · ${msg.clients} clientes`;
      // En una terminal real sobrescribimos la línea; si la salida está
      // redirigida a un archivo, imprimimos solo de vez en cuando para no
      // generar miles de líneas.
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${line}    `);
      } else if (statsTick++ % 20 === 0) {
        console.log(line);
      }
    } else if (msg.type === "paints") {
      console.log("");
      for (const p of msg.items) {
        const x = p.idx % width;
        const y = Math.floor(p.idx / width);
        console.log(
          `  PINTADO  (${String(x).padStart(3)},${String(y).padStart(3)})  ` +
            `color ${String(p.color).padStart(3)}  por ${p.painter}`,
        );
      }
    }
    return;
  }

  const type = data.readUInt8(0);

  if (type === FRAME.SNAPSHOT) {
    width = data.readUInt16LE(1);
    height = data.readUInt16LE(3);
    pixels = new Uint8Array(data.subarray(5, 5 + width * height));
    const painted = pixels.reduce((n, v) => n + (v ? 1 : 0), 0);
    console.log(`  SNAPSHOT  ${width}x${height} · ${painted} píxeles pintados`);
    console.log(`            ${data.length} bytes recibidos\n`);
    if (painted > 0 && painted <= 20) {
      for (let i = 0; i < pixels.length; i++) {
        if (pixels[i]) {
          console.log(
            `            píxel ${i} → (${i % width},${Math.floor(i / width)}) color ${pixels[i]}`,
          );
        }
      }
      console.log("");
    }
    console.log(render());
    console.log("");
  } else if (type === FRAME.DELTA) {
    const n = data.readUInt16LE(1);
    for (let i = 0; i < n; i++) {
      const off = 3 + i * 3;
      pixels[data.readUInt16LE(off)] = data.readUInt8(off + 2);
    }
    console.log(`\n  DELTA  ${n} píxeles (${data.length} bytes)`);
  }
});

socket.on("close", () => console.log("\n  Conexión cerrada\n"));
socket.on("error", (err) => console.error("\n  Error:", err.message, "\n"));

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // `--host` ya expone el servidor en la red local, para que puedas abrirlo
    // desde el celular con la IP de tu máquina (ej. http://192.168.1.42:5173).
    host: true,

    // Vite bloquea hosts desconocidos por defecto. Sin esto, abrir el dev
    // server a través de un túnel de cloudflared da un error de "host not
    // allowed". Es un servidor de desarrollo local, así que abrirlo es
    // aceptable aquí; en producción se sirve el build estático, no esto.
    allowedHosts: true,
  },
});

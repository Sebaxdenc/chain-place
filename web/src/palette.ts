/**
 * Paleta de 16 colores. El índice es lo que se guarda on-chain (1 byte), así
 * que la paleta vive solo en el cliente: cambiarla no requiere redesplegar el
 * contrato, pero sí reinterpreta los píxeles ya pintados.
 *
 * El índice 0 es el blanco y hace de "sin pintar": un píxel nunca tocado vale
 * 0 en el contrato, así que el lienzo vacío sale blanco de forma natural.
 * También sirve de goma de borrar.
 *
 * El contrato acepta hasta 256 colores (el campo es uint8), así que hay sitio
 * de sobra si quieres ampliar.
 */
export interface Color {
  hex: string;
  rgb: readonly [number, number, number];
  name: string;
}

const make = (hex: string, name: string): Color => ({
  hex,
  name,
  rgb: [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ] as const,
});

export const PALETTE: readonly Color[] = [
  make("#ffffff", "blanco"),
  make("#e4e4e4", "gris claro"),
  make("#888888", "gris"),
  make("#222222", "negro"),
  make("#ffa7d1", "rosa"),
  make("#e50000", "rojo"),
  make("#e59500", "naranja"),
  make("#a06a42", "marrón"),
  make("#e5d900", "amarillo"),
  make("#94e044", "verde claro"),
  make("#02be01", "verde"),
  make("#00d3dd", "cian"),
  make("#0083c7", "azul"),
  make("#0000ea", "azul oscuro"),
  make("#cf6ee4", "magenta"),
  make("#820080", "púrpura"),
];

/** Tabla de búsqueda plana para el renderizado: evita indexar objetos dentro
 *  del bucle que recorre 16.384 píxeles. */
export const PALETTE_RGB = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const color = PALETTE[i % PALETTE.length]!;
  PALETTE_RGB[i * 3] = color.rgb[0];
  PALETTE_RGB[i * 3 + 1] = color.rgb[1];
  PALETTE_RGB[i * 3 + 2] = color.rgb[2];
}

/** Solo lo que el frontend necesita de BlitzCanvas.
 *
 *  `Painted` y `colorsOf` solo se usan en modo directo (sin relay); en modo
 *  relay los datos del lienzo llegan ya decodificados por WebSocket. */
export const canvasAbi = [
  {
    type: "event",
    name: "Painted",
    inputs: [
      { name: "idx", type: "uint32", indexed: true },
      { name: "color", type: "uint8", indexed: false },
      { name: "painter", type: "address", indexed: true },
    ],
  },
  {
    type: "function",
    name: "colorsOf",
    stateMutability: "view",
    inputs: [
      { name: "start", type: "uint32" },
      { name: "count", type: "uint32" },
    ],
    outputs: [{ name: "out", type: "bytes" }],
  },
  {
    type: "function",
    name: "paint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "idx", type: "uint32" },
      { name: "color", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "paintMany",
    stateMutability: "nonpayable",
    inputs: [
      { name: "idxs", type: "uint32[]" },
      { name: "colors", type: "uint8[]" },
    ],
    outputs: [],
  },
] as const;

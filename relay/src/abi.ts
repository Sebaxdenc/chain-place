/** Solo la parte del ABI de BlitzCanvas que el relay necesita.
 *
 *  OJO: la firma de `Painted` tiene que coincidir exactamente con el contrato.
 *  Si cambia allí y no aquí, el relay deja de recibir píxeles EN SILENCIO —
 *  no hay error, simplemente no llega nada. Por eso el contrato tiene un test
 *  (`test_PaintEmitsEvent`) que fija esta firma. */
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
    name: "WIDTH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint32" }],
  },
  {
    type: "function",
    name: "HEIGHT",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint32" }],
  },
] as const;

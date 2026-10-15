/** Solo lo que el frontend necesita de BlitzCanvas. */
export const canvasAbi = [
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

// Shared art direction for every experience: cobalt → lunar violet → eclipse rose.
export const PALETTES = [
  {
    id: "eclipse",
    name: "Lunar eclipse",
    cold: "#3865ed",
    mid: "#885bd9",
    hot: "#e35b80",
  },
  {
    id: "moonrise",
    name: "Moonrise",
    cold: "#315ee5",
    mid: "#7166db",
    hot: "#b97ccc",
  },
  {
    id: "blush",
    name: "Blush",
    cold: "#5653c8",
    mid: "#a354bb",
    hot: "#ee687d",
  },
];

export function getPalette(id) {
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES[0];
}

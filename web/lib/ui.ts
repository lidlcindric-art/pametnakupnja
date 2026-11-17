export const CAT_EMOJI: Record<string, string> = {
  "Voće i povrće": "🥕",
  "Mliječni proizvodi i jaja": "🥛",
  "Meso i riba": "🥩",
  "Kruh i tijesto": "🍞",
  "Tjestenina, riža i žitarice": "🍝",
  "Brašno, šećer i pečenje": "🌾",
  "Ulje, ocat i umaci": "🫒",
  "Začini i dodaci": "🧂",
  "Orašasti plodovi i suho voće": "🥜",
  "Piće": "🧃",
};
export const catEmoji = (c?: string) => (c && CAT_EMOJI[c]) || "🛒";

/** Košarica u URL-u: #k=12x2,7,20 */
export const encodeBasket = (b: Record<number, number>) =>
  Object.entries(b).map(([id, q]) => (q > 1 ? `${id}x${q}` : id)).join(",");
export function decodeBasket(s: string): Record<number, number> {
  const out: Record<number, number> = {};
  for (const p of s.split(",")) {
    const [id, q] = p.split("x").map((x) => parseInt(x, 10));
    if (id > 0) out[id] = Math.min(99, Math.max(1, q || 1));
  }
  return out;
}

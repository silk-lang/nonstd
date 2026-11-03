// Feature rows for a word, and the vocabulary that shares its hash buckets.
import { record } from "./common.mjs";
export function wordFeatures(word) {
  const src = `x ${word} x`;
  const rec = record({ source: src, sourceLabels: [{ from: 0, to: src.length, class: "plain" }], language: "silk" });
  for (let i = 0; i < rec.features.length; i++) if (rec.text?.(i) === word || src.slice(rec.ranges[i*2], rec.ranges[i*2+1]) === word) return [...rec.features[i]];
  throw new Error(`no part for ${word}`);
}
export const PRIMARY = 268, SECONDARY = 524;
export function buckets(word) {
  const f = wordFeatures(word);
  return { primary: f.find((x) => x >= PRIMARY && x < PRIMARY + 256), secondary: f.find((x) => x >= SECONDARY && x < SECONDARY + 128), all: f };
}

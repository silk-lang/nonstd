// Weight edits on the int6 grid. Every edit adds a float vector to a tensor slice and
// re-rounds to that tensor's existing scale, so untouched weights stay bit-identical.
import { loadModel, cloneModel, saveModel, LEVELS } from "./common.mjs";
import { buckets, wordFeatures, PRIMARY, SECONDARY } from "./words.mjs";

export const H = 32;
export const ROW = { kind: 0, length: 4, first: 12, last: 140, primary: PRIMARY, secondary: SECONDARY, flags: 652 };

export function editor(path) {
  const m = loadModel(path);
  const e = cloneModel(m);
  const log = [];
  const row = (r, src = e) => Float32Array.from(src.q.featureEmbedding.subarray(r * H, r * H + H), (c) => c * src.scale.featureEmbedding);
  const baseRow = (r) => row(r, m);
  function addTo(tensor, offset, vector, alpha = 1, note = "") {
    const s = e.scale[tensor];
    let clipped = 0, changed = 0;
    for (let k = 0; k < vector.length; k++) {
      const cur = e.q[tensor][offset + k];
      let next = Math.round((cur * s + alpha * vector[k]) / s);
      if (next > LEVELS || next < -LEVELS) { clipped++; next = Math.max(-LEVELS, Math.min(LEVELS, next)); }
      if (next !== cur) changed++;
      e.q[tensor][offset + k] = next;
    }
    log.push({ tensor, offset, length: vector.length, changed, clipped, note });
  }
  const addRow = (r, v, alpha, note) => addTo("featureEmbedding", r * H, v, alpha, note);
  /** Mean of (primary + secondary) hash rows over words, from the unedited model. */
  function hashMean(words) {
    const out = new Float32Array(H);
    for (const w of words) {
      const b = buckets(w);
      const p = baseRow(b.primary), s = baseRow(b.secondary);
      for (let h = 0; h < H; h++) out[h] += (p[h] + s[h]) / words.length;
    }
    return out;
  }
  /** Push a word's identity along `dir`, half through each of its two hash rows. */
  function pushWord(word, dir, alpha, note = word) {
    const b = buckets(word);
    addRow(b.primary, dir, alpha / 2, `${note} primary`);
    addRow(b.secondary, dir, alpha / 2, `${note} secondary`);
  }
  const sub = (a, b) => Float32Array.from(a, (v, i) => v - b[i]);
  const norm = (v) => Math.hypot(...v);
  return { m, e, log, row, baseRow, addTo, addRow, hashMean, pushWord, sub, norm, buckets, wordFeatures,
    save: (out) => saveModel(e, out),
    changedWeights() {
      let n = 0;
      for (const name of Object.keys(m.q)) for (let i = 0; i < m.q[name].length; i++) n += Number(m.q[name][i] !== e.q[name][i]);
      return n;
    } };
}

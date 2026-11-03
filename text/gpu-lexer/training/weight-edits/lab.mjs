// Experiment bench: datasets with cached activations, fast scoring, error tables.
import { readFileSync } from "node:fs";
import { loadModel, floats, record, classNames, scored } from "./common.mjs";
import { forward, head, argmax } from "./fast.mjs";

const DATA = process.env.WEIGHT_EDITS_DATA ?? new URL("data", import.meta.url).pathname;
export const BASE = new URL("../../model/tree.json", import.meta.url).pathname;

export function loadSet(name) {
  const items = JSON.parse(readFileSync(`${DATA}/${name}.json`, "utf8"));
  return items.map((item) => {
    const rec = record(item);
    const ranges = rec.ranges;
    rec.text = (i) => item.source.slice(ranges[i * 2], ranges[i * 2 + 1]);
    rec.source = item.source;
    return rec;
  });
}

/** Run the full model on every record; keeps joined activations for head-only re-scoring. */
export function run(m, records) {
  return records.map((rec) => ({ rec, joined: forward(m, rec) }));
}

/** Score cached activations with (possibly edited) head weights. */
export function score(m, runs, { errors = false } = {}) {
  const K = classNames.length;
  const confusion = classNames.map(() => new Array(K).fill(0));
  let correct = 0, total = 0;
  const logits = new Float32Array(K), hid = new Float32Array(72);
  const errs = new Map();
  const preds = [];
  for (const { rec, joined } of runs) {
    const p = new Uint8Array(rec.features.length);
    for (let i = 0; i < rec.features.length; i++) {
      if (!scored(rec, i)) continue;
      const y = argmax(head(m, joined, i * 64, logits, hid));
      p[i] = y;
      const t = rec.targets[i];
      confusion[t][y] += 1; total += 1;
      if (y === t) correct += 1;
      else if (errors) {
        const key = `${classNames[t]}>${classNames[y]} ${JSON.stringify(rec.text(i))}`;
        errs.set(key, (errs.get(key) ?? 0) + 1);
      }
    }
    preds.push(p);
  }
  const perClass = classNames.map((name, c) => {
    const support = confusion[c].reduce((a, b) => a + b, 0);
    const predicted = confusion.reduce((a, row) => a + row[c], 0);
    return { name, support, f1: 2 * confusion[c][c] / Math.max(1, support + predicted) };
  });
  return { accuracy: correct / Math.max(1, total), correct, total, confusion, perClass, errs, preds };
}

export function fmt(r) {
  return `${(100 * r.accuracy).toFixed(2)}% (${r.correct}/${r.total}) ` +
    r.perClass.filter((c) => c.support).map((c) => `${c.name}=${(100 * c.f1).toFixed(1)}`).join(" ");
}

export function topErrors(r, n = 40) {
  return [...r.errs].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${String(v).padStart(6)} ${k}`).join("\n");
}

export function byLanguage(m, runs) {
  const out = {};
  for (const run of runs) {
    const r = score(m, [run]);
    const b = out[run.rec.language] ??= [0, 0];
    b[0] += r.correct; b[1] += r.total;
  }
  return Object.fromEntries(Object.entries(out).map(([l, [c, t]]) => [l, c / t]));
}

export { loadModel, floats, classNames };

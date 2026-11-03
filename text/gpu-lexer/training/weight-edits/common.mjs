// Shared helpers: load and save the promoted tree model on its int6 grid, build labeled
// records, run the CPU reference forward pass and score it.
import { readFileSync, writeFileSync } from "node:fs";

// Path to a gpu-lexer checkout at the commit in ../apply.mjs, with the Silk overlay applied and
// `pnpm install` run (Shiki is needed for labels).
const GL = `${process.env.GPU_LEXER ?? "gpu-lexer"}/packages`;
export const { treeProbabilities, createTreeRecord, treeAuxiliaryNames } = await import(`${GL}/training/src/tree-model.js`);
export const { classNames } = await import(`${GL}/training/src/classes.js`);
export const { treeFeatureLayout } = await import(`${GL}/core/src/tree-features.js`);
export const { prepareTreeSource, releaseTreePrepared } = await import(`${GL}/core/src/prepare-tree.js`);
const labelModule = () => import(`${GL}/training/src/label.js`);

const SYMBOLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export const LEVELS = 31;

/** Load tree.json. Each tensor keeps its int6 codes (`q`) and per-tensor scale. */
export function loadModel(path) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  const codes = Int8Array.from(json.weights, (ch) => {
    const s = SYMBOLS.indexOf(ch);
    return s % 2 === 0 ? s / 2 : -(s + 1) / 2;
  });
  const q = {}, scale = {};
  for (const t of json.quantization.tensors) {
    q[t.name] = codes.slice(t.offset, t.offset + t.length);
    scale[t.name] = t.scale;
  }
  return { json, q, scale };
}

/** Float view used by the forward pass. */
export function floats(m) {
  const out = {};
  for (const [name, codes] of Object.entries(m.q)) out[name] = Float32Array.from(codes, (c) => c * m.scale[name]);
  return out;
}

export function cloneModel(m) {
  const q = {};
  for (const [k, v] of Object.entries(m.q)) q[k] = v.slice();
  return { json: m.json, q, scale: { ...m.scale } };
}

export function saveModel(m, path) {
  let weights = "";
  for (const t of m.json.quantization.tensors) for (const c of m.q[t.name]) {
    if (c < -LEVELS || c > LEVELS) throw new Error(`${t.name} code ${c} out of range`);
    weights += SYMBOLS[c < 0 ? -c * 2 - 1 : c * 2];
  }
  writeFileSync(path, JSON.stringify({ ...m.json, weights }) + "\n");
}

export const config = { hiddenSize: 32, classifierSize: 72 };

let labeler;
export async function label(source, language) {
  if (!labeler) {
    const { createLabeler } = await labelModule();
    labeler = await createLabeler({ langs: ["silk", "python", "c", "javascript", "typescript", "rust", "go",
      "ruby", "shellscript", "css", "html", "markdown", "json", "yaml", "sql", "toml"] });
  }
  return labeler.labelSource(source, language);
}

export function record(item) {
  const r = createTreeRecord(item, 256, { retainSource: true }).record;
  return r;
}

/** Per-part predictions for a record. */
export function predict(model, rec) {
  const probs = treeProbabilities(model, rec, config);
  return probs.map((p) => { let b = 0; for (let i = 1; i < p.length; i++) if (p[i] > p[b]) b = i; return b; });
}

export function scored(rec, index) {
  const kind = rec.features[index][0];
  return kind !== 1 && kind !== 2 && rec.supervisionWeights[index] !== 0;
}

/** Accuracy and confusion over records. */
export function evaluate(model, records, { keep = false } = {}) {
  const confusion = classNames.map(() => new Array(classNames.length).fill(0));
  let correct = 0, total = 0;
  const preds = [];
  for (const rec of records) {
    const p = predict(model, rec);
    if (keep) preds.push(p);
    for (let i = 0; i < p.length; i++) if (scored(rec, i)) {
      confusion[rec.targets[i]][p[i]] += 1;
      correct += Number(p[i] === rec.targets[i]);
      total += 1;
    }
  }
  const perClass = classNames.map((name, c) => {
    const support = confusion[c].reduce((a, b) => a + b, 0);
    const predicted = confusion.reduce((a, row) => a + row[c], 0);
    const tp = confusion[c][c];
    return { name, support, f1: 2 * tp / Math.max(1, support + predicted) };
  });
  return { accuracy: correct / Math.max(1, total), correct, total, confusion, perClass, preds };
}

export function summary(r) {
  return `${(100 * r.accuracy).toFixed(2)}% (${r.correct}/${r.total}) ` +
    r.perClass.map((c) => `${c.name}=${(100 * c.f1).toFixed(1)}`).join(" ");
}

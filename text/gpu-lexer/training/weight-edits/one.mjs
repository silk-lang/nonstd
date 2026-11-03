import { loadSet, run, score, byLanguage, loadModel, floats } from "./lab.mjs";
const [path, set] = process.argv.slice(2);
const m = floats(loadModel(path));
const runs = run(m, loadSet(set));
const r = score(m, runs);
const out = { accuracy: r.accuracy, f1: Object.fromEntries(r.perClass.map((c) => [c.name, c.support ? c.f1 : null])) };
if (set === "guard") out.languages = byLanguage(m, runs);
process.stdout.write(JSON.stringify(out));

// node diff.mjs <a.json> <b.json> <set> [language] -> tokens fixed/broken going from a to b
import { loadSet, run, score, loadModel, floats, classNames } from "./lab.mjs";
import { scored } from "./common.mjs";
const [a, b, set, lang] = process.argv.slice(2);
let recs = loadSet(set); if (lang) recs = recs.filter((r) => r.language === lang);
const ma = floats(loadModel(a)), mb = floats(loadModel(b));
const ra = score(ma, run(ma, recs)), rb = score(mb, run(mb, recs));
const fixed = new Map(), broken = new Map();
recs.forEach((rec, k) => { for (let i = 0; i < rec.features.length; i++) if (scored(rec, i)) {
  const t = rec.targets[i], pa = ra.preds[k][i], pb = rb.preds[k][i];
  if (pa === pb) continue;
  const key = `${rec.language} ${JSON.stringify(rec.text(i))} ${classNames[t]}: ${classNames[pa]}>${classNames[pb]}`;
  const map = pb === t ? fixed : pa === t ? broken : broken;
  map.set(key, (map.get(key) ?? 0) + 1);
}});
const top = (m) => [...m].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => `  ${String(v).padStart(5)} ${k}`).join("\n");
console.log(`fixed ${[...fixed.values()].reduce((x, y) => x + y, 0)}\n${top(fixed)}\nbroken/changed ${[...broken.values()].reduce((x, y) => x + y, 0)}\n${top(broken)}`);

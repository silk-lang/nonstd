// node bench.mjs <tree.json> [sets]  -> evaluates sets in parallel child processes, prints vs base.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const exec = promisify(execFile);
const here = new URL(".", import.meta.url).pathname;
const CACHE = `${process.env.WEIGHT_EDITS_DATA ?? `${here}data`}/base-results.json`;

const [model, setsArg] = process.argv.slice(2);
const sets = (setsArg ?? "dev,test,guard").split(",");
const results = Object.fromEntries(await Promise.all(sets.map(async (set) => {
  const { stdout } = await exec("node", [`${here}one.mjs`, model, set], { maxBuffer: 1 << 26 });
  return [set, JSON.parse(stdout)];
})));
let base = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : null;
if (model.endsWith("gpu-lexer/model/tree.json")) { base = { ...base, ...results }; writeFileSync(CACHE, JSON.stringify(base)); }
const pct = (x) => (100 * x).toFixed(2);
const d = (a, b) => (b == null ? "" : `${a - b >= 0 ? "+" : ""}${(100 * (a - b)).toFixed(2)}`);
for (const set of sets) {
  const r = results[set], b = base?.[set];
  console.log(`${set.padEnd(5)} ${pct(r.accuracy)}% (${d(r.accuracy, b?.accuracy)})  ` +
    Object.entries(r.f1).filter(([, v]) => v != null).map(([k, v]) => `${k}=${(100 * v).toFixed(1)}(${d(v, b?.f1[k])})`).join(" "));
  if (r.languages) console.log("      " + Object.entries(r.languages).map(([l, v]) => `${l}=${pct(v)}(${d(v, b?.languages?.[l])})`).join(" "));
}

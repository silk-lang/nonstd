// Labels the three evaluation sets with Shiki and caches source + labels in $WEIGHT_EDITS_DATA:
//   dev   : Silk files from silk-lang/silk and read-fonts (edits are chosen on these)
//   test  : every Silk file in silk-layout (held out; upstream's Silk verification repository)
//   guard : other languages, from a list of `language<TAB>path` lines (regression check)
// Usage: node build-data.mjs <dir with silk, read-fonts and silk-layout clones> <guard list>
// The clones are the commits pinned in ../apply.mjs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { label } from "./common.mjs";

const [repos, guardList] = process.argv.slice(2);
if (!repos || !guardList) throw new Error("usage: node build-data.mjs <silk repos dir> <guard list>");
const OUT = process.env.WEIGHT_EDITS_DATA ?? new URL("data", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const hash = (s) => createHash("sha256").update(s).digest("hex");
// Deterministic sample: the n paths with the smallest sha256.
const pick = (files, n) => files.map((f) => [hash(f), f]).sort().slice(0, n).map(([, f]) => f);
const silkFiles = (dir) => execFileSync("find", [dir, "-name", "*.silk", "-size", "-48k", "-size", "+300c"], { encoding: "utf8" })
  .split("\n").filter(Boolean).sort();

async function build(name, entries) {
  const items = [];
  for (const { path, language } of entries) {
    const source = readFileSync(path, "utf8");
    if (!source.trim() || source.includes("\0")) continue;
    try {
      items.push({ path, language, source, sourceLabels: await label(source, language) });
    } catch (error) { console.warn(`skip ${path}: ${error.message}`); }
  }
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(items));
  console.log(`${name}: ${items.length} files, ${items.reduce((a, i) => a + i.source.length, 0)} UTF-16 units`);
}

const dev = [...pick(silkFiles(`${repos}/silk`), 120), ...pick(silkFiles(`${repos}/read-fonts`), 60)];
await build("dev", dev.map((path) => ({ path, language: "silk" })));
await build("test", silkFiles(`${repos}/silk-layout`).map((path) => ({ path, language: "silk" })));
await build("guard", readFileSync(guardList, "utf8").split("\n").filter(Boolean).map((line) => {
  const [language, path] = line.split("\t");
  return { language, path };
}));
process.exit(0);

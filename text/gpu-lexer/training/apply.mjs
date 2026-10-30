// Adds Silk to a gpu-lexer training checkout: the Silk TextMate grammar, `.silk` files, Silk
// corpora and sampling weights. Usage: node apply.mjs <gpu-lexer checkout at UPSTREAM_COMMIT>
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const UPSTREAM_COMMIT = "4f36e39062dc83871a6dcaa86bc55904ecd3f456";

const SILK_TRAIN = [
  { repo: "silk-lang/silk", commit: "9358f977aa9f86c1fa31f48fc66e8194e08c93a7", license: "MIT" },
  { repo: "julia-script/read-fonts", commit: "c67a5237abc535b2751b29709e2184cfcfe66c63", license: "MIT" },
];
const SILK_VERIFICATION = [
  { repo: "silk-lang/silk-layout", commit: "ec029eaaa72bbade53beeb771f78dcc6c651c32a", license: "MIT" },
];

const checkout = process.argv[2];
if (!checkout) throw new Error("usage: node apply.mjs <gpu-lexer checkout>");
const head = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== UPSTREAM_COMMIT) throw new Error(`expected gpu-lexer ${UPSTREAM_COMMIT}, found ${head}`);
const here = new URL(".", import.meta.url).pathname;
const training = join(checkout, "packages/training");

// corpus.js maps `.silk`, label.js loads the grammar, fetch-corpus.js fetches with git (the archive
// endpoint is not reachable from every network).
execFileSync("git", ["-C", checkout, "apply", join(here, "silk.patch")], { stdio: "inherit" });
copyFileSync(join(here, "silk.tmLanguage.json"), join(training, "data/silk.tmLanguage.json"));

const corpusPath = join(training, "data/corpus.json");
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
corpus.policy.supplementalSamplingWeights.silk = 3;
corpus.policy.trainingSamplingWeights.silk = 6;
corpus.policy.minimumLanguageTokens.verification.silk = 2000;
corpus.train.git.push(...SILK_TRAIN);
corpus.verification.git.push(...SILK_VERIFICATION);
writeFileSync(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`);
console.log("Silk training overlay applied");

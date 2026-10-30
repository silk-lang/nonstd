// Times the original gpu-lexer like bench/ times the port: its CPU passes in Node and both
// models end to end in Chromium's WebGPU (SwiftShader), on the same fixtures and workloads.
// Prints one JSON object per line. Not part of the PR gate.
//
// Usage: node scripts/bench-original.mjs <gpu-lexer checkout at 4f36e39>
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const [upstream] = process.argv.slice(2);
if (!upstream) throw new Error("usage: node scripts/bench-original.mjs <gpu-lexer checkout>");
const root = new URL("../", import.meta.url).pathname;
// The same order and workloads as bench/src/main.silk.
const NAMES = [
  "Makefile", "batch.bat", "c.c", "css.css", "go.go", "html.html", "javascript.js", "json.json",
  "markdown.md", "python.py", "rust.rs", "shader.shader", "shell.sh", "silk.silk", "sql.sql",
  "typescript.ts", "unicode.txt", "yaml.yaml",
];
const LARGE_REPEATS = 16;
const fixtures = NAMES.map((name) => readFileSync(join(root, "tests/fixtures", name), "utf8"));
const workloads = [
  ["fixtures", fixtures],
  ["large", [fixtures.join("").repeat(LARGE_REPEATS)]],
];
const utf8Bytes = (sources) => sources.reduce((total, text) => total + Buffer.byteLength(text), 0);

// Median of at least 5 runs and 1 s of work, in microseconds.
async function measure(run) {
  const times = [];
  let total = 0;
  while (times.length < 5 || total < 1000) {
    const start = performance.now();
    await run();
    const elapsed = performance.now() - start;
    times.push(elapsed);
    total += elapsed;
  }
  times.sort((left, right) => left - right);
  return { runs: times.length, medianUs: Math.round(times[times.length >> 1] * 1000) };
}

const report = (workload, step, sources, result) =>
  console.log(JSON.stringify({ engine: "original", workload, step, bytes: utf8Bytes(sources), ...result }));

const core = join(upstream, "packages/core/src");
const { prepareTreeSource, releaseTreePrepared } = await import(join(core, "prepare-tree.js"));
const { tokenize } = await import(join(core, "lex/lite/tokenizer.js"));
for (const [workload, sources] of workloads) {
  report(workload, "cpu-tree", sources, await measure(() => {
    for (const text of sources) releaseTreePrepared(prepareTreeSource(text));
  }));
  report(workload, "cpu-lite", sources, await measure(() => {
    for (const text of sources) tokenize(text);
  }));
}

const { chromium } = await import("playwright");
const server = createServer((request, response) => {
  const path = join(upstream, decodeURIComponent(request.url.split("?")[0]));
  try {
    let body = request.url === "/" ? "<!doctype html><title>bench</title>" : readFileSync(path);
    if (path.endsWith(".wgsl")) body = `export default ${JSON.stringify(body.toString())};`;
    response.writeHead(200, { "content-type": request.url === "/" ? "text/html" : "text/javascript" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
}).listen(0);
await new Promise((resolve) => server.on("listening", resolve));
const browser = await chromium.launch({
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=vulkan", "--use-vulkan=swiftshader", "--disable-vulkan-surface"],
});
const page = await browser.newPage();
page.on("console", (message) => console.error(`console: ${message.text()}`));
await page.goto(`http://localhost:${server.address().port}/`);
for (const [entry, step] of [["index", "tree"], ["lite", "lite"]]) {
  for (const [workload, sources] of workloads) {
    const result = await page.evaluate(async ({ entry, sources, measure }) => {
      const { parse } = await import(`/packages/core/src/${entry}.js`);
      // Calls made together are batched into one submission, like parseMany.
      const run = () => Promise.all(sources.map((text) => parse(text)));
      await run();
      return await (0, eval)(`(${measure})`)(run);
    }, { entry, sources, measure: measure.toString() });
    report(workload, step, sources, result);
  }
}
await browser.close();
server.close();

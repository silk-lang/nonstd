// Times the port compiled to wasm32 next to the original, in the same Chromium page and on the
// same WebGPU device (SwiftShader): both CPU passes, and both models end to end. Also checks
// that the port's spans match the original's. Prints one JSON object per line.
//
// Usage: node wasm/bench.mjs <port.wasm> <gpu-lexer checkout at 4f36e39>
// Build the wasm with text/gpu-lexer/scripts/bench-wasm, which also runs this.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve, extname } from "node:path";
import { createRequire } from "node:module";

const [wasmPath, upstream] = process.argv.slice(2);
if (!wasmPath || !upstream) throw new Error("usage: node wasm/bench.mjs <port.wasm> <gpu-lexer checkout>");
const lexer = new URL("../", import.meta.url).pathname;
const webgpu = resolve(lexer, "../../gpu/webgpu");
const NAMES = [
  "Makefile", "batch.bat", "c.c", "css.css", "go.go", "html.html", "javascript.js", "json.json",
  "markdown.md", "python.py", "rust.rs", "shader.shader", "shell.sh", "silk.silk", "sql.sql",
  "typescript.ts", "unicode.txt", "yaml.yaml",
];
const LARGE_REPEATS = 16;
const fixtures = NAMES.map((name) => readFileSync(join(lexer, "tests/fixtures", name), "utf8"));
const workloads = [["fixtures", fixtures], ["large", [fixtures.join("").repeat(LARGE_REPEATS)]]];

const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  try {
    if (path === "/") { response.writeHead(200, { "content-type": "text/html" }); response.end("<!doctype html><title>bench</title>"); return; }
    if (path === "/port.wasm") { response.writeHead(200, { "content-type": "application/wasm" }); response.end(readFileSync(wasmPath)); return; }
    const file = path.startsWith("/webgpu/") ? join(webgpu, path.slice(8)) : join(upstream, path);
    let body = readFileSync(file);
    if (extname(file) === ".wgsl") body = `export default ${JSON.stringify(body.toString())};`;
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
}).listen(0);
await new Promise((done) => server.on("listening", done));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=vulkan", "--use-vulkan=swiftshader", "--disable-vulkan-surface"],
});
const page = await browser.newPage();
page.on("console", (message) => console.error(`console: ${message.text()}`));
await page.goto(`http://localhost:${server.address().port}/`);

const results = await page.evaluate(async (workloads) => {
  const { WebGPUHost } = await import("/webgpu/browser/host.ts");
  const { prepareTreeSource, releaseTreePrepared } = await import("/packages/core/src/prepare-tree.js");
  const { tokenize } = await import("/packages/core/src/lex/lite/tokenizer.js");
  const original = { tree: (await import("/packages/core/src/index.js")).parse, lite: (await import("/packages/core/src/lite.js")).parse };

  const host = new WebGPUHost();
  const module = await WebAssembly.compileStreaming(fetch("/port.wasm"));
  host.attach(await WebAssembly.instantiate(module, { webgpu: host.imports }));
  let wake = null;
  host.onWake = () => wake?.();
  // Polls `step` until it returns nonzero, sleeping until the host wakes or a frame passes.
  const until = async (step) => {
    for (;;) {
      const status = step();
      if (status < 0) throw new Error("the port failed");
      if (status > 0) return;
      await new Promise((done) => { wake = done; setTimeout(done, 1); });
      wake = null;
    }
  };
  const token = host.call("lexer_start", 1);
  if (!token) throw new Error("lexer_start failed");
  await until(() => host.call("lexer_poll", token));

  const encoder = new TextEncoder();
  // Copies the sources into the port's memory as UTF-8, as a caller holding JS strings must.
  const load = (sources) => {
    const encoded = sources.map((text) => encoder.encode(text));
    const total = encoded.reduce((sum, bytes) => sum + bytes.length, 0);
    const input = host.call("input_bytes", token, total);
    let at = input;
    for (const bytes of encoded) { new Uint8Array(host.exports.memory.buffer, at, bytes.length).set(bytes); at += bytes.length; }
    const lengths = host.call("input_lengths", token, encoded.length);
    new Uint32Array(host.exports.memory.buffer, lengths, encoded.length).set(encoded.map((bytes) => bytes.length));
  };
  // performance.now is coarse in pages (100 us), so a CPU step repeats until a sample is 20 ms.
  const measure = async (run, repeat = 1) => {
    const times = [];
    let total = 0;
    while (times.length < 5 || total < 1000) {
      const start = performance.now();
      for (let index = 0; index < repeat; index++) await run();
      const elapsed = (performance.now() - start) / repeat;
      times.push(elapsed);
      total += elapsed * repeat;
    }
    times.sort((left, right) => left - right);
    return { runs: times.length, medianUs: Math.round(times[times.length >> 1] * 1000) };
  };
  const portSpans = async (sources, lite) => {
    load(sources);
    if (host.call("lex_submit", token, lite) < 0) throw new Error("lex_submit failed");
    await until(() => host.call("lex_finish", token, lite));
  };
  // Per-byte classes of the original's spans and of the port's last spans, for a parity count.
  const classes = ["plain", "comment", "string", "number", "keyword", "type", "function", "constant", "operator"];
  const originalBytes = (sources, spans) => {
    const out = [];
    sources.forEach((text, index) => {
      for (const span of spans[index]) {
        const length = encoder.encode(text.slice(span.start, span.end)).length;
        for (let i = 0; i < length; i++) out.push(classes.indexOf(span.type));
      }
    });
    return out;
  };
  const portBytes = () => {
    const count = host.call("span_count", token);
    const words = new Uint32Array(host.exports.memory.buffer, host.call("span_words", token), count * 3);
    const out = [];
    for (let i = 0; i < count; i++) for (let at = words[i * 3 + 1]; at < words[i * 3 + 2]; at++) out.push(words[i * 3]);
    return out;
  };

  const repeats = (run) => {
    const start = performance.now();
    let count = 0;
    while (performance.now() - start < 20) { run(); count++; }
    return count;
  };
  const cpu = (run) => measure(run, repeats(run));
  const results = [];
  for (const [workload, sources] of workloads) {
    const bytes = sources.reduce((sum, text) => sum + encoder.encode(text).length, 0);
    const row = (engine, step, result, extra = {}) => results.push({ engine, workload, step, bytes, ...result, ...extra });
    // The port's CPU steps include copying the sources into its memory as UTF-8; the "copy"
    // step times that copy alone.
    row("original", "cpu-tree", await cpu(() => { for (const text of sources) releaseTreePrepared(prepareTreeSource(text)); }));
    row("silk-wasm", "cpu-tree", await cpu(() => { load(sources); host.call("cpu_parts", token, 0); }));
    row("original", "cpu-lite", await cpu(() => { for (const text of sources) tokenize(text); }));
    row("silk-wasm", "cpu-lite", await cpu(() => { load(sources); host.call("cpu_parts", token, 1); }));
    row("silk-wasm", "copy", await cpu(() => load(sources)));
    for (const [step, lite] of [["tree", 0], ["lite", 1]]) {
      const run = () => Promise.all(sources.map((text) => original[step](text)));
      const reference = originalBytes(sources, await run());
      row("original", step, await measure(run));
      await portSpans(sources, lite);
      const actual = portBytes();
      const differing = actual.length === reference.length ? actual.filter((value, index) => value !== reference[index]).length : -1;
      row("silk-wasm", step, await measure(() => portSpans(sources, lite)), { differingBytes: differing });
    }
  }
  host.call("lexer_drop", token);
  return results;
}, workloads);
for (const result of results) console.log(JSON.stringify(result));
await browser.close();
server.close();

// Regenerates tests/expected from the original gpu-lexer at the pinned commit: its CPU part
// features (in Node) and both models' spans (in Chromium's WebGPU, through Playwright).
// Not part of the PR gate; run it when fixtures or models change, and review the diff.
//
// Usage: node scripts/expected.mjs <gpu-lexer checkout> [--parts-only]
// Offsets in the expected files are UTF-8 byte offsets, like the Silk API returns.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const [upstream] = process.argv.slice(2);
if (!upstream) throw new Error("usage: node scripts/expected.mjs <gpu-lexer checkout>");
const partsOnly = process.argv.includes("--parts-only");
const root = new URL("../", import.meta.url).pathname;
const fixtures = join(root, "tests/fixtures");
const expected = join(root, "tests/expected");
mkdirSync(expected, { recursive: true });
const names = readdirSync(fixtures).sort();
const sources = names.map((name) => readFileSync(join(fixtures, name), "utf8"));

// UTF-16 offset to UTF-8 byte offset, for one source.
function byteOffsets(text) {
  const offsets = new Uint32Array(text.length + 1);
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    offsets[index] = bytes;
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00) { offsets[index + 1] = bytes; bytes += 4; index++; }
    else bytes += 3;
  }
  offsets[text.length] = bytes;
  return offsets;
}

const hex = (value) => (value >>> 0).toString(16).padStart(8, "0");
const core = join(upstream, "packages/core/src");
const { prepareTreeSource } = await import(join(core, "prepare-tree.js"));
const { tokenize } = await import(join(core, "lex/lite/tokenizer.js"));
names.forEach((name, index) => {
  const text = sources[index];
  const bytes = byteOffsets(text);
  const [data, ranges, , count] = prepareTreeSource(text);
  let tree = "";
  for (let part = 0; part < count; part++) {
    tree += `${bytes[ranges[part * 2]]} ${bytes[ranges[part * 2 + 1]]} ${hex(data[part * 2])} ${hex(data[part * 2 + 1])}\n`;
  }
  writeFileSync(join(expected, `${name}.tree-parts`), tree);
  const lite = tokenize(text);
  let liteText = "";
  for (let part = 0; part < lite.count; part++) {
    liteText += `${bytes[lite.starts[part]]} ${bytes[lite.ends[part]]} ${lite.kinds[part]} ${hex(lite.packed[part * 2])} ${hex(lite.packed[part * 2 + 1])}\n`;
  }
  writeFileSync(join(expected, `${name}.lite-parts`), liteText);
});
if (partsOnly) process.exit(0);

const { chromium } = await import("playwright");
const server = createServer((request, response) => {
  const path = join(upstream, decodeURIComponent(request.url.split("?")[0]));
  try {
    let body = request.url === "/" ? "<!doctype html><title>expected</title>" : readFileSync(path);
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
await page.goto(`http://localhost:${server.address().port}/`);
for (const entry of ["index", "lite"]) {
  const results = await page.evaluate(async ({ entry, sources }) => {
    const { parse } = await import(`/packages/core/src/${entry}.js`);
    return Promise.all(sources.map((source) => parse(source)));
  }, { entry, sources });
  results.forEach((spans, index) => {
    const bytes = byteOffsets(sources[index]);
    const text = spans.map(({ type, start, end }) => `${type} ${bytes[start]} ${bytes[end]}\n`).join("");
    writeFileSync(join(expected, `${names[index]}.${entry === "index" ? "tree" : "lite"}-spans`), text);
  });
}
await browser.close();
server.close();

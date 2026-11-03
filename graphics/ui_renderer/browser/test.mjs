#!/usr/bin/env node
// Runs the compiled ui_renderer browser test in the already installed Chromium (WebGPU through
// navigator.gpu) with gpu/webgpu's host and runner, and compares each fixture's GPU pixels with
// the CPU reference rendered by the same wasm module. Never downloads a browser.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const webgpu = resolve(dirname(fileURLToPath(import.meta.url)), '../../../gpu/webgpu');
const wasmIndex = process.argv.indexOf('--wasm');
if (wasmIndex < 0 || !process.argv[wasmIndex + 1]) throw new Error('Usage: node browser/test.mjs --wasm FILE');
const wasm = await readFile(resolve(process.argv[wasmIndex + 1]));
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch (error) { throw new Error('An existing Playwright installation is required (set PLAYWRIGHT_MODULE to its installed absolute module path); do not run playwright install', { cause: error }); }

// The same names and tolerances as graphics/ui_renderer/fixtures/src/cases.silk. Browser WGSL has
// no strict math, so these are not tightened beyond the native ones.
const fixtures = [
  { name: 'cards', max: 48, share: 0.006, mean: 0.5 },
  { name: 'borders', max: 48, share: 0.006, mean: 0.5 },
  { name: 'shadows', max: 48, share: 0.006, mean: 0.5 },
  { name: 'layers', max: 48, share: 0.006, mean: 0.5 },
  { name: 'nested', max: 48, share: 0.006, mean: 0.5 },
  { name: 'gradients', max: 48, share: 0.006, mean: 0.5 },
  { name: 'effects', max: 48, share: 0.006, mean: 0.5 },
  { name: 'surfaces', max: 48, share: 0.006, mean: 0.5 },
  { name: 'text ramp', max: 1, share: 0, mean: 0.1 },
];

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/ui.wasm') { response.setHeader('Content-Type', 'application/wasm'); response.end(wasm); return; }
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Silk UI renderer test</title>'); return; }
    const path = resolve(webgpu, '.' + decodeURIComponent(pathname));
    if (!path.startsWith(webgpu + sep) || !['.ts', '.js'].includes(extname(path))) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'text/javascript');
    response.end(await readFile(path));
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
const listening = Promise.withResolvers();
server.once('error', listening.reject);
server.listen(0, '127.0.0.1', listening.resolve);
await listening.promise;
let browser;
let failures = 0;
try {
  browser = await chromium.launch({ headless: process.platform !== 'linux',
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: [
    '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan',
    '--disable-vulkan-surface', '--enable-unsafe-swiftshader',
    ...(process.platform === 'linux' ? ['--use-vulkan=swiftshader'] : []),
  ] });
  console.log(`Chromium ${browser.version()} (${process.platform}): ui_renderer against the CPU reference`);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') console.error(`[Chromium ${message.type()}] ${message.text()}`);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const indices = Array.from({ length: fixtures.length * 2 }, (_, i) => i);
  const results = await page.evaluate(async ({ indices }) => {
    const { runSamples } = await import('/browser/runner.ts');
    return await runSamples('/ui.wasm', indices, 60000);
  }, { indices });
  if (errors.length) throw new Error(errors.join('\n'));
  for (const result of results) {
    const fixture = fixtures[result.index % fixtures.length];
    const target = result.index < fixtures.length ? 'rgba8' : 'bgra8';
    const cpu = new Uint8Array(new Uint32Array(result.compute).buffer);
    if (cpu.length !== result.rgba.length) throw new Error(`${fixture.name}: reference size differs`);
    let max = 0, over = 0, sum = 0;
    for (let i = 0; i < cpu.length; i++) {
      const d = Math.abs(cpu[i] - result.rgba[i]);
      max = Math.max(max, d);
      if (d > 8) over++;
      sum += d;
    }
    const mean = sum / cpu.length;
    const ok = max <= fixture.max && over / cpu.length <= fixture.share && mean <= fixture.mean;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${fixture.name} (${target}): max delta ${max}, ${over} of ${cpu.length} channels over 8, mean ${mean.toFixed(4)}`);
  }
} finally {
  await browser?.close();
  const closed = Promise.withResolvers();
  server.close(closed.resolve);
  await closed.promise;
}
if (failures) process.exit(1);

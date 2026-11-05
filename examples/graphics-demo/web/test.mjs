#!/usr/bin/env node
// The demo in the installed Chromium (WebGPU through navigator.gpu, SwiftShader in CI):
//
// 1. `/?check`: the module draws three frames at a fixed time, reads the canvas texture back
//    and compares it with its own CPU reference (examples/graphics-demo/src/compare.silk's tolerance).
// 2. `/`: the interactive page runs for a while with pointer moves, a click, wheel scrolling and
//    the Space and G keys, with no page or WebGPU errors.
//
// Never downloads a browser.
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';

const wasmIndex = process.argv.indexOf('--wasm');
if (wasmIndex < 0 || !process.argv[wasmIndex + 1]) throw new Error('Usage: node web/test.mjs --wasm FILE');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch (error) { throw new Error('An existing Playwright installation is required (set PLAYWRIGHT_MODULE to its installed absolute module path); do not run playwright install', { cause: error }); }

const server = await serve(process.argv[wasmIndex + 1]);
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let failed = false;
try {
  browser = await chromium.launch({ headless: process.platform !== 'linux',
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: [
      '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan',
      '--disable-vulkan-surface', '--enable-unsafe-swiftshader',
      ...(process.platform === 'linux' ? ['--use-vulkan=swiftshader'] : []),
    ] });
  console.log(`Chromium ${browser.version()} (${process.platform}): the drawing layer demo`);
  const context = await browser.newContext({ viewport: { width: 1024, height: 720 }, deviceScaleFactor: 1 });

  const watch = page => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
      if (message.type() === 'error' || message.type() === 'warning') console.error(`[Chromium ${message.type()}] ${message.text()}`);
    });
    return errors;
  };

  // 1. The check.
  const checkPage = await context.newPage();
  const checkErrors = watch(checkPage);
  await checkPage.goto(`${origin}/?check`);
  await checkPage.waitForFunction(() => window.demoResult !== undefined, null, { timeout: 120000 });
  const result = await checkPage.evaluate(() => window.demoResult);
  if (result.error) throw new Error(result.error);
  console.log(`${result.pass ? 'PASS' : 'FAIL'} check: ${result.width} x ${result.height} canvas, max delta ${result.max} at (${result.worstX}, ${result.worstY}), ${result.over} of ${result.channels} channels over 8, mean ${result.mean}`);
  if (!result.pass || checkErrors.length) failed = true;
  if (checkErrors.length) console.log(checkErrors.join('\n'));
  await checkPage.close();

  // 2. Interaction.
  const page = await context.newPage();
  const errors = watch(page);
  await page.goto(`${origin}/`);
  await page.waitForTimeout(1500);
  for (const [x, y] of [[500, 250], [620, 260], [700, 420], [160, 160], [520, 300]]) {
    await page.mouse.move(x, y, { steps: 4 });
    await page.waitForTimeout(100);
  }
  await page.mouse.click(520, 300);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(200);
  await page.keyboard.press('g');
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  await page.keyboard.press(' ');
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => window.demoResult);
  if (state?.error) errors.push(state.error);
  console.log(`${errors.length ? 'FAIL' : 'PASS'} interaction: pointer, click, wheel and keys with no errors`);
  if (errors.length) { console.log(errors.join('\n')); failed = true; }
  if (process.env.DEMO_SCREENSHOT) await page.screenshot({ path: process.env.DEMO_SCREENSHOT });
} finally {
  await browser?.close();
  const closed = Promise.withResolvers();
  server.close(closed.resolve);
  await closed.promise;
}
if (failed) process.exit(1);

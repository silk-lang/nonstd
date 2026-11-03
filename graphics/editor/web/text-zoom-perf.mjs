// Differential zoom benchmark. Build dist/ first. Uses the same Playwright variables as test.mjs.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { serve } from './serve.mjs';
const root = new URL('../', import.meta.url), baseline = new URL('dist/editor-zoom-baseline.js', root);
const output = resolve(process.env.EDITOR_RESULTS || 'build/editor-results/text-zoom-performance');
await mkdir(output, { recursive: true });
const source = execFileSync('git', ['show', '690a1e6:graphics/editor/js/editor.js'], { cwd: fileURLToPath(root), encoding: 'utf8' });
// The legacy byte-upload wrapper never calls the new optional canvas-copy import.
await writeFile(baseline, source.replace('../../../gpu/webgpu/browser/host.ts', './host.js')
  .replace('now: () => performance.now(),', 'copy_image: () => 0, now: () => performance.now(),'));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await serve(); let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.demoReady);
  await page.evaluate(() => { window.editor.destroy(); document.body.replaceChildren(); });
  const results = [];
  for (const pixelRatio of [1, 2]) for (const direction of ['in', 'out']) for (const mode of ['before', 'after']) {
    const result = await page.evaluate(async options => (await import('/web/text-zoom-benchmark.js')).benchmarkTextZoom(options),
      { pixelRatio, direction, module: mode === 'before' ? '/dist/editor-zoom-baseline.js' : '/dist/editor.js' });
    results.push({ mode, ...result }); const { samples, ...summary } = result; console.log(mode, summary);
  }
  await writeFile(`${output}/measurements.json`, JSON.stringify({ baseline: '690a1e6', browser: browser.version(), results }, null, 2) + '\n');
  if (process.argv.includes('--assert') && results.some(r => r.mode === 'after' && (r.cpuP95 >= 16.7 || r.frameP95 >= r.idleMs * 1.5)))
    throw new Error('Zoom exceeded the 60Hz CPU budget or missed the browser idle frame cadence; inspect samples and GPU environment');
} finally {
  if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); await unlink(baseline);
}

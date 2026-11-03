// Run matched real-text workloads against browser DOM and Canvas2D renderers.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(process.env.EDITOR_RESULTS || 'build/editor-results/text-browser'); await mkdir(output, { recursive: true });
const server = await serve(); let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.demoReady);
  await page.evaluate(() => { window.editor.destroy(); document.body.replaceChildren(); });
  const environment = await page.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    return { userAgent: navigator.userAgent, pixelRatio: devicePixelRatio, vendor: a.info.vendor,
      architecture: a.info.architecture, hardwareConcurrency: navigator.hardwareConcurrency };
  });
  let cases = [{ count: 1, workload: 'closeup' }, ...[1000,10000,100000].map(count => ({ count, workload: 'overview' })),
    { count: 2000, unique: true, workload: 'overview' }, { count: 10000, workload: 'edit' }, { count: 10000, workload: 'fresh-edit', editCount: 20 }];
  const smoke = process.argv.includes('--smoke'); if (smoke) cases = cases.slice(0, 1);
  const results = [];
  for (const round of (smoke ? [1] : [1, 2])) for (const options of cases) {
    const modes = ['silk','dom','dom-composited','canvas2d']; if (round === 2) modes.reverse();
    for (const mode of modes) {
      let result;
      try { result = await page.evaluate(async options => (await import('/web/text-browser-benchmark.js')).benchmarkBrowserText(options), { ...options, mode, ...(smoke ? { frames: 10, warmup: 2 } : {}) }); }
      catch (error) { result = { ...options, mode, status: 'failed', error: String(error) }; }
      results.push({ round, ...result }); const { samples, ...summary } = result; console.log(JSON.stringify({ round, ...summary }));
      await writeFile(`${output}/measurements.json`, JSON.stringify({ environment, results }, null, 2) + '\n');
    }
  }
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }

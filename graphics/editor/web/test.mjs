import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serve } from './serve.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(process.env.EDITOR_RESULTS || 'build/editor-results'); await mkdir(output, { recursive: true });
const server = await serve();
const browser = await chromium.launch({ headless: process.env.HEADED !== '1' && process.platform !== 'linux',
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    ...(process.env.EDITOR_SOFTWARE_GPU === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-features=Vulkan', '--disable-vulkan-surface', ...(process.platform === 'linux' ? ['--use-vulkan=swiftshader'] : [])] : [])],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.demoReady || window.demoError, null, { timeout: 30000 });
  const error = await page.evaluate(() => window.demoError); if (error) throw new Error(error);
  await page.screenshot({ path: `${output}/demo.png` });
  console.log('Demo loaded:', await page.evaluate(() => ({ count: editor.size, stats: editor.stats })));
  const environment = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    return { userAgent: navigator.userAgent, vendor: adapter.info.vendor, architecture: adapter.info.architecture,
      device: adapter.info.device, description: adapter.info.description, hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio, browser: 'Chrome', visibility: document.visibilityState };
  });
  console.log('Environment:', environment);
  if (process.argv.includes('--bench')) {
    const reports = [];
    await page.evaluate(({workload, shadows}) => { window.benchmarkWorkload = workload; window.benchmarkShadows = shadows; }, { workload: process.env.EDITOR_WORKLOAD || 'pan', shadows: process.env.EDITOR_SHADOWS === '1' });
    for (const count of (process.env.EDITOR_COUNTS || '1000,10000,100000').split(',').map(Number)) {
      const report = await page.evaluate(async count => window.runBenchmark({ count, frames: 90, warmup: 20, workload: window.benchmarkWorkload || "pan", shadows: window.benchmarkShadows || false }), count);
      report.environment = environment; report.browserVersion = browser.version(); reports.push(report);
      await writeFile(`${output}/benchmark-${count}.json`, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report.results.map(({ samples, ...r }) => r), null, 2));
    }
    await writeFile(`${output}/benchmarks.json`, JSON.stringify(reports, null, 2));
  } else {
    const result = await page.evaluate(async () => (await import('/web/contracts.js')).runContracts());
    console.log('Contracts:', result);
    // Real input, including a canceled gesture and coordinate conversion at non-unit zoom.
    await page.evaluate(() => {
      editor.load({ version: 1, elements: [{ x: 80, y: 80, width: 100, height: 80, fill: '#ff0000' }] });
      editor.setViewport({ x: 20, y: 30, zoom: 1.5 }); editor.clearHistory(); window.testId = [...editor.elements()][0].id;
    });
    const box = await page.locator('#canvas').boundingBox();
    const at = (x, y) => [box.x + x, box.y + y];
    await page.mouse.move(...at(135, 120)); await page.mouse.down(); await page.mouse.move(...at(180, 150), { steps: 4 }); await page.mouse.up();
    let n = await page.evaluate(() => editor.get(testId));
    if (Math.abs(n.x - 110) > .01 || Math.abs(n.y - 100) > .01) throw new Error('Dragging used incorrect world coordinates');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    n = await page.evaluate(() => editor.get(testId)); if (n.x !== 80 || n.y !== 80) throw new Error('Gesture undo did not restore geometry');
    await page.mouse.move(...at(135, 120)); await page.mouse.down(); await page.mouse.move(...at(200, 170)); await page.keyboard.press('Escape'); await page.mouse.up();
    n = await page.evaluate(() => editor.get(testId)); if (n.x !== 80 || n.y !== 80) throw new Error('Escape did not cancel drag');
    await page.mouse.move(...at(240, 195)); await page.mouse.down(); await page.mouse.move(...at(270, 225)); await page.mouse.up();
    n = await page.evaluate(() => editor.get(testId)); if (n.width !== 120 || n.height !== 100) throw new Error(`Resize failed: ${JSON.stringify(n)}`);
    await page.keyboard.press('ArrowRight'); n = await page.evaluate(() => editor.get(testId)); if (n.x !== 81) throw new Error('Arrow nudge failed');
    await page.mouse.move(...at(135, 120)); await page.mouse.down(); await page.mouse.move(...at(145, 130));
    const disposed = await page.evaluate(async () => { editor.destroy(); await new Promise(resolve => requestAnimationFrame(resolve)); return editor.diagnostics; });
    await page.mouse.up();
    if (disposed.gpuHandles !== 0) throw new Error('Destroying an active gesture leaked GPU handles');
    console.log('PASS real pointer drag, resize, cancel, keyboard undo, nudge and destruction during a gesture');
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

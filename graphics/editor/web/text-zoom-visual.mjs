// Reproduce the high-zoom comparison. Requires a built dist/ and the same Playwright
// environment variables as test.mjs. The temporary baseline module is removed afterward.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';
const root = new URL('../', import.meta.url), output = new URL('bench/text-zoom/', root);
const baseline = new URL('dist/editor-zoom-before.js', root);
const source = execFileSync('git', ['show', 'a24d968:graphics/editor/js/editor.js'], { cwd: fileURLToPath(root), encoding: 'utf8' });
await writeFile(baseline, source.replace('../../../gpu/webgpu/browser/host.ts', './host.js').replace('now: () => performance.now(),', 'copy_image: () => 0, now: () => performance.now(),'));
await mkdir(output, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await serve(); let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 750 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.demoReady);
  await page.evaluate(() => { window.editor.destroy(); document.body.replaceChildren(); });
  const measurements = { browser: browser.version(), baseline: 'a24d968', width: 720, height: 280,
    zoom: 64, devicePixelRatio: 1, font: '400 24px Georgia', text: 'Silk serif text '.repeat(12), samples: {} };
  for (const mode of ['before', 'after']) {
    const result = await page.evaluate(async mode => {
      const { Editor } = await import(mode === 'before' ? '/dist/editor-zoom-before.js' : '/dist/editor.js');
      const { compareText } = await import('/web/text-zoom-contracts.js');
      const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:720px;height:280px'; document.body.append(canvas);
      const editor = await Editor.create({ canvas, autoRender: false, pixelRatio: 1, background: '#ffffff' });
      try {
        editor.text('Silk serif text '.repeat(12), { fontFamily: 'Georgia', fontSize: 24, fill: '#20232a' });
        editor.setViewport({ x: 0, y: 8, zoom: 64 });
        const comparison = compareText(editor), diagnostics = editor.diagnostics;
        const rasterizations = diagnostics.textRasterizations, preparation = [];
        for (let i = 0; i < 30; i++) {
          editor.setViewport({ x: i * .2 }); editor.render(); preparation.push(editor.stats.textMs);
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        await editor.flush(); preparation.sort((a, b) => a - b);
        return { meanError: comparison.meanError, inkPixels: comparison.ink, diagnostics,
          pan: { frames: preparation.length, rasterizations: editor.diagnostics.textRasterizations - rasterizations,
            textMsMedian: preparation[Math.floor(preparation.length / 2)], textMsP95: preparation[Math.floor(preparation.length * .95)] },
          actual: comparison.actual.toDataURL(), reference: comparison.reference.toDataURL() };
      } finally { editor.destroy(); canvas.remove(); }
    }, mode);
    for (const key of ['actual', 'reference']) {
      if (key === 'actual' || mode === 'after')
        await writeFile(new URL(key === 'actual' ? `${mode}.png` : 'reference.png', output), Buffer.from(result[key].split(',')[1], 'base64'));
      delete result[key];
    }
    measurements.samples[mode] = result;
  }
  await writeFile(new URL('measurements.json', output), JSON.stringify(measurements, null, 2) + '\n');
  console.log(JSON.stringify(measurements.samples, null, 2));
  if (measurements.samples.before.meanError < 1 || measurements.samples.after.meanError >= 1)
    throw new Error('Expected the old implementation to fail and the new implementation to pass the direct-render comparison');
} finally {
  if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); await unlink(baseline);
}

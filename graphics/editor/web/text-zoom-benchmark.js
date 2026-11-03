export async function benchmarkTextZoom({ frames = 90, width = 1200, height = 700, pixelRatio = 1, direction = 'in', centered = true, module = '/dist/editor.js' } = {}) {
  const { Editor } = await import(module);
  const canvas = document.createElement('canvas'); canvas.style.cssText = `width:${width}px;height:${height}px`; document.body.append(canvas);
  const editor = await Editor.create({ canvas, autoRender: false, pixelRatio, background: '#ffffff' });
  const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)];
  try {
    editor.text('Silk serif text '.repeat(12), { fontFamily: 'Georgia', fontSize: 24, fill: '#20232a' });
    editor.setViewport({ x: 0, y: 8, zoom: direction === 'in' ? 32 : 64 }); editor.render(); await editor.flush();
    const idle = [];
    for (let i = 0; i < 12; i++) idle.push(await new Promise(requestAnimationFrame));
    const idleMs = quantile(idle.slice(1).map((value, i) => value - idle[i]), .5);
    const rasters = editor.diagnostics.textRasterizations, samples = [];
    let previous = await new Promise(requestAnimationFrame);
    for (let i = 0; i < frames; i++) {
      const zoom = direction === 'in' ? 32 * 2 ** ((i + 1) / frames) : 64 / 2 ** ((i + 1) / frames);
      editor.zoomAt(zoom, centered ? width / 2 : 0, centered ? height / 2 : 0);
      const start = performance.now(); editor.render();
      const sample = { cpu: performance.now() - start, text: editor.stats.textMs, build: editor.stats.buildMs, draw: editor.stats.drawMs };
      const now = await new Promise(requestAnimationFrame);
      samples.push({ ...sample, interval: now - previous }); previous = now;
    }
    await editor.flush();
    const result = { frames, width, height, pixelRatio, direction, centered, idleMs, rasterizations: editor.diagnostics.textRasterizations - rasters,
      frameP95: quantile(samples.map(s => s.interval), .95), cpuP95: quantile(samples.map(s => s.cpu), .95),
      textP95: quantile(samples.map(s => s.text), .95), buildP95: quantile(samples.map(s => s.build), .95),
      drawP95: quantile(samples.map(s => s.draw), .95), slowFrames: samples.filter(s => s.interval > 25).length,
      missedFrameIntervals: samples.filter(s => s.interval > idleMs * 1.5).length, samples };
    return result;
  } finally { editor.destroy(); canvas.remove(); }
}

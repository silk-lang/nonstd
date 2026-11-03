import { Editor } from '/dist/editor.js';
const raf = (timeout = 10000) => new Promise((resolve, reject) => {
  let frame;
  const timer = setTimeout(() => { cancelAnimationFrame(frame); reject(new Error('Frame wait exceeded the 10-second watchdog')); }, timeout);
  frame = requestAnimationFrame(stamp => { clearTimeout(timer); resolve(stamp); });
});
const percentile = (values, q) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)];

function fixture(count, unique, closeup) {
  const fontSize = closeup ? 24 : 16, fontFamily = closeup ? 'Georgia' : 'Arial';
  const font = `400 ${fontSize}px ${fontFamily}`, context = document.createElement('canvas').getContext('2d'); context.font = font;
  const layouts = new Map(), layout = text => {
    if (layouts.has(text)) return layouts.get(text);
    const m = context.measureText(text), left = Math.max(0, m.actualBoundingBoxLeft);
    const ascent = Math.max(fontSize, m.actualBoundingBoxAscent), descent = Math.max(fontSize * .5, m.actualBoundingBoxDescent);
    const value = { text, left: left + 2, baseline: ascent + 2,
      width: Math.ceil(Math.max(m.width, m.actualBoundingBoxRight) + left + 4), height: Math.ceil(ascent + descent + 4) };
    layouts.set(text, value); return value;
  };
  const columns = Math.ceil(Math.sqrt(count));
  const nodes = Array.from({ length: count }, (_, i) => {
    const key = String(unique ? i : i % 256).padStart(6, '0');
    const variants = closeup ? [layout('Silk serif text '.repeat(12))] : [layout(`Layer ${key}`), layout(`Layer ${String(Number(key) + 100000).padStart(6, '0')}`)];
    return { type: 'text', x: i % columns * 120, y: Math.floor(i / columns) * 36, fontFamily, fontSize,
      fill: '#20232a', ...variants[0], variants };
  });
  return { nodes, font, fontSize, width: closeup ? nodes[0].width : columns * 120,
    height: closeup ? nodes[0].height : Math.ceil(count / columns) * 36, styles: closeup ? 1 : Math.min(count, unique ? count : 256) };
}
function camera(scene, frame, width, height, workload) {
  if (workload === 'closeup') {
    const zoom = 48 - 16 * Math.cos(frame * Math.PI / 60);
    // Keep the same world point under the viewport's center throughout the zoom.
    return { zoom, x: width / 64 - width / (2 * zoom), y: 8 + height / 64 - height / (2 * zoom) };
  }
  const fit = Math.min(width / (scene.width + 100), height / (scene.height + 100));
  const zoom = fit * (workload.endsWith('edit') ? .9 : .9 + .08 * Math.sin(frame * .045));
  return { zoom, x: scene.width / 2 - width / (2 * zoom), y: scene.height / 2 - height / (2 * zoom) };
}
function domRenderer(stage, scene, composited) {
  // Determine the CSS line's baseline once, so DOM and Canvas2D use the same glyph origins.
  const probe = document.createElement('span'), marker = document.createElement('i');
  probe.style.cssText = `position:absolute;font:${scene.font};line-height:${scene.fontSize}px;white-space:pre;`;
  marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  probe.append(document.createTextNode('Ag'), marker); stage.append(probe);
  const baseline = marker.getBoundingClientRect().top - probe.getBoundingClientRect().top; probe.remove();
  const world = document.createElement('div');
  Object.assign(world.style, { position: 'absolute', left: '0', top: '0', width: `${scene.width}px`, height: `${scene.height}px`,
    transformOrigin: '0 0', ...(composited ? { willChange: 'transform' } : {}) });
  const fragment = document.createDocumentFragment();
  const elements = scene.nodes.map(n => {
    const el = document.createElement('span'); el.textContent = n.text;
    Object.assign(el.style, { position: 'absolute', left: `${n.x + n.left}px`, top: `${n.y + n.baseline - baseline}px`,
      font: scene.font, lineHeight: `${scene.fontSize}px`, whiteSpace: 'pre', color: n.fill });
    fragment.append(el); return el;
  });
  world.append(fragment); stage.append(world);
  return { draw(v) { world.style.transform = `translate(${-v.x * v.zoom}px,${-v.y * v.zoom}px) scale(${v.zoom})`; },
    edit(index, n) { elements[index].textContent = n.text; }, destroy() { world.remove(); } };
}

/** Matched actual-text workloads; never substitute rectangles for glyphs. Runs one renderer at a time. */
export async function benchmarkBrowserText({ mode = 'silk', count = 1000, unique = false, workload = 'overview',
  frames = 60, warmup = 20, width = 1200, height = 700, editCount = 100 } = {}) {
  if (!['silk', 'dom', 'dom-composited', 'canvas2d'].includes(mode)) throw new Error('Unknown text renderer');
  if (!['overview', 'closeup', 'edit', 'fresh-edit'].includes(workload) || !Number.isInteger(count) || count < 1 || count > 100000 || unique && count > 4096)
    throw new Error('Invalid text workload');
  if (workload === 'closeup') count = 1;
  await document.fonts.ready;
  const scene = fixture(count, unique, workload === 'closeup'), pixelRatio = devicePixelRatio;
  const stage = document.createElement('div');
  Object.assign(stage.style, { position: 'fixed', inset: '0 auto auto 0', width: `${width}px`, height: `${height}px`,
    zIndex: '99999', overflow: 'hidden', background: '#ffffff', contain: 'strict' }); document.body.append(stage);
  let renderer, editor; const errors = [];
  try {
    const idle = [];
    for (let i = 0; i < 12; i++) idle.push(await raf());
    const idleMs = percentile(idle.slice(1).map((value, i) => value - idle[i]), .5);
    const started = performance.now();
    if (mode === 'silk') {
      const canvas = document.createElement('canvas'); canvas.style.cssText = `width:${width}px;height:${height}px`; stage.append(canvas);
      editor = await Editor.create({ canvas, autoRender: false, pixelRatio, background: '#ffffff' });
      editor.on('error', event => errors.push(event.detail.error.message));
      editor.setViewport(camera(scene, 0, width, height, workload));
      const ids = []; editor.batch(() => scene.nodes.forEach(n => ids.push(editor.add(n)))); editor.clearHistory();
      renderer = { draw(v) { editor.setViewport(v); editor.render(); },
        edit(index, n) { editor.update(ids[index], { text: n.text }); }, destroy() { editor.destroy(); } };
    } else if (mode === 'canvas2d') {
      const canvas = document.createElement('canvas'); canvas.width = width * pixelRatio; canvas.height = height * pixelRatio;
      canvas.style.cssText = `width:${width}px;height:${height}px`; stage.append(canvas); const ctx = canvas.getContext('2d');
      renderer = { draw(v) {
        ctx.resetTransform(); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const scale = v.zoom * pixelRatio; ctx.setTransform(scale, 0, 0, scale, -v.x * scale, -v.y * scale);
        ctx.font = scene.font; ctx.fillStyle = '#20232a'; ctx.textBaseline = 'alphabetic';
        for (const n of scene.nodes) ctx.fillText(n.text, n.x + n.left, n.y + n.baseline);
      }, edit() {}, destroy() { canvas.width = canvas.height = 0; canvas.remove(); } };
    } else renderer = domRenderer(stage, scene, mode === 'dom-composited');
    const setupMs = performance.now() - started, samples = [], loopStart = performance.now();
    let previous = await raf(), firstVisible = Infinity, lastVisible = 0, rasters = 0;
    for (let i = 0; i < frames + warmup; i++) {
      if (performance.now() - loopStart > 20000) throw new Error(`Workload exceeded the 20-second budget after ${i} frames`);
      if (document.visibilityState !== 'visible') throw new Error('Benchmark tab became hidden');
      const v = camera(scene, i, width, height, workload), start = performance.now();
      if (workload.endsWith('edit')) {
        for (let j = 0; j < Math.min(editCount, count); j++) {
          const index = Math.floor(j * count / Math.min(editCount, count)), n = scene.nodes[index];
          n.text = workload === 'fresh-edit' ? `Layer ${String(200000 + i * editCount + j).padStart(6, '0')}` : n.variants[i % 2].text; renderer.edit(index, n);
        }
        editor?.clearHistory();
      }
      renderer.draw(v); const cpu = performance.now() - start;
      const now = await raf();
      if (i === warmup - 1 && editor) rasters = editor.diagnostics.textRasterizations;
      if (i >= warmup) {
        const visible = editor ? editor.stats.visible : count;
        if (workload !== 'closeup') {
          if (visible !== count || (v.x > 0 || v.y > 0 || scene.width > v.x + width / v.zoom || scene.height > v.y + height / v.zoom))
            throw new Error('Overview must keep every text element inside the viewport');
        }
        firstVisible = Math.min(firstVisible, visible); lastVisible = Math.max(lastVisible, visible);
        samples.push({ cpu, interval: now - previous, zoom: v.zoom, ...(editor ? { text: editor.stats.textMs, build: editor.stats.buildMs, draw: editor.stats.drawMs } : {}) });
      }
      previous = now;
    }
    await editor?.flush(); if (errors.length) throw new Error(errors.join('; '));
    const diagnostics = editor?.diagnostics;
    return { mode, count, unique, workload, editCount: workload.endsWith('edit') ? Math.min(editCount, count) : 0,
      distinctTextStyles: scene.styles, width, height, pixelRatio, frames, warmup, setupMs, idleMs,
      visibleMin: firstVisible, visibleMax: lastVisible, zoomMin: Math.min(...samples.map(s => s.zoom)), zoomMax: Math.max(...samples.map(s => s.zoom)),
      cpuMedian: percentile(samples.map(s => s.cpu), .5), cpuP95: percentile(samples.map(s => s.cpu), .95),
      frameMedian: percentile(samples.map(s => s.interval), .5), frameP95: percentile(samples.map(s => s.interval), .95),
      averageFps: samples.length * 1000 / samples.reduce((sum, s) => sum + s.interval, 0),
      missedFrameIntervals: samples.filter(s => s.interval > idleMs * 1.5).length,
      ...(editor ? { rasterizations: diagnostics.textRasterizations - rasters, diagnostics } : {}), samples };
  } finally { renderer?.destroy(); if (!renderer) editor?.destroy(); stage.remove(); }
}

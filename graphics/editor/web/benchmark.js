import { Editor } from '/dist/editor.js';

export function makeScene(count, { shadows = false } = {}) {
  const colors = ['#b6a2f2', '#91b8aa', '#deb88f', '#8babc8', '#cb94a6'];
  const cols = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, i) => ({ type: 'rect', x: (i % cols) * 92,
    y: Math.floor(i / cols) * 72, width: 76, height: 54, radius: 8, fill: colors[i % colors.length],
    border: '#ffffff30', borderWidth: 1, shadow: shadows ? '#00000040' : '#00000000',
    blur: shadows ? 12 : 0, shadowX: 0, shadowY: shadows ? 4 : 0, name: `Layer ${i + 1}` }));
}
const raf = () => new Promise(resolve => requestAnimationFrame(resolve));
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))];
function styleNode(element, n) {
  Object.assign(element.style, { position: 'absolute', left: `${n.x}px`, top: `${n.y}px`, width: `${n.width}px`, height: `${n.height}px`,
    boxSizing: 'border-box', borderRadius: `${n.radius}px`, background: n.fill,
    border: `${n.borderWidth}px solid ${n.border}`, boxShadow: n.blur ? `${n.shadowX}px ${n.shadowY}px ${n.blur}px ${n.shadow}` : 'none' });
}
function domRenderer(root, nodes, virtual, editCount) {
  const world = document.createElement('div');
  Object.assign(world.style, { position: 'absolute', inset: '0', transformOrigin: '0 0' });
  root.append(world);
  const live = new Map(), pool = [];
  if (!virtual) {
    const fragment = document.createDocumentFragment();
    nodes.forEach((n, i) => { const el = document.createElement('div'); styleNode(el, n); fragment.append(el); live.set(i, el); });
    world.append(fragment);
  }
  return { draw(x, y, width, height, frame) {
    for (let i = 0; i < editCount; i++) {
      const n = nodes[i]; n.width = 76 + Math.sin(frame * .05 + i) * 8;
      const el = live.get(i); if (el) el.style.width = `${n.width}px`;
    }
    world.style.transform = `translate(${-x}px, ${-y}px)`;
    if (!virtual) return;
    const visible = new Set();
    let previousElement = null;
    nodes.forEach((n, i) => {
      const reach = n.blur * 1.5;
      if (n.x + n.width + Math.max(0, n.shadowX + reach) <= x || n.y + n.height + Math.max(0, n.shadowY + reach) <= y ||
          n.x + Math.min(0, n.shadowX - reach) >= x + width || n.y + Math.min(0, n.shadowY - reach) >= y + height) return;
      visible.add(i);
      if (!live.has(i)) { const el = pool.pop() || document.createElement('div'); styleNode(el, n); live.set(i, el); }
      const el = live.get(i), next = previousElement ? previousElement.nextSibling : world.firstChild;
      if (next !== el) world.insertBefore(el, next);
      previousElement = el;
    });
    for (const [i, el] of live) if (!visible.has(i)) { el.remove(); live.delete(i); pool.push(el); }
  }, destroy() { world.remove(); live.clear(); pool.length = 0; } };
}
/** Runs sequential, visible 960×640, DPR=1 workloads with identical source geometry. */
export async function runBenchmark({ count = 10000, frames = 90, warmup = 20, shadows = false,
  modes = ['silk', 'dom', 'dom-culled'], workload = 'pan', onProgress = () => {}, mount = document.body } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 100000) throw new RangeError('count must be in [1, 100000]');
  if (!['pan', 'edit'].includes(workload)) throw new RangeError('Unknown workload');
  const width = 960, height = 640, editCount = workload === 'edit' ? Math.min(count, 1000) : 0;
  const stage = document.createElement('div');
  Object.assign(stage.style, { position: 'fixed', left: '0', top: '0', width: `${width}px`, height: `${height}px`,
    zIndex: '1000', overflow: 'hidden', background: '#17191e', contain: 'strict' });
  mount.append(stage);
  const results = [];
  try {
    for (const mode of modes) {
      const nodes = makeScene(count, { shadows });
      stage.replaceChildren(); onProgress(`Preparing ${mode}: ${count.toLocaleString()} layers`);
      const start = performance.now(); let renderer, editor;
      try {
        if (mode.startsWith('silk')) {
          const canvas = document.createElement('canvas');
          Object.assign(canvas.style, { width: `${width}px`, height: `${height}px` }); stage.append(canvas);
          editor = await Editor.create({ canvas, wasm: '/dist/editor.wasm', autoRender: false, pixelRatio: 1 });
          const sceneStart = performance.now();
          const ids = []; editor.batch(() => nodes.forEach(n => ids.push(editor.add(n)))); editor.clearHistory();
          renderer = { draw(x, y, width, height, frame) {
            if (editCount) {
              editor.batch(() => { for (let i = 0; i < editCount; i++) editor.update(ids[i], { width: 76 + Math.sin(frame * .05 + i) * 8 }); });
              editor.clearHistory();
            }
            editor.setViewport({ x, y }); editor.render(); }, destroy() { editor.destroy(); } };
          editor.culling = mode !== 'silk-unculled';
          renderer.sceneMs = performance.now() - sceneStart;
        } else renderer = domRenderer(stage, nodes, mode === 'dom-culled', editCount);
        const setupMs = performance.now() - start;
        const updates = [], intervals = [], builds = [], submits = [];
        let previous = await raf();
        for (let i = 0; i < frames + warmup; i++) {
          if (document.visibilityState !== 'visible') throw new Error('Keep the benchmark tab visible');
          // Same repeatable sweep, with subpixel movement to exercise actual painting.
          const x = 120 + i * 3.25, y = 80 + Math.sin(i * 0.045) * 65;
          const t = performance.now(); renderer.draw(x, y, width, height, i); const elapsed = performance.now() - t;
          const stamp = await raf();
          if (i >= warmup) {
            updates.push(elapsed); intervals.push(stamp - previous);
            if (editor) { builds.push(editor.stats.buildMs); submits.push(editor.stats.drawMs); }
          }
          previous = stamp;
        }
        if (editor) await editor.flush();
        const row = { mode, count, shadows, workload, editCount, frames, setupMs, sceneMs: renderer.sceneMs ?? setupMs,
          updateMedianMs: quantile(updates, .5), updateP95Ms: quantile(updates, .95),
          frameMedianMs: quantile(intervals, .5), frameP95Ms: quantile(intervals, .95),
          averageFps: 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length),
          ...(editor ? { buildMedianMs: quantile(builds, .5), submitMedianMs: quantile(submits, .5), visible: editor.stats.visible, visited: editor.stats.visited, batches: editor.stats.batches } : {}),
          samples: { updateMs: updates, frameMs: intervals } };
        results.push(row); onProgress(`Finished ${mode}`);
      } finally { renderer?.destroy(); if (!renderer) editor?.destroy(); }
      await raf(); await raf();
    }
  } finally { stage.remove(); }
  return { schema: 1, timestamp: new Date().toISOString(), userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency, viewport: { width, height, pixelRatio: 1 },
    notes: 'Update measures synchronous scene/style work and command submission, not GPU execution. Frame intervals are requestAnimationFrame cadence, not a presentation fence. DOM parent transforms can use compositor caching. Setup includes WASM/device/pipeline initialization for Silk. No timing assertions.', results };
}

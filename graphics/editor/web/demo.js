import { Editor } from '/dist/editor.js';
import { attachInteractions } from '/dist/interaction.js';
import { makeScene, makeOverview, overviewCamera, runBenchmark } from './benchmark.js';
const $ = id => document.getElementById(id);
let editor;
function toast(message) { $('toast').textContent = message; $('toast').style.display = 'block'; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').style.display = 'none', 4000); }
function download(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function populate() {
  const rect = (name, x, y, width, height, fill, extra = {}) => editor.rect({ name, x, y, width, height, fill, ...extra });
  const text = (content, x, y, fontSize, fill, extra = {}) => editor.text(content, { name: content, x, y, fontSize, fill, ...extra });
  editor.batch(() => {
    rect('Canvas / paper', 70, 92, 565, 580, '#efede7', { radius: 3, shadow: '#00000050', blur: 25, shadowY: 12 });
    text('FORM & FEEL', 101, 115, 11, '#77776e', { fontWeight: 600 });
    text('Objects for', 98, 155, 46, '#303b35', { fontFamily: 'Georgia' });
    text('a quieter everyday.', 98, 205, 46, '#303b35', { fontFamily: 'Georgia' });
    text('A study in soft shapes, natural color, and useful things.', 101, 280, 12, '#777b73');
    rect('Sage / product card', 102, 335, 236, 230, '#c1cbb9', { radius: 10 });
    rect('Clay / product card', 354, 335, 248, 230, '#d8b8a1', { radius: 10 });
    editor.ellipse({ name: 'Vessel / shadow', x: 155, y: 511, width: 137, height: 20, fill: '#63755a28' });
    rect('Vessel / body', 177, 390, 95, 128, '#e9e5d9', { radius: 30, gradient: { to: '#c4c5b4', angle: 90 }, shadow: '#4c5d4d35', blur: 18, shadowX: 4, shadowY: 8 });
    editor.ellipse({ name: 'Vessel / rim', x: 177, y: 380, width: 95, height: 33, fill: '#efecdf' });
    editor.ellipse({ name: 'Vessel / opening', x: 185, y: 386, width: 79, height: 20, fill: '#8c9380' });
    editor.ellipse({ name: 'Lamp / shadow', x: 402, y: 517, width: 152, height: 18, fill: '#8a5c4228' });
    rect('Lamp / foot', 450, 504, 62, 15, '#f2dfc8', { radius: 6 });
    rect('Lamp / stem', 474, 425, 14, 83, '#ede1d0', { radius: 3 });
    editor.ellipse({ name: 'Lamp / shade', x: 404, y: 381, width: 152, height: 79, fill: '#fae7cc', gradient: { to: '#e2c3a4', angle: 150 } });
    text('01   STILL VESSEL', 104, 580, 11, '#485249', { fontWeight: 600 });
    text('02   AFTERGLOW', 356, 580, 11, '#485249', { fontWeight: 600 });
    text('Stoneware / sage', 104, 603, 10, '#8a8b7e');
    text('Table light / warm clay', 356, 603, 10, '#8a8b7e');
    rect('Accent / lilac', 674, 121, 150, 152, '#baa7e6', { radius: 16, shadow: '#00000030', blur: 18, shadowY: 7 });
    text('Less,', 691, 143, 32, '#362d4e', { fontFamily: 'Georgia' });
    text('but better.', 691, 184, 23, '#362d4e', { fontFamily: 'Georgia' });
    text('A NOTE TO SELF', 692, 242, 8, '#68577f', { fontWeight: 600 });
    rect('Swatch / fern', 678, 314, 39, 39, '#7d9985', { radius: 20 });
    rect('Swatch / oat', 729, 314, 39, 39, '#d8caaf', { radius: 20 });
    rect('Swatch / rose', 780, 314, 39, 39, '#ca9c8b', { radius: 20 });
    text('PALETTE NO. 04', 680, 369, 9, '#777f8d');
    text('Built from primitives.', 678, 432, 12, '#b0b3bd');
    text('Move something around.', 678, 456, 11, '#6e7785');
  }); editor.clearHistory();
}
function layers() {
  $('layer-count').textContent = editor.size.toLocaleString(); $('layers').replaceChildren();
  const nodes = [...editor.elements()].slice(0, 80).reverse();
  for (const n of nodes) {
    const button = document.createElement('button'); button.className = 'layer' + (editor.selection.includes(n.id) ? ' selected' : '');
    const icon = document.createElement('i'); icon.textContent = n.type === 'text' ? 'T' : n.type === 'ellipse' ? '◯' : '▢';
    const name = document.createElement('span'); name.textContent = n.name || `${n.type} ${n.id}`;
    button.append(icon, name); button.onclick = e => editor.select(e.shiftKey ? [...editor.selection, n.id] : [n.id]); $('layers').append(button);
  }
  if (editor.size > 80) { const hint = document.createElement('p'); hint.className = 'muted'; hint.textContent = `Showing 80 of ${editor.size.toLocaleString()} layers`; $('layers').append(hint); }
  $('undo').disabled = !editor.canUndo; $('redo').disabled = !editor.canRedo;
}
function inspector() {
  const node = editor.get(editor.selection[0]);
  if (!node) { $('inspector').innerHTML = '<div class="empty-symbol">↖</div><h3>Make it yours.</h3><p>Select a layer to adjust its shape, color and position.</p>'; return; }
  $('inspector').replaceChildren();
  const heading = document.createElement('h3'); heading.textContent = editor.selection.length > 1 ? `${editor.selection.length} layers selected` : node.name || node.type; $('inspector').append(heading);
  const grid = document.createElement('div'); grid.className = 'field-grid';
  for (const [key, name] of [['x','X'],['y','Y'],['width','Width'],['height','Height'],['radius','Radius'],['fill','Fill']]) {
    const label = document.createElement('label'); label.textContent = name;
    const input = document.createElement('input'); input.type = key === 'fill' ? 'color' : 'number'; input.setAttribute('aria-label', name);
    input.value = key === 'fill' ? node.fill.slice(0, 7) : Math.round(node[key] * 10) / 10;
    input.onchange = () => { try { editor.update(node.id, { [key]: key === 'fill' ? input.value : Number(input.value) }); } catch (e) { toast(e.message); inspector(); } };
    label.append(input); grid.append(label);
  }
  $('inspector').append(grid);
}
try {
  editor = await Editor.create({ canvas: $('canvas'), wasm: '/dist/editor.wasm', background: '#15171c' });
  window.editor = editor; window.runBenchmark = runBenchmark;
  attachInteractions(editor, { overlay: $('overlay') });
  editor.on('error', e => toast(e.detail.error.message));
  editor.on('change', () => { layers(); inspector(); });
  editor.on('selectionchange', () => { layers(); inspector(); $('status').textContent = editor.selection.length ? `${editor.selection.length} selected · drag to move` : 'Silk engine · ready'; });
  editor.on('viewportchange', () => $('zoom-reset').textContent = `${Math.round(editor.viewport.zoom * 100)}%`);
  editor.on('render', e => { const s = e.detail; $('stats').textContent = `${s.visible} visible / ${editor.size.toLocaleString()} layers · ${s.batches} draws · ${(s.buildMs + s.drawMs).toFixed(2)} ms CPU`; });
  populate(); layers(); inspector();
  const v = editor.viewport, zoom = Math.min(1, (v.width - 55) / 850, (v.height - 50) / 700);
  editor.setViewport({ zoom: Math.max(.3, zoom), x: -5, y: 0 });
  $('loading').remove(); $('status').textContent = 'Silk engine · ready';
  const insert = type => {
    const p = editor.screenToWorld(editor.viewport.width * .4, editor.viewport.height * .35);
    const id = type === 'text' ? editor.text('Something new', { ...p, name: 'New text', fontSize: 28, fill: '#f1eaff' }) : editor.add({ type, ...p, width: 140, height: 100, radius: 12, fill: '#bba7ef', name: `New ${type}` });
    editor.select([id]); $('canvas').focus();
  };
  for (const type of ['rect', 'ellipse', 'text']) $(`add-${type}`).onclick = () => insert(type);
  $('undo').onclick = () => editor.undo(); $('redo').onclick = () => editor.redo();
  const zoomBy = factor => editor.zoomAt(editor.viewport.zoom * factor, editor.viewport.width / 2, editor.viewport.height / 2);
  $('zoom-in').onclick = () => zoomBy(1.2); $('zoom-out').onclick = () => zoomBy(1 / 1.2);
  $('zoom-reset').onclick = () => editor.zoomAt(1, editor.viewport.width / 2, editor.viewport.height / 2);
  $('export').onclick = () => download(editor.toJSON(), 'silk-document.json');
  $('stress').onclick = () => {
    const count = Number($('count').value); const start = performance.now();
    const overview = $('workload').value.startsWith('overview') ? makeOverview(count, { shadows: $('shadows').checked }) : null;
    editor.load({ version: 1, elements: overview?.nodes ?? makeScene(count, { shadows: $('shadows').checked }) }); editor.clearHistory();
    editor.setViewport(overview ? overviewCamera(overview, editor.viewport.width, editor.viewport.height, 0) : { x: 0, y: 0, zoom: 1 }); layers();
    toast(`${count.toLocaleString()} layers loaded in ${(performance.now() - start).toFixed(0)} ms. Pan and zoom to explore.`);
  };
  $('benchmark').onclick = async () => {
    $('benchmark').disabled = true;
    try {
      const report = await runBenchmark({ count: Number($('count').value), workload: $('workload').value, shadows: $('shadows').checked,
        frames: 30, warmup: 5, modes: ['silk', 'dom', 'dom-culled', 'dom-composited'], onProgress: s => $('bench-status').textContent = s });
      window.benchmarkReport = report;
      $('bench-status').textContent = 'Frame cadence · higher is better'; $('bench-results').replaceChildren();
      const max = Math.max(...report.results.map(r => r.averageFps));
      for (const r of report.results) {
        const row = document.createElement('div'); row.className = 'bar-row';
        row.innerHTML = `<div><span>${r.mode === 'silk' ? 'Silk / WASM + WebGPU' : r.mode === 'dom' ? 'DOM / all layers' : r.mode === 'dom-composited' ? 'DOM / compositor hint' : 'DOM / viewport culling'}</span><span>${r.averageFps.toFixed(1)} fps</span></div><div class="bar" style="width:${Math.max(2, r.averageFps / max * 100)}%"></div><small>${r.updateMedianMs.toFixed(1)} ms CPU · frame p95 ${r.frameP95Ms.toFixed(1)} ms</small>`;
        $('bench-results').append(row);
      }
      const save = document.createElement('button'); save.textContent = 'Download measurements'; save.onclick = () => download(report, 'silk-benchmark.json'); $('bench-results').append(save);
    } catch (error) { $('bench-status').textContent = error.message; }
    finally { $('benchmark').disabled = false; }
  };
  window.demoReady = true;
} catch (error) { window.demoError = error.stack; $('loading').textContent = `Could not start: ${error.message}. Use a WebGPU browser on localhost or HTTPS.`; console.error(error); }

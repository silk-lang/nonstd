import { Editor } from '/dist/editor.js';
import { WebGPUHost } from '/dist/host.js';

// Draw the same complete, browser-shaped runs directly into the viewport. This reference
// never resizes a whole-line bitmap, so a capped atlas cannot silently pass the comparison.
function reference(editor) {
  const { x, y, zoom, pixelRatio } = editor.viewport;
  const canvas = document.createElement('canvas');
  canvas.width = editor.canvas.width; canvas.height = editor.canvas.height;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const n of editor.elements()) {
    if (n.hidden) continue;
    ctx.save(); ctx.scale(zoom * pixelRatio, zoom * pixelRatio); ctx.translate(n.x - x, n.y - y);
    ctx.beginPath(); ctx.roundRect(0, 0, n.width, n.height, Math.min(n.radius, n.width / 2, n.height / 2)); ctx.clip();
    const font = `${n.fontWeight} ${n.fontSize}px ${n.fontFamily}`;
    ctx.font = font; const m = ctx.measureText(n.text), left = Math.max(0, m.actualBoundingBoxLeft);
    const ascent = Math.max(n.fontSize, m.actualBoundingBoxAscent), descent = Math.max(n.fontSize * .5, m.actualBoundingBoxDescent);
    const width = Math.max(1, Math.ceil(Math.max(m.width, m.actualBoundingBoxRight) + left + 4));
    const height = Math.ceil(ascent + descent + 4);
    ctx.scale(n.width / width, n.height / height); ctx.font = font; ctx.fillStyle = n.fill;
    ctx.fillText(n.text, left + 2, ascent + 2); ctx.restore();
  }
  return canvas;
}
export function compareText(editor) {
  editor.render();
  const actual = document.createElement('canvas'); actual.width = editor.canvas.width; actual.height = editor.canvas.height;
  const ctx = actual.getContext('2d'); ctx.drawImage(editor.canvas, 0, 0);
  const expected = reference(editor);
  const a = ctx.getImageData(0, 0, actual.width, actual.height).data;
  const b = expected.getContext('2d').getImageData(0, 0, actual.width, actual.height).data;
  let error = 0, ink = 0;
  for (let i = 0; i < a.length; i += 4) { error += Math.abs(a[i] - b[i]); if (b[i] < 240) ink++; }
  return { meanError: error / (a.length / 4), ink, actual, reference: expected };
}
export async function runTextZoomContracts() {
  const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:720px;height:280px'; document.body.append(canvas);
  const editor = await Editor.create({ canvas, autoRender: false, pixelRatio: 1, background: '#ffffff' });
  let passed = 0;
  const check = (value, message) => { if (!value) throw new Error(message); passed++; };
  const sharp = label => {
    const result = compareText(editor);
    check(result.ink > 1000 && result.meanError < 1, `${label}: differs from direct browser text by ${result.meanError.toFixed(3)} grayscale levels per pixel`);
    return result;
  };
  try {
    const text = 'Silk serif text '.repeat(12);
    const id = editor.text(text, { fontFamily: 'Georgia', fontSize: 24, fill: '#20232a' });
    const node = editor.get(id); editor.clearHistory();
    editor.setViewport({ x: 0, y: 8, zoom: 64 }); sharp('64x zoom on a long text run');
    check(!editor.canUndo && editor.get(id) === node && editor.hitTest(100, 20) === id,
      'Visible-window rasters preserve full hit geometry, snapshots, and history');
    const stable = editor.diagnostics.textRasterizations;
    editor.setViewport({ x: .25, y: 8.25 }); sharp('Fractional pan within overscan');
    check(editor.diagnostics.textRasterizations === stable, 'Small pans reuse the overscan raster');
    const call = WebGPUHost.prototype.call, allocated = editor.diagnostics.textAtlasTiles;
    let attempts = 0;
    try {
      WebGPUHost.prototype.call = function(name, ...args) {
        if (name === 'editor_image_replace') { attempts++; return 0; }
        return call.call(this, name, ...args);
      };
      editor.setViewport({ x: 5.5, y: 10 }); editor.render(); editor.render();
      check(attempts === 1 && editor.diagnostics.limitedTextRuns === 1 && editor.diagnostics.textAtlasTiles === allocated,
        'A failed crop upload preserves live allocations, reports fallback quality, and avoids repeated retries');
    } finally { WebGPUHost.prototype.call = call; }
    const retry = editor.text('Allocation retry', { x: -10000, y: -10000 }); editor.remove(retry);
    sharp('Pan retries after atlas changes without displaying a stale crop');
    editor.setViewport({ x: 0, y: 8 });
    const copy = editor.text(text, { x: 4, y: 10, width: 6, height: node.height * 6 / node.width, fontFamily: 'Georgia', fontSize: 24, fill: '#20232a' });
    sharp('Large and small copies share shaping without sharing cropped pixels');
    editor.remove(copy);
    editor.update(id, { width: node.width * 4, height: node.height * 2, radius: 6 });
    editor.setViewport({ x: 0, y: 16, zoom: 32 }); sharp('Nonuniform element scale and rounded clipping');
    editor.undo(); editor.setViewport({ x: 0, y: 8, zoom: 64 }); sharp('Undo after crop geometry changes');
    editor.update(id, { fill: '#80301080' }); sharp('Translucent cropped text');
    editor.undo(); sharp('Undo after style changes');
    editor.resize(720, 280, 2); sharp('Device pixel ratio 2'); editor.resize(720, 280, 1);
    for (let i = 0; i < 4; i++) { editor.setViewport({ x: i % 2 ? 0 : 10, y: 8 }); editor.render(); }
    const handles = editor.diagnostics.gpuHandles, tiles = editor.diagnostics.textAtlasTiles;
    for (let i = 0; i < 20; i++) { editor.setViewport({ x: i % 2 ? 0 : 10, y: 8 }); editor.render(); }
    check(editor.diagnostics.gpuHandles === handles && editor.diagnostics.textAtlasTiles === tiles,
      'Repeated high-zoom pans keep atlas allocations and GPU handles bounded');
    editor.setViewport({ x: -10000, y: -10000 }); editor.render();
    check(editor.diagnostics.textAtlasTiles === editor.diagnostics.textRuns, 'Offscreen crops release their atlas allocations');
    editor.setViewport({ x: 0, y: 8 }); sharp('A released crop can be restored');
    editor.remove(id); editor.render();
    check(editor.diagnostics.textAtlasTiles === editor.diagnostics.textRuns, 'Removing a cropped element releases its allocation');
    editor.undo(); sharp('Undo restores a released crop');
    editor.resize(2200, 1000, 1); editor.render(); const capped = editor.diagnostics.textRasterizations;
    editor.render(); editor.render();
    check(editor.diagnostics.limitedTextRuns === 1 && editor.diagnostics.textRasterizations === capped,
      'Oversized physical viewports report the raster cap without re-uploading unchanged windows');
    await editor.flush(); editor.destroy();
    check(editor.diagnostics.gpuHandles === 0 && editor.diagnostics.textPixels === 0,
      'Destroy releases GPU resources and visible-window cache references');
    return { passed };
  } finally { editor.destroy(); canvas.remove(); }
}

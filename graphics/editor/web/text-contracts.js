import { Editor } from '/dist/editor.js';
import { WebGPUHost } from '/dist/host.js';

export async function runTextContracts() {
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { width: '640px', height: '320px' }); document.body.append(canvas);
  const editor = await Editor.create({ canvas, autoRender: false, pixelRatio: 1 });
  const calls = [], original = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function(...args) {
    calls.push({ width: this.canvas.width, height: this.canvas.height });
    return original.apply(this, args);
  };
  const readPixels = CanvasRenderingContext2D.prototype.getImageData; let readbacks = 0;
  CanvasRenderingContext2D.prototype.getImageData = function(...args) { readbacks++; return readPixels.apply(this, args); };
  let passed = 0;
  const check = (value, message) => { if (!value) throw new Error(message); passed++; };
  try {
    const id = editor.text('Sharp text', { x: 0, y: 0, fontSize: 24, fill: '#ffffff' });
    editor.render(); const base = calls.at(-1), count = calls.length;
    const elements = JSON.stringify(editor.toJSON().elements); editor.clearHistory();
    editor.setViewport({ zoom: 8 }); editor.render();
    check(calls.length > count && calls.at(-1).width >= base.width * 4,
      'Zooming in must rasterize text at a higher resolution');
    check(JSON.stringify(editor.toJSON().elements) === elements && !editor.canUndo,
      'Raster refresh does not modify document geometry or undo history');
    const stable = calls.length; editor.render(); editor.setViewport({ x: 1 }); editor.render();
    check(calls.length === stable, 'Repeated frames and panning reuse the text raster');
    editor.setViewport({ zoom: 1 }); editor.render();
    editor.setViewport({ zoom: 2.01 }); editor.render(); const boundary = calls.length;
    for (const zoom of [1.99, 2.01, 2.02, 1.99]) { editor.setViewport({ zoom }); editor.render(); }
    check(calls.length === boundary, 'Hysteresis avoids uploads while zoom oscillates around a density boundary');
    editor.setViewport({ x: 0, zoom: 1 }); editor.render();
    check(calls.at(-1).width < base.width * 4, 'Zooming out releases excessive raster resolution');
    const node = editor.get(id);
    editor.update(id, { width: node.width * 4, height: node.height * 2 }); editor.render();
    check(calls.at(-1).width >= base.width * 4 && calls.at(-1).height >= base.height * 2,
      'Independent element width and height scale increase raster density');
    editor.undo(); editor.render();
    check(editor.get(id).width === node.width && editor.get(id).height === node.height,
      'Undo restores geometry after adaptive raster changes');
    editor.resize(640, 320, 2); editor.render();
    check(calls.at(-1).width >= base.width * 2, 'Device pixel ratio contributes to raster density');
    editor.resize(640, 320, 1);
    const copy = editor.text('Sharp text', { x: 0, y: 50, fontSize: 24, fill: '#ffffff', width: node.width * 8, height: node.height * 8 });
    editor.render();
    check(editor.diagnostics.textRuns === 1 && editor.diagnostics.textAtlasTiles === 1,
      'Shared text content uses one replaceable atlas tile at the highest visible density');
    editor.remove(copy); editor.render();
    for (let i = 0; i < 12; i++) { editor.setViewport({ zoom: i % 2 ? 1 : 8 }); editor.render(); }
    const handles = editor.diagnostics.gpuHandles;
    for (let i = 0; i < 12; i++) { editor.setViewport({ zoom: i % 2 ? 1 : 8 }); editor.render(); }
    check(editor.diagnostics.textAtlasTiles === 1 && editor.diagnostics.textRuns === 1 && editor.diagnostics.gpuHandles === handles,
      'Repeated zoom cycles reuse atlas allocations and GPU resources');
    editor.setViewport({ x: 10000, y: 10000 }); editor.render(); const hidden = calls.length;
    editor.setViewport({ zoom: 16 }); editor.render();
    check(calls.length === hidden, 'Offscreen text does not rerasterize on zoom');
    editor.setViewport({ x: 0, y: 0 }); editor.render();
    check(calls.length > hidden, 'Text refreshes when it becomes visible again');
    editor.remove(id); const removed = calls.length;
    editor.setViewport({ zoom: 4 }); editor.render();
    check(calls.length === removed, 'Removed text does not participate in raster updates');
    editor.undo(); editor.render();
    check(editor.get(id)?.type === 'text' && editor.diagnostics.textAtlasTiles === 1,
      'Undo restores text through its stable atlas slot');
    editor.update(id, { type: 'rect' }); const converted = calls.length;
    editor.setViewport({ zoom: 1 }); editor.render();
    check(calls.length === converted, 'Converting text to a rectangle stops adaptive refresh');
    editor.undo(); editor.render();
    editor.update(id, { width: 1e6, height: 1e6 }); editor.render();
    const capped = calls.at(-1);
    check(capped.width <= 4094 && capped.height <= 4094 && capped.width * capped.height <= 4 * 1024 * 1024 && editor.diagnostics.limitedTextRuns === 0,
      'Extreme magnification uses a bounded visible-window raster without losing density');
    editor.update(id, { width: node.width, height: node.height }); editor.render();
    const beforeFailure = editor.diagnostics;
    const call = WebGPUHost.prototype.call; let replacements = 0;
    try {
      // Simulate an allocation refusal at the ABI boundary; the existing native tile survives.
      WebGPUHost.prototype.call = function(name, ...args) {
        if (name === 'editor_canvas') { replacements++; return 0; }
        return call.call(this, name, ...args);
      };
      editor.setViewport({ zoom: 8 }); editor.render();
      check(editor.diagnostics.textRasterizations === beforeFailure.textRasterizations && editor.diagnostics.textAtlasTiles === 1 && editor.diagnostics.limitedTextRuns === 1,
        'Failed raster replacement preserves the old tile and reports limited quality');
      editor.render();
      check(replacements === 1, 'Allocation failure does not trigger repeated raster attempts every frame');
    } finally { WebGPUHost.prototype.call = call; }
    editor.text('Retry', { fontSize: 12 }); editor.render();
    check(editor.diagnostics.textAtlasTiles === 2 && editor.diagnostics.limitedTextRuns === 0,
      'Atlas changes permit a previously failed resolution update to retry');
    // A fully visible overview can skip preparation, but every document/visibility change
    // must invalidate that proof before reusing the cached density interval.
    editor.load({ version: 1, elements: [] }); editor.setViewport({ x: 0, y: 0, zoom: 1 });
    const cachedId = editor.text('Cache proof', { x: 2, y: 2, fontSize: 16 }); editor.render();
    const steady = calls.length; editor.setViewport({ zoom: .95 }); editor.render();
    check(calls.length === steady, 'A fully visible camera change reuses sufficient whole-run density');
    editor.update(cachedId, { fontSize: 32 }); editor.render();
    check(calls.length > steady, 'Text style changes invalidate prepared-scene reuse');
    const normal = editor.get(cachedId);
    editor.update(cachedId, { hidden: true, width: normal.width * 4, height: normal.height * 4 }); editor.render();
    const hiddenRasters = calls.length; editor.update(cachedId, { hidden: false }); editor.render();
    check(calls.length > hiddenRasters, 'Revealing scaled hidden text recomputes density');
    editor.undo(); editor.render(); editor.undo(); editor.render();
    const offscreen = editor.text('Newly visible', { x: 10000, y: 10000, fontSize: 16 }); editor.render();
    const outside = calls.length; editor.update(offscreen, { x: 5, y: 5 }); editor.render();
    check(calls.length > outside, 'Moving an offscreen run into a prepared viewport refreshes its raster');
    editor.remove(offscreen); editor.render(); editor.undo(); editor.render();
    editor.update(cachedId, { type: 'rect' }); editor.render(); editor.undo(); editor.render();
    check(editor.get(cachedId).type === 'text' && editor.get(offscreen).type === 'text',
      'Remove and type-conversion undo restore text after preparation caching');
    editor.load({ version: 1, elements: [] }); editor.setViewport({ x: 0, y: 0, zoom: .03 });
    const small = editor.text('small label', { x: 2, y: 2, fontSize: 7 }); editor.render();
    const warm = calls.length;
    for (const zoom of [.06, .12, .25, .5, 1, .03]) { editor.setViewport({ zoom }); editor.render(); }
    check(calls.length === warm, 'Small labels retain a useful raster across overview-to-reading zoom');
    editor.setViewport({ zoom: 8 }); editor.render(); const grown = calls.length;
    const pixels = editor.diagnostics.textPixels;
    editor.setViewport({ zoom: .03 }); editor.render(); editor.setViewport({ zoom: 8 }); editor.render();
    check(calls.length === grown && editor.diagnostics.textPixels === pixels,
      'A bounded small-label raster is reused when zooming out and back in');
    editor.update(small, { hidden: true }); editor.render(); editor.remove(small); editor.render(); editor.undo(); editor.render();
    check(readbacks === 0, 'Text uploads never synchronously read pixels back into JavaScript');
    await editor.flush();
    return { passed };
  } finally { CanvasRenderingContext2D.prototype.getImageData = readPixels; CanvasRenderingContext2D.prototype.fillText = original; editor.destroy(); canvas.remove(); }
}

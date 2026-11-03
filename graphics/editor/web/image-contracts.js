/** GPU contracts: source crops, retained camera transforms, mutation invalidation and fallback. */
export async function runImageContracts(Editor, wasm) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;left:-1000px;top:0;width:256px;height:192px';
  document.body.append(canvas);
  const editor = await Editor.create({ canvas, wasm, autoRender: false, pixelRatio: 1, background: '#ffffff' });
  const capture = document.createElement('canvas'); capture.width = 256; capture.height = 192;
  const ctx = capture.getContext('2d', { willReadFrequently: true });
  const source = document.createElement('canvas'); source.width = 100; source.height = 100;
  const paint = source.getContext('2d');
  paint.fillStyle = '#ff0000'; paint.fillRect(0, 0, 50, 100);
  paint.fillStyle = '#0000ff'; paint.fillRect(50, 0, 50, 100);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const pixels = () => { editor.render(); ctx.clearRect(0, 0, 256, 192); ctx.drawImage(canvas, 0, 0); return ctx.getImageData(0, 0, 256, 192).data; };
  const compare = () => {
    editor.retainedImages = false; const ordinary = pixels();
    editor.retainedImages = true; const retained = pixels();
    let total = 0, max = 0;
    for (let i = 0; i < ordinary.length; i++) { const delta = Math.abs(ordinary[i] - retained[i]); total += delta; max = Math.max(max, delta); }
    assert(total / ordinary.length < .15, `Retained images differ: mean ${total / ordinary.length}, max ${max}`);
    return { mean: total / ordinary.length, max };
  };
  try {
    editor.registerImage('split', source);
    const red = editor.rect({ image: 'split', imageCrop: { x: 0, y: 0, width: .5, height: 1 }, x: -20, y: -10, width: 70, height: 50, fill: '#ffffff', radius: 4 });
    editor.rect({ image: 'split', imageCrop: { x: .5, y: 0, width: .5, height: 1 }, x: 70, y: 10, width: 80, height: 70, fill: '#ffffff80' });
    editor.text('Image + text', { x: 10, y: 100, fontSize: 16, fill: '#123456' });
    editor.setViewport({ x: -30, y: -20, zoom: 1 });
    const crop = pixels(), redAt = (30 * 256 + 30) * 4, blueAt = (70 * 256 + 120) * 4;
    assert(crop[redAt] > 240 && crop[redAt + 2] < 10, 'Left source crop is red');
    assert(crop[blueAt + 2] > 240 && crop[blueAt] > 100 && crop[blueAt] < 150, 'Right source crop preserves blue and alpha');
    const comparisons = [];
    for (const viewport of [{ x: -30, y: -20, zoom: .5 }, { x: 15.25, y: 4.5, zoom: 1.75 }, { x: 60, y: 15, zoom: 4 }]) { editor.setViewport(viewport); comparisons.push(compare()); }
    editor.setViewport({ x: -30, y: -20, zoom: 1 });
    editor.update(red, { x: 5, imageCrop: { x: .5, y: 0, width: .5, height: 1 } }); comparisons.push(compare());
    editor.undo(); comparisons.push(compare());
    editor.update(red, { opacity: .5, layerBlur: 2 }); comparisons.push(compare());
    editor.undo(); comparisons.push(compare());
    const rect = editor.rect({ x: 40, y: 40, fill: '#aabbcc' }); comparisons.push(compare());
    editor.remove(rect); comparisons.push(compare());
    editor.setViewport({ x: -29, y: -20, zoom: 1 });
    const before = editor.diagnostics.textRasterizations; pixels();
    assert(editor.diagnostics.textRasterizations === before, 'Camera-only pan reuses text rasters');
    assert(editor.diagnostics.imageSources === 1, 'Crops share their source texture');
    let rejected = false;
    try { editor.load({ version: 1, elements: [{ image: 'missing' }] }); } catch { rejected = true; }
    assert(rejected && editor.size === 3, 'Missing assets fail before replacing the document');
    return { comparisons, sourceImages: editor.diagnostics.imageSources, layers: editor.size };
  } finally { editor.destroy(); canvas.remove(); assert(editor.diagnostics.gpuHandles === 0, 'Image rendering releases GPU handles'); }
}

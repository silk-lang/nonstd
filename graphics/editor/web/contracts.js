import { Editor, rgba } from '/dist/editor.js';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const throws = (fn, message) => { let did = false; try { fn(); } catch { did = true; } assert(did, message); };
function pixels(editor) {
  editor.render();
  const copy = document.createElement('canvas'); copy.width = editor.canvas.width; copy.height = editor.canvas.height;
  const ctx = copy.getContext('2d'); ctx.drawImage(editor.canvas, 0, 0);
  return ctx.getImageData(0, 0, copy.width, copy.height).data;
}
export async function runContracts() {
  const canvas = document.createElement('canvas'); Object.assign(canvas.style, { width: '256px', height: '192px' }); document.body.append(canvas);
  const e = await Editor.create({ canvas, wasm: '/dist/editor.wasm', autoRender: false, pixelRatio: 1, background: '#000000' });
  const errors = []; e.on('error', event => errors.push(event.detail.error.message));
  let checks = 0;
  const check = (condition, message) => { assert(condition, message); checks++; };
  try {
    check(rgba('#f008') === 0xff000088 && rgba('#abc') === 0xaabbccff, 'RGBA shorthand');
    const a = e.rect({ x: 10, y: 10, width: 60, height: 40, fill: '#ff0000', radius: 8 });
    const b = e.ellipse({ x: 25, y: 20, width: 40, height: 30, fill: '#00ff00' });
    check(e.hitTest(45, 35) === b, 'Topmost geometric hit');
    check(e.hitTest(26, 21) === a, 'Ellipse corner misses');
    check(e.hitTest(10, 10) === null, 'Rounded rectangle corner misses');
    e.update(b, { locked: true }); check(e.hitTest(45, 35) === a, 'Locked element passes hits through');
    e.update(b, { locked: false, hidden: true }); check(e.hitTest(45, 35) === a, 'Hidden element passes hits through');
    e.update(b, { hidden: false }); e.clearHistory();
    const events = []; const off = e.on('change', event => events.push(event.detail));
    e.batch(() => { e.update(a, { x: 80 }); e.update(a, { x: 90 }); e.update(b, { y: 80 }); });
    check(events.length === 1 && events[0].ids.length === 2, 'Batch emits one change with unique IDs');
    e.undo(); check(e.get(a).x === 10 && e.get(b).y === 20, 'Undo uses first pre-edit snapshot');
    e.redo(); check(e.get(a).x === 90 && e.get(b).y === 80, 'Redo uses final snapshot');
    e.remove(a); check(!e.get(a), 'Remove'); e.undo(); check(e.get(a).id === a, 'Undo restores identity');
    check([...e.elements()].map(n => n.id).join() === `${a},${b}`, 'Undo preserves public paint order');
    e.redo(); check(e.hitTest(100, 20) === null, 'Redo removes native geometry too');
    const c = e.rect({ x: -20, y: -20 }); check(c > b && c !== a, 'IDs are not reused');
    const before = JSON.stringify(e.toJSON());
    throws(() => e.batch(() => { e.update(b, { x: 40 }); e.rect({ width: -1 }); }), 'Invalid batch throws');
    check(JSON.stringify(e.toJSON()) === before, 'Failed group restores document');
    throws(() => e.update(b, { width: NaN }), 'NaN rejected');
    throws(() => e.setViewport({ zoom: 0 }), 'Invalid zoom rejected');
    throws(() => e.update(b, { fill: 'red' }), 'Non-hex color rejected');
    throws(() => e.load({ version: 1, elements: [{}, { width: -1 }] }), 'Invalid import rejected');
    check(JSON.stringify(e.toJSON()) === before, 'Import validates before mutation');
    off();
    e.load({ version: 1, elements: [
      { x: 10, y: 10, width: 60, height: 50, fill: '#ff0000', radius: 5 },
      { type: 'ellipse', x: 80, y: 10, width: 60, height: 40, fill: '#00ff00' },
      { x: -25, y: 70, width: 15, height: 30, fill: '#fff', shadow: '#ffffff', blur: 30, shadowX: 5 },
      { x: 30, y: 100, width: 50, height: 30, fill: '#0000ff80', border: '#fff', borderWidth: 2 },
    ] });
    let data = pixels(e);
    const at = (x, y) => [...data.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4)];
    check(at(30, 30).join() === '255,0,0,255', 'GPU rectangle center matches fill');
    check(at(110, 30).join() === '0,255,0,255', 'GPU ellipse center matches fill');
    check(at(80, 10).slice(0, 3).every(c => c === 0), 'GPU ellipse corner is empty');
    check(at(1, 85)[0] > 0, 'Offscreen shape casts a visible shadow');
    const culled = data; e.culling = false; data = pixels(e);
    check(culled.every((v, i) => v === data[i]), 'Culling preserves every pixel, including shadows'); e.culling = true;
    e.setViewport({ x: 5, y: 5, zoom: 2 }); e.resize(256, 192, 2); data = pixels(e);
    check(at(100, 100).join() === '255,0,0,255', 'Camera and DPR applied exactly once');
    const world = e.screenToWorld(20, 30); const screen = e.worldToScreen(world.x, world.y);
    check(screen.x === 20 && screen.y === 30, 'World/screen inverse');
    const anchor = e.screenToWorld(50, 60); e.zoomAt(3, 50, 60);
    const anchored = e.screenToWorld(50, 60); check(Math.abs(anchor.x - anchored.x) < 1e-10 && Math.abs(anchor.y - anchored.y) < 1e-10, 'Zoom preserves pointer anchor');
    // The quad-only fast path must match the mixed-kind overlap-ordering path byte for byte.
    e.setViewport({ x: -4.25, y: 2.5, zoom: .65 }); e.resize(256, 192, 1);
    e.load({ version: 1, elements: [
      { x: 0, y: 0, width: 240, height: 180, fill: '#ccaa88', radius: 12 },
      { x: 10, y: 10, width: 140, height: 100, fill: '#ff000080', radius: 9 },
      { x: 60, y: 40, width: 140, height: 100, fill: '#0000ff80', gradient: { to: '#33ff3380', angle: 130 }, border: '#fff8', borderWidth: 3 },
    ] });
    const fast = pixels(e);
    const sentinel = e.ellipse({ x: 10000, y: 10000, width: 10, height: 10 });
    const reference = pixels(e);
    check(fast.every((v, i) => v === reference[i]), 'Pinned quads preserve translucent overlap, gradients and borders');
    e.update(sentinel, { hidden: true });
    check(pixels(e).every((v, i) => v === reference[i]), 'Hiding mixed geometry restores quad optimization safely');
    e.update(sentinel, { type: 'rect', hidden: false, shadow: '#fff', blur: 4 });
    check(pixels(e).every((v, i) => v === reference[i]), 'Adding a shadow restores mixed ordering safely');
    e.remove(sentinel); e.undo(); e.redo();
    check(pixels(e).every((v, i) => v === reference[i]), 'Remove/undo/redo keep ordering eligibility consistent');
    // Invisible mixed primitives split rectangle runs without contributing any pixels.
    // Compare against individually ordered quads, with shadows overlapping earlier content.
    const shadowScene = Array.from({ length: 130 }, (_, i) => ({
      x: (i * 37 % 230) - 25, y: (i * 23 % 170) - 15,
      width: 35 + i % 4 * 9, height: 25 + i % 3 * 8, radius: i % 8,
      fill: ['#cc884440', '#44bb8880', '#8855bb90'][i % 3],
      border: '#ffffff90', borderWidth: i % 3,
      shadow: i % 11 === 0 ? '#100530a0' : '#00000000',
      blur: i % 11 === 0 ? 18 : 0, shadowX: i % 2 ? -9 : 8, shadowY: -5,
    }));
    shadowScene.splice(64, 0, { type: 'ellipse', x: 40, y: 30, width: 70, height: 50, fill: '#ffffff80' });
    shadowScene.splice(100, 0, { type: 'text', text: 'Mixed', x: 60, y: 70, fontSize: 24, fill: '#ffff00c0' });
    for (const [zoom, scale] of [[1, 1], [.65, 2], [.03, 1]]) {
      e.resize(256, 192, scale); e.setViewport({ x: -3.25, y: 2.75, zoom });
      e.load({ version: 1, elements: shadowScene }); const grouped = pixels(e);
      e.load({ version: 1, elements: shadowScene.flatMap(n => [n,
        { type: 'ellipse', x: 10000, y: 10000, width: 1, height: 1 }]) });
      const separate = pixels(e);
      check(grouped.every((v, i) => v === separate[i]), `Shadow ordering survives run splits at zoom ${zoom}, DPR ${scale}`);
    }
    const textScene = Array.from({ length: 130 }, (_, i) => ({ type: 'text', text: ['MMMM', 'WWWW', 'oooo'][i % 3],
      fontSize: 24, x: i * 37 % 230 - 20, y: i * 23 % 160 - 10, width: 140, height: 40,
      radius: i % 5, fill: ['#ee331180', '#22dd6690', '#4455eed0'][i % 3] }));
    textScene.splice(70, 0, { type: 'rect', x: 80, y: 50, width: 80, height: 60, fill: '#ffffff80' });
    for (const [zoom, scale] of [[1, 1], [.65, 2], [.03, 1]]) {
      e.resize(256, 192, scale); e.setViewport({ x: -3.25, y: 2.75, zoom });
      e.load({ version: 1, elements: textScene }); const grouped = pixels(e);
      e.load({ version: 1, elements: textScene.flatMap(n => [n,
        { type: 'ellipse', x: 10000, y: 10000, width: 1, height: 1 }]) });
      const separate = pixels(e);
      check(grouped.every((v, i) => v === separate[i]), `Image runs preserve mixed translucent text at zoom ${zoom}, DPR ${scale}`);
    }
    e.load({ version: 1, elements: [] }); pixels(e); check(e.stats.visible === 0, 'Empty document renders'); e.setViewport({ x: 0, y: 0, zoom: 1 }); e.resize(256, 192, 1);
    const t = e.text('Silk', { x: 10, y: 10, fill: '#ffffff', fontSize: 32 }); data = pixels(e);
    check(data.some((v, i) => i % 4 === 0 && v > 0), 'Text atlas reaches GPU canvas');
    const exported = e.toJSON(); e.load(exported); check(e.size === 1 && [...e.elements()][0].text === 'Silk', 'Text JSON roundtrip');
    check(t !== [...e.elements()][0].id, 'Import allocates fresh IDs');
    // Different instances must not share canvas, document, handles or textures.
    const otherCanvas = document.createElement('canvas'); otherCanvas.style.width = '64px'; otherCanvas.style.height = '64px'; document.body.append(otherCanvas);
    const other = await Editor.create({ canvas: otherCanvas, autoRender: false, pixelRatio: 1 });
    try { other.rect({ fill: '#f00' }); other.render(); check(other.size === 1 && e.size === 1, 'Independent editor instances'); }
    finally { other.destroy(); otherCanvas.remove(); }
    await e.flush(); check(errors.length === 0, `No GPU errors: ${errors.join(', ')}`);
  } finally { e.destroy(); e.destroy(); canvas.remove(); }
  check(e.diagnostics.gpuHandles === 0 && e.diagnostics.destroyed, `Destroy releases GPU handles (${e.diagnostics.gpuHandles} remain)`);
  throws(() => e.rect(), 'Use after destroy rejected');
  return { passed: checks, errors };
}

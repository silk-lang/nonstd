/**
 * Optional pointer/keyboard controller. The document API also works without DOM input.
 * Drag selected elements; drag the bottom-right selection handle to resize. Shift-click
 * extends selection. Middle-button/Space-drag pans; Ctrl/Meta-wheel zooms at the pointer.
 * Escape cancels a gesture. Delete, arrows, Mod-Z and Mod-Shift-Z edit the selection.
 */
export function attachInteractions(editor, { overlay } = {}) {
  const canvas = editor.canvas;
  const abort = new AbortController(), options = { signal: abort.signal };
  const oldTouch = canvas.style.touchAction, oldTab = canvas.getAttribute('tabindex');
  canvas.style.touchAction = 'none'; canvas.tabIndex = 0;
  let gesture = null, space = false, disposed = false;
  const point = e => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  function redraw() {
    if (!overlay) return;
    overlay.replaceChildren();
    for (const id of editor.selection) {
      const n = editor.get(id); if (!n) continue;
      const p = editor.worldToScreen(n.x, n.y), z = editor.viewport.zoom;
      const box = document.createElement('div');
      box.className = 'silk-selection';
      Object.assign(box.style, { position: 'absolute', left: `${p.x}px`, top: `${p.y}px`, width: `${n.width * z}px`,
        height: `${n.height * z}px`, border: '1px solid #a998ff', boxSizing: 'border-box', pointerEvents: 'none' });
      const handle = document.createElement('span');
      Object.assign(handle.style, { position: 'absolute', right: '-4px', bottom: '-4px', width: '7px', height: '7px',
        background: 'white', border: '1px solid #8b72ee' });
      box.append(handle); overlay.append(box);
    }
  }
  function finish(cancel = false) {
    if (!gesture) return;
    const current = gesture; gesture = null;
    if (current.mode !== 'pan') {
      cancel ? editor.cancelTransaction() : editor.commitTransaction();
      editor.emit('transformend', { ids: current.nodes.map(n => n.id), mode: current.mode, canceled: cancel });
    } else if (cancel) editor.setViewport(current.camera);
    if (canvas.hasPointerCapture(current.pointer)) canvas.releasePointerCapture(current.pointer);
    canvas.style.cursor = space ? 'grab' : ''; redraw();
  }
  canvas.addEventListener('pointerdown', e => {
    if (gesture || ![0, 1].includes(e.button)) return;
    const p = point(e), world = editor.screenToWorld(p.x, p.y);
    if (!editor.emit('pointerdown', { point: world, originalEvent: e })) return;
    canvas.focus(); e.preventDefault();
    let mode = 'drag';
    if (e.button === 1 || space || e.altKey) mode = 'pan';
    else {
      const only = editor.selection.length === 1 ? editor.get(editor.selection[0]) : null;
      const corner = only && editor.worldToScreen(only.x + only.width, only.y + only.height);
      if (corner && Math.abs(corner.x - p.x) <= 9 && Math.abs(corner.y - p.y) <= 9) mode = 'resize';
      else {
        const id = editor.hitTest(world.x, world.y);
        if (!id) { if (!e.shiftKey) editor.select([]); return; }
        if (e.shiftKey) editor.select(editor.selection.includes(id) ? editor.selection.filter(n => n !== id) : [...editor.selection, id]);
        else if (!editor.selection.includes(id)) editor.select([id]);
        if (!editor.selection.includes(id)) return;
      }
    }
    const nodes = editor.selection.map(id => editor.get(id));
    if (mode !== 'pan') {
      if (!editor.emit('transformstart', { ids: nodes.map(n => n.id), mode })) return;
      editor.beginTransaction();
    }
    gesture = { mode, nodes, start: p, world, camera: editor.viewport, pointer: e.pointerId };
    canvas.setPointerCapture(e.pointerId); canvas.style.cursor = mode === 'pan' ? 'grabbing' : mode === 'resize' ? 'nwse-resize' : 'move';
  }, options);
  canvas.addEventListener('pointermove', e => {
    const p = point(e), world = editor.screenToWorld(p.x, p.y);
    editor.emit('pointermove', { point: world, originalEvent: e });
    if (!gesture || gesture.pointer !== e.pointerId) return;
    const g = gesture, dx = (p.x - g.start.x) / g.camera.zoom, dy = (p.y - g.start.y) / g.camera.zoom;
    if (g.mode === 'pan') editor.setViewport({ x: g.camera.x - dx, y: g.camera.y - dy });
    else {
      for (const n of g.nodes) {
        if (g.mode === 'resize') editor.update(n.id, { width: Math.max(1, n.width + dx), height: Math.max(1, n.height + dy) });
        else editor.update(n.id, { x: n.x + dx, y: n.y + dy });
      }
      editor.emit('transform', { ids: g.nodes.map(n => n.id), mode: g.mode, dx, dy });
    }
    redraw();
  }, options);
  canvas.addEventListener('pointerup', e => { if (gesture?.pointer === e.pointerId) finish(); }, options);
  canvas.addEventListener('pointercancel', e => { if (gesture?.pointer === e.pointerId) finish(true); }, options);
  canvas.addEventListener('lostpointercapture', () => finish(true), options);
  canvas.addEventListener('wheel', e => {
    e.preventDefault(); if (gesture) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? editor.viewport.height : 1;
    const p = point(e);
    if (e.ctrlKey || e.metaKey) editor.zoomAt(editor.viewport.zoom * Math.exp(-e.deltaY * unit * 0.0023), p.x, p.y);
    else editor.setViewport({ x: editor.viewport.x + e.deltaX * unit / editor.viewport.zoom,
      y: editor.viewport.y + e.deltaY * unit / editor.viewport.zoom });
  }, { ...options, passive: false });
  canvas.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.code === 'Space') { space = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
    if (e.key === 'Escape') { finish(true); e.preventDefault(); return; }
    if (gesture) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault(); editor.batch(() => { for (const id of editor.selection) editor.remove(id); });
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault(); const d = e.shiftKey ? 10 : 1;
      editor.batch(() => { for (const id of editor.selection) { const n = editor.get(id);
        editor.update(id, { x: n.x + (e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0),
          y: n.y + (e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0) }); } });
    }
  }, options);
  canvas.addEventListener('keyup', e => { if (e.code === 'Space') { space = false; if (!gesture) canvas.style.cursor = ''; } }, options);
  canvas.addEventListener('blur', () => { space = false; finish(true); }, options);
  const unsubscribes = ['selectionchange', 'viewportchange', 'change', 'render'].map(type => editor.on(type, redraw));
  redraw();
  const cleanup = () => {
    if (disposed) return; disposed = true; finish(true); abort.abort();
    for (const unsubscribe of unsubscribes) unsubscribe();
    overlay?.replaceChildren(); canvas.style.touchAction = oldTouch; canvas.style.cursor = '';
    if (oldTab === null) canvas.removeAttribute('tabindex'); else canvas.setAttribute('tabindex', oldTab);
  };
  editor.addCleanup(cleanup); return cleanup;
}

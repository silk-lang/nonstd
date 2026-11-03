import { WebGPUHost } from '../../../gpu/webgpu/browser/host.ts';

export const blendModes = Object.freeze(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);

const defaults = Object.freeze({ type: 'rect', x: 0, y: 0, width: 100, height: 100,
  opacity: 1, layerBlur: 0, backdropBlur: 0, brightness: 1, contrast: 1, saturation: 1, blendMode: 'normal',
  innerShadow: '#00000000', innerBlur: 16, innerShadowX: 0, innerShadowY: 4,
  radius: 0, fill: '#9b87f5', border: '#00000000', borderWidth: 0,
  shadow: '#00000000', blur: 0, shadowX: 0, shadowY: 0, gradient: null,
  image: null, imageCrop: null, hidden: false, locked: false, name: '', text: '', fontSize: 24, fontFamily: 'sans-serif', fontWeight: 400 });
const properties = Object.keys(defaults);
const numeric = ['x', 'y', 'width', 'height', 'radius', 'borderWidth', 'blur', 'shadowX', 'shadowY', 'layerBlur', 'backdropBlur', 'brightness', 'contrast', 'saturation', 'innerBlur', 'innerShadowX', 'innerShadowY'];
const colorCache = new Map();
/** Converts #RGB, #RGBA, #RRGGBB, or #RRGGBBAA to the Silk ABI's RGBA word. */
export function rgba(value) {
  const cached = colorCache.get(value); if (cached !== undefined) return cached;
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))
    throw new TypeError(`Expected a hex color, received ${value}`);
  let hex = value.slice(1);
  if (hex.length < 5) hex = [...hex].map(c => c + c).join('');
  if (hex.length === 6) hex += 'ff';
  const word = Number.parseInt(hex, 16) >>> 0;
  if (colorCache.size >= 1024) colorCache.delete(colorCache.keys().next().value);
  colorCache.set(value, word); return word;
}
function normalize(value) {
  const n = { ...defaults };
  for (const key of properties) if (value[key] !== undefined) n[key] = value[key];
  if (value.id !== undefined) n.id = value.id;
  if (!['rect', 'ellipse', 'text'].includes(n.type)) throw new TypeError('Unknown element type');
  for (const key of numeric) {
    if (!Number.isFinite(n[key]) || Math.abs(n[key]) > 1e6) throw new RangeError(`Invalid ${key}`);
  }
  if (n.width <= 0 || n.height <= 0 || n.radius < 0 || n.borderWidth < 0 || n.blur < 0)
    throw new RangeError('Sizes must be positive; radius, border and blur must be nonnegative');
  for (const key of ['fill', 'border', 'shadow', 'innerShadow']) rgba(n[key]);
  for (const key of ['layerBlur', 'backdropBlur', 'innerBlur']) if (n[key] < 0 || n[key] > 1000) throw new RangeError(`Invalid ${key}`);
  for (const key of ['brightness', 'contrast', 'saturation']) if (n[key] < 0 || n[key] > 4) throw new RangeError(`Invalid ${key}`);
  if (!Number.isFinite(n.opacity) || n.opacity < 0 || n.opacity > 1) throw new RangeError('Invalid opacity');
  if (!blendModes.includes(n.blendMode)) throw new TypeError('Unknown blend mode');
  if (n.type !== 'rect' && rgba(n.innerShadow) % 256) throw new TypeError('Inner shadows require a rectangle');
  if (n.type === 'text' && n.backdropBlur) throw new TypeError('Backdrop blur requires a rectangle or ellipse');
  if (n.image !== null && (typeof n.image !== 'string' || !n.image || n.type !== 'rect')) throw new TypeError('Images require a registered name and rectangle type');
  if (n.imageCrop !== null) {
    const { x, y, width, height } = n.imageCrop;
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.0000001 || y + height > 1.0000001) throw new RangeError('Image crop must be within [0, 1]');
    n.imageCrop = Object.freeze({ x, y, width, height });
  }
  if (n.image && (n.borderWidth || rgba(n.shadow) % 256 || rgba(n.innerShadow) % 256 || n.gradient)) throw new TypeError('Image layers do not support borders, shadows or gradients');
  if (n.gradient !== null) {
    rgba(n.gradient.to);
    if (!Number.isFinite(n.gradient.angle)) throw new RangeError('Invalid gradient angle');
    n.gradient = Object.freeze({ to: n.gradient.to, angle: n.gradient.angle });
  }
  if (n.type === 'ellipse' && (n.borderWidth || rgba(n.shadow) % 256))
    throw new TypeError('Ellipse borders and shadows are not supported yet');
  if (typeof n.text !== 'string' || n.text.length > 10000 || typeof n.fontFamily !== 'string' || !/^[\w ,'-]{1,100}$/.test(n.fontFamily) || !Number.isFinite(n.fontSize) || n.fontSize < 1 || n.fontSize > 512 || ![100,200,300,400,500,600,700,800,900].includes(n.fontWeight)) throw new TypeError('Invalid text style');
  if (typeof n.name !== 'string') throw new TypeError('name must be a string');
  n.hidden = Boolean(n.hidden); n.locked = Boolean(n.locked);
  return Object.freeze(n);
}

// Quantized raster density avoids a texture upload on every wheel event. Raster dimensions
// are independent per axis, so nonuniform element scaling keeps the original text geometry.
const maxTextSide = 4094, maxTextPixels = 4 * 1024 * 1024;
let measurementContext;
function measureText(n) {
  const ctx = measurementContext ??= document.createElement('canvas').getContext('2d');
  const font = `${n.fontWeight} ${n.fontSize}px ${n.fontFamily}`;
  ctx.font = font; const m = ctx.measureText(n.text);
  const left = Math.max(0, m.actualBoundingBoxLeft || 0);
  const ascent = Math.max(n.fontSize, m.actualBoundingBoxAscent || 0);
  const descent = Math.max(n.fontSize * .5, m.actualBoundingBoxDescent || 0);
  return { font, width: Math.max(1, Math.ceil(Math.max(m.width, m.actualBoundingBoxRight || 0) + left + 4)),
    height: Math.ceil(ascent + descent + 4), left: left + 2, baseline: ascent + 2 };
}
function boundedTextSize(width, height) {
  const factor = Math.min(1, maxTextSide / width, maxTextSide / height, Math.sqrt(maxTextPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * factor)), height: Math.max(1, Math.floor(height * factor)), limited: factor < 1 };
}
const densityBucket = ratio => 2 ** Math.ceil(Math.log2(Math.max(Number.MIN_VALUE, ratio)));

/**
 * Retained Silk document and WebGPU surface. Construct with Editor.create().
 * All coordinates are world units; viewport dimensions are CSS pixels.
 * Call destroy() when the canvas is removed. Each editor owns its own WASM instance/device.
 */
export class Editor extends EventTarget {
  #host; #token; #lastId = 0; #nodes = new Map(); #selection = new Set(); #frame = 0;
  #dead = false; #transaction = null; #undo = []; #redo = []; #replaying = false;
  #textCanvas; #uploadCanvas; #textPreparation; #textBlocks; #textPixels = 0; #textWarmPixels = 0;
  #images = new Map();
  #textTiles = new Map(); #textNodes = new Map(); #textViews = new Map(); #textViewPool = []; #textRasterizations = 0; #textAtlasRevision = 0; #textMs = 0;
  #observer; #cleanups = []; #camera = { x: 0, y: 0, zoom: 1 }; #autoRender;
  #width = 1; #height = 1; #scale = 1;
  stats = Object.freeze({ buildMs: 0, drawMs: 0, textMs: 0, visible: 0, visited: 0, batches: 0, frames: 0 });
  culling = true;
  /** Diagnostic switch: false forces rebuilding image-only scenes on camera moves. */
  retainedImages = true;
  /** Initializes an independent WASM module and GPU device; rejects on unsupported WebGPU. */
  static async create({ canvas, wasm = new URL('./editor.wasm', import.meta.url),
    autoRender = true, pixelRatio = globalThis.devicePixelRatio || 1, background = '#17191e' } = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('canvas must be an HTMLCanvasElement');
    const editor = new Editor();
    editor.canvas = canvas;
    editor.background = background;
    rgba(background);
    editor.#autoRender = autoRender;
    const host = new WebGPUHost({ onError: error => editor.#error(error) });
    editor.#host = host;
    host.canvases.set('silk-editor', canvas);
    const module = wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compileStreaming(fetch(wasm));
    const instance = await WebAssembly.instantiate(module, { webgpu: host.imports, editor: {
      copy_image: (queue, texture, x, y, width, height) => {
        try {
          if (!editor.#uploadCanvas) return 0;
          host.table.get(queue, 'WGPUQueue').copyExternalImageToTexture(
            { source: editor.#uploadCanvas },
            { texture: host.table.get(texture, 'WGPUTexture'), origin: { x, y }, premultipliedAlpha: true, colorSpace: 'srgb' },
            { width, height });
          return 1;
        } catch (error) {
          // The native upload still holds a mutable state loan. Notify listeners after it returns.
          queueMicrotask(() => { if (!editor.#dead) editor.#error(error); }); return 0;
        }
      },
      now: () => performance.now(),
      metric: (buildMs, drawMs, visible, visited, batches) => {
        editor.stats = Object.freeze({ buildMs, drawMs, textMs: editor.#textMs, visible, visited, batches, frames: editor.stats.frames + 1 });
      },
    } });
    host.attach(instance);
    editor.#token = host.call('editor_start');
    if (!editor.#token) throw new Error('Silk could not create the editor');
    try {
      const deadline = performance.now() + 30000;
      while (true) {
        const status = host.call('editor_poll', editor.#token);
        if (status === 1) break;
        if (status < 0 || performance.now() > deadline) throw new Error('WebGPU initialization failed or timed out');
        await new Promise(resolve => setTimeout(resolve, 8));
      }
      editor.resize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height, pixelRatio);
      editor.#observer = new ResizeObserver(() => {
        if (!editor.#dead && canvas.clientWidth && canvas.clientHeight)
          editor.resize(canvas.clientWidth, canvas.clientHeight, editor.#scale);
      });
      editor.#observer.observe(canvas);
      editor.invalidate();
      return editor;
    } catch (error) { editor.destroy(); throw error; }
  }
  #assert() { if (this.#dead) throw new Error('Editor has been destroyed'); }
  #call(name, ...args) { this.#assert(); return this.#host.call(name, this.#token, ...args); }
  #error(error) { this.emit('error', { error: error instanceof Error ? error : new Error(String(error)) }); }
  /** Dispatches a cancelable CustomEvent. Returns false when a listener cancels it. */
  emit(type, detail) { return this.dispatchEvent(new CustomEvent(type, { detail, cancelable: true })); }
  /** Subscribes to events and returns an unsubscribe function. */
  on(type, listener) { this.addEventListener(type, listener); return () => this.removeEventListener(type, listener); }
  /** Registers input-controller cleanup with the editor lifetime. */
  addCleanup(cleanup) { this.#assert(); this.#cleanups.push(cleanup); }
  get diagnostics() { return Object.freeze({ gpuHandles: this.#host?.table.size ?? 0,
    wasmBytes: this.#host?.exports?.memory.buffer.byteLength ?? 0, textRuns: this.#textTiles.size,
    textRasterizations: this.#textRasterizations, imageSources: this.#images.size,
    textAtlasTiles: this.#token && !this.#dead ? this.#call('editor_image_count') : 0,
    textPixels: this.#textPixels,
    limitedTextRuns: [...this.#textTiles.values(), ...this.#textViews.values()].filter(entry => entry.limited).length, destroyed: this.#dead }); }
  get size() { return this.#nodes.size; }
  get viewport() { return { ...this.#camera, width: this.#width, height: this.#height, pixelRatio: this.#scale }; }
  get selection() { return [...this.#selection]; }
  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }
  /** Returns an immutable element snapshot, or undefined for a removed/unknown ID. */
  get(id) { return this.#nodes.get(id); }
  /** Iterates immutable snapshots in paint order without copying the document. */
  *elements() {
    // ID order is paint order, including after an undo restores a removed Map entry.
    for (let id = 1; id <= this.#lastId; id++) { const node = this.#nodes.get(id); if (node) yield node; }
  }
  #write(id, n) {
    this.#textPreparation = null; this.#textBlocks = null;
    const text = n.type === 'text' ? this.#textKind(n) : null;
    const image = n.image ? this.#images.get(n.image) : null;
    if (n.image && !image) throw new Error(`Image is not registered: ${n.image}`);
    const result = this.#call('editor_set', id, text ? text.kind : image ? image.kind : n.type === 'ellipse' ? 1 : 0, n.x, n.y, n.width, n.height,
      n.radius, n.type === 'text' ? 0xffffffff : rgba(n.fill), rgba(n.border), n.borderWidth, n.blur, n.shadowX, n.shadowY,
      rgba(n.shadow), rgba(n.gradient?.to ?? n.fill), n.gradient?.angle ?? 90,
      (n.hidden ? 1 : 0) | (n.locked ? 2 : 0) | (n.gradient ? 4 : 0),
      n.opacity, n.layerBlur, n.backdropBlur, n.brightness, n.contrast, n.saturation, blendModes.indexOf(n.blendMode),
      rgba(n.innerShadow), n.innerBlur, n.innerShadowX, n.innerShadowY);
    if (!result) throw new Error('Silk could not store the element');
    if (image && n.imageCrop) {
      const c = n.imageCrop;
      this.#call('editor_image_source', result, c.x, c.y, c.width, c.height);
    }
    if (text) {
      if (text.uniformWidth === undefined) { text.uniformWidth = n.width; text.uniformHeight = n.height; text.uniform = true; }
      else if (text.uniformWidth !== n.width || text.uniformHeight !== n.height) text.uniform = false;
      this.#textNodes.set(result, text);
    } else this.#textNodes.delete(result);
    return result;
  }
  #textVisible(n) {
    const { x, y, zoom } = this.#camera;
    return !n.hidden && n.x + n.width > x && n.y + n.height > y &&
      n.x < x + this.#width / zoom && n.y < y + this.#height / zoom;
  }
  #textSize(n, entry) {
    const scale = this.#camera.zoom * this.#scale * 2;
    return { width: Math.max(entry.minWidth || 1, Math.ceil(entry.layout.width * densityBucket(n.width * scale / entry.layout.width))),
      height: Math.max(entry.minHeight || 1, Math.ceil(entry.layout.height * densityBucket(n.height * scale / entry.layout.height))) };
  }
  #textKind(n) {
    const key = JSON.stringify([n.text, n.fontSize, n.fontFamily, n.fontWeight, n.fill]);
    const cached = this.#textTiles.get(key); if (cached) return cached;
    if (this.#textTiles.size >= 4096) throw new RangeError('Text cache limit reached (4096 text styles per editor)');
    const entry = { kind: 0, layout: measureText(n), text: n.text, fill: n.fill, width: 0, height: 0, limited: false, failedSize: '', failedRevision: -1 };
    // Reserve a bounded, useful raster floor for small labels. Overview text can
    // then zoom into normal reading sizes without hundreds of simultaneous uploads.
    const warmWidth = Math.ceil(entry.layout.width * 4), warmHeight = Math.ceil(entry.layout.height * 4);
    if (n.fontSize <= 12 && entry.layout.width <= 256 && entry.layout.height <= 32 && this.#textWarmPixels + warmWidth * warmHeight <= 8 * 1024 * 1024) {
      entry.minWidth = warmWidth; entry.minHeight = warmHeight;
      this.#textWarmPixels += warmWidth * warmHeight;
    }
    const size = this.#textVisible(n) ? this.#textSize(n, entry) : { width: entry.minWidth || 1, height: entry.minHeight || 1 };
    // Keep a modest whole-run fallback; high zoom gets a separate visible-window raster.
    const initial = boundedTextSize(size.width, size.height);
    this.#rasterText(entry, initial.limited ? boundedTextSize(entry.layout.width, entry.layout.height) : initial);
    this.#textTiles.set(key, entry); return entry;
  }
  #rasterText(entry, size) {
    const key = JSON.stringify([size.width, size.height, size.view, size.radius]);
    entry.limited = size.limited;
    if (!entry.failedSize && entry.width === size.width && entry.height === size.height &&
      JSON.stringify([entry.view, entry.radius]) === JSON.stringify([size.view, size.radius])) return true;
    if (entry.failedSize === key && entry.failedRevision === this.#textAtlasRevision) { entry.limited = true; return false; }
    const canvas = this.#textCanvas ??= document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext('2d'), layout = entry.layout;
    const view = size.view ?? { x: 0, y: 0, width: 1, height: 1 };
    ctx.scale(size.width / (layout.width * view.width), size.height / (layout.height * view.height));
    ctx.translate(-view.x * layout.width, -view.y * layout.height);
    if (size.radius) {
      ctx.beginPath(); ctx.roundRect(0, 0, layout.width, layout.height,
        [{ x: size.radius.x * layout.width, y: size.radius.y * layout.height }]); ctx.clip();
    }
    ctx.font = layout.font; ctx.fillStyle = entry.fill; ctx.textBaseline = 'alphabetic';
    ctx.fillText(entry.text, layout.left, layout.baseline);
    // Copy the browser canvas directly to the atlas. No pixel readback or WASM staging buffer.
    let kind;
    this.#uploadCanvas = canvas;
    try { kind = this.#call('editor_canvas', entry.kind, canvas.width, canvas.height); }
    finally { this.#uploadCanvas = null; }
    if (!kind) {
      if (!entry.kind && !size.view) throw new Error('Could not upload text to the atlas');
      // A failed replacement leaves the old tile intact. Do not retry this size every frame.
      entry.failedSize = key; entry.failedRevision = this.#textAtlasRevision; entry.limited = true; return false;
    }
    this.#textPixels += size.width * size.height - entry.width * entry.height;
    entry.kind = kind; entry.width = size.width; entry.height = size.height; entry.failedSize = '';
    if (size.view) this.#call('editor_image_view', kind, view.x, view.y, view.width, view.height);
    entry.view = size.view; entry.radius = size.radius; entry.rasterLimited = size.limited;
    this.#textRasterizations++; this.#textAtlasRevision++;
    return true;
  }
  #releaseTextView(id, entry) {
    const base = this.#textNodes.get(id);
    if (base) this.#call('editor_image_node', id, base.kind);
    if (entry.width) { this.#call('editor_image_release', entry.kind); this.#textAtlasRevision++; }
    this.#textPixels -= entry.width * entry.height;
    this.#textViews.delete(id); this.#textViewPool.push(entry.kind);
  }
  #prepareTextView(id, n, base) {
    let entry = this.#textViews.get(id);
    if (entry && entry.base !== base) { this.#releaseTextView(id, entry); entry = null; }
    if (!entry) {
      entry = { ...base, base, kind: this.#textViewPool.pop() || 0, width: 0, height: 0,
        view: null, limited: false, failedSize: '', failedRevision: -1 };
      this.#textViews.set(id, entry);
    }
    const scale = this.#camera.zoom * this.#scale;
    const width = n.width * scale, height = n.height * scale;
    const left = (this.#camera.x - n.x) * scale, top = (this.#camera.y - n.y) * scale;
    const right = Math.min(width, left + this.#width * this.#scale);
    const bottom = Math.min(height, top + this.#height * this.#scale);
    const radius = { x: Math.min(n.radius, n.width / 2, n.height / 2) / n.width,
      y: Math.min(n.radius, n.width / 2, n.height / 2) / n.height };
    const old = entry.view;
    // Overscan and density headroom let small camera changes reuse pixels. Refresh below 1.5 samples per pixel.
    const reuse = old && old.x * width <= Math.max(0, left) && old.y * height <= Math.max(0, top) &&
      (old.x + old.width) * width >= right && (old.y + old.height) * height >= bottom &&
      entry.width >= old.width * width * 1.5 - .01 && entry.height >= old.height * height * 1.5 - .01 &&
      entry.width < old.width * width * 8 && entry.height < old.height * height * 8 &&
      entry.radius.x === radius.x && entry.radius.y === radius.y;
    if (!reuse) {
      const x = Math.max(0, Math.floor(left / 64) * 64 - 64);
      const y = Math.max(0, Math.floor(top / 64) * 64 - 64);
      const w = Math.min(width, Math.ceil(right / 64) * 64 + 64) - x;
      const h = Math.min(height, Math.ceil(bottom / 64) * 64 + 64) - y;
      const size = boundedTextSize(Math.ceil(w * 2), Math.ceil(h * 2));
      size.view = { x: x / width, y: y / height, width: w / width, height: h / height };
      size.radius = radius;
      if (!this.#rasterText(entry, size)) {
        // Never place an old crop over a new portion of the line after allocation failure.
        this.#call('editor_image_node', id, base.kind); return;
      }
    }
    entry.limited = reuse ? false : entry.rasterLimited;
    this.#call('editor_image_node', id, entry.kind);
  }
  #preparedTextFits() {
    const p = this.#textPreparation, v = this.#camera, scale = v.zoom * this.#scale;
    return p && scale > p.minScale && scale <= p.maxScale && v.x <= p.left && v.y <= p.top &&
      v.x + this.#width / v.zoom >= p.right && v.y + this.#height / v.zoom >= p.bottom;
  }
  #cacheTextPreparation() {
    this.#textPreparation = null;
    if (this.#textViews.size) return;
    const p = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity, minScale: 0, maxScale: Infinity };
    const v = this.#camera, right = v.x + this.#width / v.zoom, bottom = v.y + this.#height / v.zoom;
    for (const [id, entry] of this.#textNodes) {
      const n = this.#nodes.get(id); if (!n || n.hidden) continue;
      if (entry.limited || n.x < v.x || n.y < v.y || n.x + n.width > right || n.y + n.height > bottom) return;
      p.left = Math.min(p.left, n.x); p.top = Math.min(p.top, n.y);
      p.right = Math.max(p.right, n.x + n.width); p.bottom = Math.max(p.bottom, n.y + n.height);
      // The whole scene must remain visible with sufficient density. Small-label
      // rasters may retain extra samples while the cache stays below its trim threshold.
      if (!entry.minWidth || this.#textPixels > 16 * 1024 * 1024) p.minScale = Math.max(p.minScale, entry.width / (n.width * 8), entry.height / (n.height * 8));
      p.maxScale = Math.min(p.maxScale, entry.width / (n.width * 2), entry.height / (n.height * 2));
    }
    this.#textPreparation = p;
    if (!this.#preparedTextFits()) this.#textPreparation = null;
  }
  *#visibleText() {
    if (!this.#textBlocks) {
      const blocks = []; let block;
      for (const [id, entry] of this.#textNodes) {
        const n = this.#nodes.get(id); if (!n || n.hidden) continue;
        if (!block || block.items.length === 64) {
          block = { items: [], x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity }; blocks.push(block);
        }
        block.items.push([id, entry, n]);
        block.x = Math.min(block.x, n.x); block.y = Math.min(block.y, n.y);
        block.right = Math.max(block.right, n.x + n.width); block.bottom = Math.max(block.bottom, n.y + n.height);
      }
      this.#textBlocks = blocks;
    }
    const v = this.#camera, right = v.x + this.#width / v.zoom, bottom = v.y + this.#height / v.zoom;
    for (const block of this.#textBlocks) {
      if (block.right <= v.x || block.bottom <= v.y || block.x >= right || block.y >= bottom) continue;
      for (const item of block.items) if (this.#textVisible(item[2])) yield item;
    }
  }
  #prepareText() {
    if (this.#preparedTextFits()) return;
    for (const [id, entry] of this.#textViews) {
      const n = this.#nodes.get(id), base = this.#textNodes.get(id);
      const size = n && base ? this.#textSize(n, base) : null;
      if (!size || !this.#textVisible(n) || !boundedTextSize(size.width, size.height).limited)
        this.#releaseTextView(id, entry);
    }
    if (!this.#textNodes.size) return;
    const requests = new Map();
    for (const [id, entry, n] of this.#visibleText()) {
      // Identically sized copies share one raster request. Avoid measuring and
      // quantizing all 100k instances once a visible representative requested it.
      if (entry.uniform && requests.has(entry)) continue;
      const size = this.#textSize(n, entry), prior = requests.get(entry);
      if (boundedTextSize(size.width, size.height).limited) {
        this.#prepareTextView(id, n, entry); continue;
      }
      requests.set(entry, prior ? { width: Math.max(prior.width, size.width), height: Math.max(prior.height, size.height) } : size);
    }
    for (const entry of this.#textTiles.values()) if (!requests.has(entry)) entry.limited = false;
    for (const [entry, requested] of requests) {
      const size = boundedTextSize(requested.width, requested.height);
      // Grow as soon as needed; shrink only after a fourfold drop to avoid bucket oscillation.
      const trim = !entry.minWidth || this.#textPixels > 16 * 1024 * 1024;
      const width = size.width > entry.width || (trim && size.width * 4 <= entry.width) ? size.width : entry.width;
      const height = size.height > entry.height || (trim && size.height * 4 <= entry.height) ? size.height : entry.height;
      const target = boundedTextSize(width, height); target.limited ||= size.limited;
      if (target.width !== entry.width || target.height !== entry.height) this.#rasterText(entry, target);
      else entry.limited = target.limited;
    }
    this.#cacheTextPreparation();
  }
  #record(id, before, after) {
    if (this.#replaying) return;
    if (this.#transaction) {
      const prior = this.#transaction.get(id);
      this.#transaction.set(id, { id, before: prior ? prior.before : before, after });
    } else {
      this.#undo.push([{ id, before, after }]);
      this.#trimHistory(); this.#redo.length = 0;
      this.emit('change', { ids: [id], source: 'api' });
    }
  }
  #trimHistory() { if (this.#undo.length > 100) this.#undo.shift(); }
  /** Uploads an image once. Rectangle image/imageCrop properties reuse its texture.
   * Names are immutable for the editor lifetime; register assets before loading a document.
   * Sources must be origin-clean and at most 4094 pixels per side. */
  registerImage(name, source) {
    this.#assert();
    if (typeof name !== 'string' || !name || this.#images.has(name)) throw new TypeError('Image name must be nonempty and unique');
    const width = source.width, height = source.height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4094 || height > 4094) throw new RangeError('Image dimensions must be 1–4094 pixels');
    this.#uploadCanvas = source;
    let kind;
    try { kind = this.#call('editor_canvas', 0, width, height); }
    finally { this.#uploadCanvas = null; }
    if (!kind) throw new Error('Could not upload image');
    this.#images.set(name, { kind, width, height });
  }
  /** Adds a rectangle or ellipse and returns a stable ID. */
  add(properties = {}) {
    this.#assert();
    const n = normalize(properties), id = this.#write(0, n);
    this.#lastId = id;
    const value = Object.freeze({ ...n, id });
    this.#nodes.set(id, value); this.#record(id, undefined, value); this.invalidate(); return id;
  }
  rect(properties = {}) { return this.add({ ...properties, type: 'rect' }); }
  ellipse(properties = {}) { return this.add({ ...properties, type: 'ellipse' }); }
  /** Adds one line of browser-shaped text with raster density adapted to its displayed size. */
  text(content, properties = {}) {
    const n = normalize({ ...properties, type: 'text', text: content });
    const layout = measureText(n);
    return this.add({ ...n, width: properties.width ?? layout.width, height: properties.height ?? layout.height });
  }
  /** Atomically validates and replaces properties of a live element. */
  update(id, patch) {
    this.#assert(); const before = this.#nodes.get(id);
    if (!before) throw new RangeError(`Unknown element ${id}`);
    const after = normalize({ ...before, ...patch, id });
    this.#write(id, after); this.#nodes.set(id, after); this.#record(id, before, after);
    if ((after.hidden || after.locked) && this.#selection.has(id)) this.select(this.selection.filter(value => value !== id));
    this.invalidate();
  }
  /** Removes an element. Returns false when it does not exist. Undo restores its original ID. */
  remove(id) {
    this.#assert(); const before = this.#nodes.get(id);
    if (!before) return false;
    this.#textPreparation = null; this.#textBlocks = null; this.#call('editor_remove', id); this.#nodes.delete(id); this.#textNodes.delete(id); this.#record(id, before, undefined);
    if (this.#selection.has(id)) this.select(this.selection.filter(value => value !== id));
    this.invalidate(); return true;
  }
  /** Begins a change group. Nesting is rejected. Frames can render while the group is open. */
  beginTransaction() {
    this.#assert(); if (this.#transaction) throw new Error('A transaction is already open');
    this.#transaction = new Map();
  }
  /** Ends a group as one undo step and one change event. */
  commitTransaction() {
    this.#assert(); if (!this.#transaction) return;
    const changes = [...this.#transaction.values()]; this.#transaction = null;
    if (!changes.length) return;
    this.#undo.push(changes); this.#trimHistory(); this.#redo.length = 0;
    this.emit('change', { ids: changes.map(c => c.id), source: 'transaction' });
  }
  /** Restores the state before the open group. */
  cancelTransaction() {
    this.#assert(); if (!this.#transaction) return;
    const changes = [...this.#transaction.values()]; this.#transaction = null;
    this.#apply(changes, 'before', 'cancel');
  }
  /** Runs a synchronous edit group. Exceptions roll the group back. */
  batch(fn) {
    this.beginTransaction();
    try { const value = fn(this); if (value?.then) throw new TypeError('batch callback must be synchronous'); this.commitTransaction(); return value; }
    catch (error) { this.cancelTransaction(); throw error; }
  }
  #apply(changes, side, source) {
    this.#replaying = true;
    try {
      for (const change of changes) {
        const value = change[side];
        if (value) { this.#write(change.id, value); this.#nodes.set(change.id, value); }
        else { this.#textPreparation = null; this.#textBlocks = null; this.#call('editor_remove', change.id); this.#nodes.delete(change.id); this.#textNodes.delete(change.id); }
      }
    } finally { this.#replaying = false; }
    this.select(this.selection.filter(id => this.#nodes.has(id)));
    this.invalidate(); this.emit('change', { ids: changes.map(c => c.id), source });
  }
  undo() {
    this.#assert(); if (this.#transaction) throw new Error('Commit or cancel the open transaction first');
    const changes = this.#undo.pop(); if (!changes) return false;
    this.#apply(changes, 'before', 'undo'); this.#redo.push(changes); return true;
  }
  redo() {
    this.#assert(); if (this.#transaction) throw new Error('Commit or cancel the open transaction first');
    const changes = this.#redo.pop(); if (!changes) return false;
    this.#apply(changes, 'after', 'redo'); this.#undo.push(changes); return true;
  }
  clearHistory() { this.#assert(); this.#undo.length = this.#redo.length = 0; }
  /** Selects existing, visible, unlocked elements. */
  select(ids) {
    this.#assert();
    const selected = new Set(ids.filter(id => { const n = this.get(id); return n && !n.hidden && !n.locked; }));
    if (selected.size === this.#selection.size && [...selected].every(id => this.#selection.has(id))) return;
    this.#selection = selected; this.emit('selectionchange', { ids: this.selection });
  }
  /** Returns the topmost unlocked element at world coordinates, or null. */
  hitTest(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return this.#call('editor_hit', x, y) || null;
  }
  screenToWorld(x, y) { return { x: x / this.#camera.zoom + this.#camera.x, y: y / this.#camera.zoom + this.#camera.y }; }
  worldToScreen(x, y) { return { x: (x - this.#camera.x) * this.#camera.zoom, y: (y - this.#camera.y) * this.#camera.zoom }; }
  setViewport(patch) {
    this.#assert(); const v = { ...this.#camera, ...patch };
    if (![v.x, v.y, v.zoom].every(Number.isFinite) || Math.abs(v.x) > 1e6 || Math.abs(v.y) > 1e6 || v.zoom < 0.02 || v.zoom > 64)
      throw new RangeError('Viewport requires finite coordinates and zoom in [0.02, 64]');
    this.#camera = { x: v.x, y: v.y, zoom: v.zoom }; this.invalidate(); this.emit('viewportchange', this.viewport);
  }
  zoomAt(zoom, x, y) {
    const p = this.screenToWorld(x, y), z = Math.min(64, Math.max(0.02, zoom));
    this.setViewport({ zoom: z, x: p.x - x / z, y: p.y - y / z });
  }
  resize(width, height, pixelRatio = this.#scale) {
    this.#assert();
    if (![width, height, pixelRatio].every(n => Number.isFinite(n) && n > 0) || width * pixelRatio > 8192 || height * pixelRatio > 8192)
      throw new RangeError('Invalid viewport dimensions (maximum 8192 physical pixels per side)');
    this.#width = width; this.#height = height; this.#scale = pixelRatio;
    const w = Math.max(1, Math.floor(width * pixelRatio)), h = Math.max(1, Math.floor(height * pixelRatio));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.invalidate(); this.emit('viewportchange', this.viewport);
  }
  /** Schedules at most one frame. An unchanged editor consumes no animation frames. */
  invalidate() {
    if (this.#dead || !this.#autoRender || this.#frame) return;
    this.#frame = requestAnimationFrame(() => { this.#frame = 0; try { this.render(); } catch (error) { this.#error(error); } });
  }
  /** Submits a frame synchronously. stats separates text refresh, Silk scene work, and WebGPU encoding. */
  render() {
    this.#assert(); const textStart = performance.now(); this.#prepareText(); this.#textMs = performance.now() - textStart;
    const { x, y, zoom } = this.#camera;
    const result = this.#call('editor_draw', x, y, zoom, this.#scale, this.#width, this.#height, (this.culling ? 1 : 0) | (this.retainedImages ? 2 : 0), rgba(this.background));
    if (result < 0) throw new Error('Silk rendering failed (device, surface, geometry, or allocation)');
    this.emit('render', this.stats); return this.stats;
  }
  /** Waits for submitted GPU work. For measurements/export, not the normal rendering loop. */
  async flush() {
    this.#assert();
    const devices = [...this.#host.table.entries.values()].filter(e => e.type === 'WGPUDevice');
    await Promise.all(devices.map(e => e.object.queue.onSubmittedWorkDone()));
  }
  /** Exports a versioned JSON-compatible document. Internal IDs are informational. */
  toJSON() { return { version: 1, elements: [...this.elements()].map(({ id, ...n }) => n), viewport: { ...this.#camera } }; }
  /** Imports a document into this editor as one undoable group. Validates before changing it. */
  load(data) {
    if (data?.version !== 1 || !Array.isArray(data.elements) || data.elements.some(n => !n || typeof n !== 'object')) throw new TypeError('Unsupported document');
    const nodes = data.elements.map(normalize);
    for (const n of nodes) if (n.image && !this.#images.has(n.image)) throw new Error(`Image is not registered: ${n.image}`);
    this.batch(() => { for (const id of [...this.#nodes.keys()]) this.remove(id); for (const n of nodes) this.add(n); });
  }
  /** Releases observers, input listeners, pending frames, WASM state and GPU handles. Idempotent. */
  destroy() {
    if (this.#dead) return;
    cancelAnimationFrame(this.#frame); this.#observer?.disconnect();
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
    // Cancel again: canceling an active gesture can invalidate its rolled-back frame.
    cancelAnimationFrame(this.#frame); this.#frame = 0; this.#transaction = null;
    if (this.#token) this.#host.call('editor_drop', this.#token);
    this.#token = 0; this.#dead = true; this.#nodes.clear(); this.#selection.clear(); this.#images.clear();
    this.#undo.length = this.#redo.length = 0; this.#textTiles.clear(); this.#textNodes.clear(); this.#textViews.clear(); this.#textViewPool.length = 0;
    if (this.#textCanvas) this.#textCanvas.width = this.#textCanvas.height = 0;
    this.#textCanvas = this.#uploadCanvas = this.#textPreparation = this.#textBlocks = null; this.#textPixels = this.#textWarmPixels = 0;
    this.emit('destroy', {});
  }
}

// Runs the demo's wasm module (graphics/demo/browser) on a canvas: platform/window's WindowHost
// owns the canvas and its input, gpu/webgpu's WebGPUHost maps WebGPU onto navigator.gpu, and
// this file ticks the module whenever either host has news, and on every animation frame.
//
// Served from the repository root (scripts/browser does that), so the hosts load from their
// own packages.
import { WindowHost } from '/platform/window/browser/window-host.js';
import { WebGPUHost } from '/gpu/webgpu/browser/host.ts';

const STATUS = { RUNNING: 0, PASSED: 1, FAILED: 2, CLOSED: 3 };

/** Decodes the check record of browser/src/app.silk's finishCheck. */
function decodeCheck(bytes) {
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, 9);
  return { width: words[0], height: words[1], max: words[2], worstX: words[3], worstY: words[4],
    over: words[5], channels: words[6], mean: words[7] / 10000, pass: words[8] === 1 };
}

/**
 * Starts the demo on `canvas`. Resolves when the module stops: after a check (with its result),
 * when the window closes, or on an error (rejects).
 */
export async function runDemo({ canvas, wasm, check = false, log = console.log }) {
  canvas.id = 'silk-demo';
  const windowHost = new WindowHost({ container: canvas.parentElement ?? document.body });
  windowHost.addCanvas(canvas);
  let result;
  const messages = [];
  let schedule = () => {};
  const gpuHost = new WebGPUHost({ onWake: () => schedule() });
  windowHost.onWake = () => schedule();
  let memory;
  const imports = {
    window: windowHost.imports,
    webgpu: gpuHost.imports,
    // The C math functions wasm32 has no libm for (browser/src/libm.silk).
    math: { sin: Math.sin, cos: Math.cos, tan: Math.tan, hypot: Math.hypot, fmod: (x, y) => x % y },
    demo: {
      report(kind, pointer, length) {
        const bytes = new Uint8Array(memory.buffer, pointer, length).slice();
        if (kind === 1) result = decodeCheck(bytes);
        else { const text = new TextDecoder().decode(bytes); messages.push(text); log(text); }
      },
    },
  };
  const module = wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compileStreaming(fetch(wasm));
  const instance = await WebAssembly.instantiate(module, imports);
  memory = instance.exports.memory;
  windowHost.attach(instance);
  gpuHost.attach(instance);
  const token = gpuHost.call('demo_start', check ? 1 : 0);
  if (!token) throw new Error(messages.join('\n') || 'demo_start failed');
  return await new Promise((resolve, reject) => {
    let stopped = false;
    let queued = false;
    const stop = (error, value) => {
      if (stopped) return;
      stopped = true;
      try { gpuHost.call('demo_drop', token); } catch (dropError) { error ??= dropError; }
      if (gpuHost.failures.length) error ??= new Error(gpuHost.failures.join('\n'));
      error ? reject(error) : resolve(value);
    };
    const tick = () => {
      queued = false;
      if (stopped) return;
      let status;
      try { status = gpuHost.call('demo_tick', token); }
      catch (error) { stop(error); return; }
      if (status < 0) stop(new Error(messages.join('\n') || `demo_tick returned ${status}`));
      else if (status === STATUS.PASSED || status === STATUS.FAILED) stop(undefined, result);
      else if (status === STATUS.CLOSED) stop(undefined, { closed: true });
    };
    schedule = () => {
      if (queued || stopped) return;
      queued = true;
      setTimeout(tick, 0);
    };
    const frame = () => {
      if (stopped) return;
      tick();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

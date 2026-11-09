import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../scripts/internal.mjs';

function executable(name, env) {
  return (env.PATH ?? '').split(delimiter).map(directory => join(directory, name)).find(path => {
    try { accessSync(path, constants.X_OK); return true; } catch { return false; }
  });
}

// Keep displays alive for the entire callback, including asynchronous inspector automation.
export async function withDisplay(backend, env, callback) {
  if (!['x11', 'wayland'].includes(backend)) throw new Error(`Unknown window backend: ${backend}`);
  if (process.platform !== 'linux') return await callback({ ...env });
  const command = executable(backend === 'x11' ? 'Xvfb' : 'weston', env);
  const childEnv = { ...env, SILK_WINDOW_BACKEND: backend };
  if (!command) {
    console.log(`${backend === 'x11' ? 'Xvfb' : 'weston'} not found; using the session display`);
    return await callback(childEnv);
  }
  let runtime;
  let socket;
  let args;
  if (backend === 'x11') {
    let number = 90;
    while (number < 140 && (existsSync(`/tmp/.X11-unix/X${number}`) || existsSync(`/tmp/.X${number}-lock`))) number++;
    if (number === 140) throw new Error('No free X11 display between :90 and :139');
    socket = `/tmp/.X11-unix/X${number}`;
    childEnv.DISPLAY = `:${number}`;
    delete childEnv.WAYLAND_DISPLAY;
    args = [`:${number}`, '-screen', '0', '1280x800x24', '-nolisten', 'tcp'];
  } else {
    runtime = mkdtempSync(join(tmpdir(), 'silk-wayland-'));
    chmodSync(runtime, 0o700);
    childEnv.XDG_RUNTIME_DIR = runtime;
    childEnv.WAYLAND_DISPLAY = 'silk-smoke';
    delete childEnv.DISPLAY;
    socket = join(runtime, childEnv.WAYLAND_DISPLAY);
    args = ['--backend=headless', '--socket', childEnv.WAYLAND_DISPLAY, '--idle-time=0', '--width=1280', '--height=800'];
  }
  const server = spawn(command, args, { env: childEnv, stdio: 'ignore' });
  let failure;
  server.on('error', error => { failure = error; });
  const closed = new Promise(resolve => server.once('close', resolve));
  try {
    const deadline = Date.now() + 10000;
    while (!existsSync(socket)) {
      if (failure) throw failure;
      if (server.exitCode !== null || Date.now() >= deadline) throw new Error(`${command} did not start`);
      await delay(50);
    }
    return await callback(childEnv);
  } finally {
    server.kill('SIGTERM');
    const kill = setTimeout(() => server.kill('SIGKILL'), 3000);
    try { await closed; } finally { clearTimeout(kill); if (runtime) rmSync(runtime, { recursive: true, force: true }); }
  }
}

export async function windowCheck(program, backend = 'all', { args = ['--check'], env = process.env, timeout = 300000, cwd = root } = {}) {
  if (!['all', 'x11', 'wayland'].includes(backend)) throw new Error(`Unknown window backend: ${backend}`);
  const checkEnv = { ...env, SILK_WINDOW_SCALE: env.SILK_WINDOW_SCALE ?? '1' };
  const lavapipe = '/usr/share/vulkan/icd.d/lvp_icd.json';
  if (process.platform === 'linux' && !checkEnv.VK_ICD_FILENAMES && existsSync(lavapipe)) checkEnv.VK_ICD_FILENAMES = lavapipe;
  let status = 0;
  for (const name of process.platform === 'linux' ? (backend === 'all' ? ['x11', 'wayland'] : [backend]) : ['x11']) {
    console.log(`--- ${process.platform === 'linux' ? name : process.platform}`);
    const code = await withDisplay(name, checkEnv, childEnv => {
      const result = spawnSync(program, args, { cwd, env: childEnv, stdio: 'inherit', timeout });
      if (result.error) throw result.error;
      return result.status ?? 1;
    });
    console.log(`--- ${name}: ${code === 0 ? 'passed' : `failed (${code})`}`);
    status ||= code;
  }
  return status;
}

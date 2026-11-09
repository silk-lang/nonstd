import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { root, run, build } from '../../../scripts/internal.mjs';

export { assert, fs, path, os, sleep, root, run, build };
export const studio = path.join(root, 'examples/studio');
export const primary = process.platform === 'darwin' ? 'meta' : 'control';

export function options(description, definitions, { positionals = false } = {}) {
  const parsed = parseArgs({ options: { ...definitions, help: { type: 'boolean', short: 'h' } }, allowPositionals: positionals });
  if (parsed.values.help) {
    console.log(description);
    for (const [name, definition] of Object.entries(definitions)) {
      console.log(`  --${name}${definition.type === 'string' ? ' VALUE' : ''}${definition.default !== undefined ? ` (default: ${definition.default})` : ''}`);
    }
    process.exit(0);
  }
  return parsed;
}

export function binary(name) {
  const filename = name + (process.platform === 'win32' ? '.exe' : '');
  const directory = path.join(root, 'build/llvm');
  const candidates = fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(directory, entry.name, 'release', filename))
    .filter(candidate => fs.existsSync(candidate)) : [];
  assert.equal(candidates.length, 1, `Build ${name} in release mode or specify its binary path`);
  return candidates[0];
}

export function launch(command, args, log, options = {}) {
  const fd = fs.openSync(log, 'w');
  try {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', fd, fd], ...options });
    // Retain spawn failures for readiness/wait checks instead of emitting an unhandled error.
    child.on('error', error => { child.failure = error; });
    return child;
  } finally {
    fs.closeSync(fd);
  }
}

export function waitForExit(child, timeout) {
  if (child.failure) return Promise.reject(child.failure);
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Process ${child.pid} timed out after ${timeout}ms`)), timeout);
    const exited = code => finish(null, code);
    const failed = error => finish(error);
    function finish(error, code) {
      clearTimeout(timer);
      child.off('exit', exited);
      child.off('error', failed);
      if (error) reject(error); else resolve(code);
    }
    child.once('exit', exited);
    child.once('error', failed);
  });
}

export async function stop(child, timeout = 5000) {
  if (!child || child.failure || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  try { await waitForExit(child, timeout); }
  catch (error) {
    child.kill('SIGKILL');
    await waitForExit(child, 5000);
  }
}

export function inspector(address, timeout = 30000) {
  return (cmd, members = {}) => new Promise((resolve, reject) => {
    const socket = net.createConnection(address);
    let data = '';
    socket.setEncoding('utf8');
    socket.setTimeout(timeout, () => socket.destroy(new Error(`${cmd}: inspector timed out`)));
    socket.once('connect', () => socket.write(JSON.stringify({ cmd, ...members }) + '\n'));
    socket.on('data', chunk => {
      data += chunk;
      const end = data.indexOf('\n');
      if (end < 0) return;
      try {
        const reply = JSON.parse(data.slice(0, end));
        assert.ok(reply.ok, JSON.stringify({ cmd, members, reply }));
        resolve(reply);
      } catch (error) { reject(error); }
      socket.destroy();
    });
    socket.once('error', reject);
    socket.once('end', () => reject(new Error(`${cmd}: connection closed before the reply line`)));
  });
}

export async function ready(child, ask, log, { timeout = 30000, layout = false } = {}) {
  const deadline = performance.now() + timeout;
  for (;;) {
    if (child.failure) throw child.failure;
    assert.ok(child.exitCode === null && child.signalCode === null, fs.readFileSync(log, 'utf8'));
    try {
      const reply = await ask('hello');
      if (layout) assert.ok(reply.frame > 0, 'Inspector exposed a tree before its initial layout');
      return reply;
    } catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
      assert.ok(performance.now() < deadline, 'Inspector did not start');
      await sleep(50);
    }
  }
}

export function temporary(prefix) {
  // Keep Unix-domain socket paths short even when the checkout or macOS TMPDIR is long.
  return fs.mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', prefix));
}

export function summary(values, { upperMedian = false } = {}) {
  assert.ok(values.length > 0);
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return {
    samples: ordered.length,
    medianMs: !upperMedian && ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle],
    p95Ms: ordered[Math.floor((ordered.length - 1) * .95)],
    maxMs: ordered.at(-1),
  };
}

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, hostTarget, run } from './internal.mjs';

export function digest(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
export function install(asset, destination, required) {
  const marker = join(destination, '.archive-sha256');
  if (existsSync(destination)) {
    if (!existsSync(marker) || readFileSync(marker, 'utf8').trim() !== asset.sha256 || !existsSync(join(destination, required))) throw new Error(`Unverified installation: ${destination}; remove it and retry`);
    return destination;
  }
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = mkdtempSync(join(dirname(destination), '.install-'));
  try {
    const archive = join(temporary, 'release' + (new URL(asset.url).pathname.endsWith('.zip') ? '.zip' : '.tar.xz'));
    run('curl', ['--fail', '--location', '--silent', '--show-error', '--output', archive, asset.url], { stdio: ['ignore', 'ignore', 'inherit'] });
    if (digest(archive) !== asset.sha256) throw new Error(`SHA-256 mismatch: ${asset.url}`);
    const unzip = archive.endsWith('.zip') && process.platform === 'linux';
    const tar = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
    const members = run(unzip ? 'unzip' : tar, unzip ? ['-Z1', archive] : ['-tf', archive], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).stdout.split(/\r?\n/).filter(Boolean);
    if (members.some(name => /^[\\/]|^[A-Za-z]:/.test(name) || name.replaceAll('\\', '/').split('/').includes('..'))) throw new Error('Unsafe archive member');
    const staging = join(temporary, 'unpacked');
    mkdirSync(staging);
    run(unzip ? 'unzip' : tar, unzip ? ['-q', archive, '-d', staging] : ['-xf', archive, '-C', staging], { stdio: ['ignore', 'ignore', 'inherit'] });
    const entries = readdirSync(staging, { withFileTypes: true });
    const tree = asset.strip_root === false ? staging : entries.length === 1 && entries[0].isDirectory() ? join(staging, entries[0].name) : null;
    if (!tree || !existsSync(join(tree, required))) throw new Error('Release has unexpected layout');
    writeFileSync(join(tree, '.archive-sha256'), asset.sha256 + '\n');
    renameSync(tree, destination);
    return destination;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
export function installSilk() {
  const lock = JSON.parse(readFileSync(join(root, 'toolchains.lock.json'), 'utf8')).silk;
  const target = hostTarget();
  const asset = lock.platforms[target];
  if (!asset) throw new Error(`No pinned Silk release for ${target}`);
  const home = install(asset, join(root, '.cache/silk', lock.version, target), `bin/silkc${process.platform === 'win32' ? '.exe' : ''}`);
  const seedPath = join(root, '.cache/silk', `native-seed-${lock.version}.json`);
  if (!existsSync(seedPath) || digest(seedPath) !== lock.native_seed.sha256) {
    const pending = seedPath + `.${process.pid}.tmp`;
    try {
      run('curl', ['--fail', '--location', '--silent', '--show-error', '--output', pending, lock.native_seed.url], { stdio: ['ignore', 'ignore', 'inherit'] });
      if (digest(pending) !== lock.native_seed.sha256) throw new Error('Native seed SHA-256 mismatch');
      renameSync(pending, seedPath);
    } finally { rmSync(pending, { force: true }); }
  }
  const entry = JSON.parse(readFileSync(seedPath, 'utf8')).seeds[target];
  if (entry && (entry.tag !== `v${lock.version}` || entry.target !== target || digest(join(home, 'bin', `silkc${process.platform === 'win32' ? '.exe' : ''}`)) !== entry.sha256)) throw new Error('Compiler differs from pinned native seed');
  return join(home, 'bin');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bin = installSilk();
  if (process.env.GITHUB_PATH) appendFileSync(process.env.GITHUB_PATH, bin + '\n');
  console.log(bin);
}

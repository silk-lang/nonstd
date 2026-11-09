#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { installSilk } from './install-silk.mjs';
import { repositoryRoot } from './dependency-root.mjs';
import { root, run } from './internal.mjs';

const options = process.argv.slice(2);
for (const option of options) if (!['--browser', '--linux-gpu'].includes(option)) throw new Error(`Unknown option: ${option}`);
const bin = installSilk();
process.env.PATH = bin + delimiter + process.env.PATH;
if (process.env.GITHUB_PATH) appendFileSync(process.env.GITHUB_PATH, bin + '\n');
// Silk resolves Git payloads while checking. Complete the first fetch before parallel work.
run('silk', ['check', '--workspace']);
const native = repositoryRoot('lib-native');
const lock = JSON.parse(readFileSync(join(root, 'toolchains.lock.json'), 'utf8'));
const nativeLock = JSON.parse(readFileSync(join(native, 'toolchains.lock.json'), 'utf8'));
if (lock.silk.version !== nativeLock.silk.version || lock.llvm.version !== nativeLock.llvm.version) throw new Error('Root and pinned lib-native compiler/LLVM versions must agree');
run(process.execPath, [join(native, 'scripts/setup-ci.mjs'), ...options]);
if (process.platform === 'darwin' && process.env.GITHUB_ENV) {
  const sdk = run('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).stdout.trim();
  appendFileSync(process.env.GITHUB_ENV, `SDKROOT=${sdk}\n`);
}

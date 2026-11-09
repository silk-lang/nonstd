import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { build, root } from '../scripts/internal.mjs';
import { repositoryRoot } from '../scripts/dependency-root.mjs';

export function buildBrowser(packagePath, { release = true } = {}) {
  const absolute = resolve(root, packagePath);
  const directory = absolute.endsWith('silk.toml') ? dirname(absolute) : absolute;
  const exports = join(directory, 'src/generated_webgpu_exports.silk');
  if (existsSync(exports)) copyFileSync(join(repositoryRoot('lib-native'), 'modules/gpu/webgpu/browser/generated_webgpu_exports.silk'), exports);
  // Match native's 8 MiB stack for deep UI layout. Windows cannot use a script as clang.exe.
  const previous = process.env.SILK_CLANG;
  if (process.platform !== 'win32') {
    const which = name => name.includes('/') ? resolve(root, name) :
      (process.env.PATH ?? '').split(delimiter).map(directory => resolve(root, directory, name)).find(existsSync);
    let clang = previous && which(previous);
    if (previous && !clang) throw new Error(`Cannot find SILK_CLANG executable: ${previous}`);
    if (!previous) {
      const candidates = [which('clang-22'),
        ...(process.platform === 'darwin' ? ['/opt/homebrew/opt/llvm/bin/clang', '/usr/local/opt/llvm/bin/clang'] : []),
        which('clang')];
      clang = candidates.find(path => {
        if (!path) return false;
        const version = spawnSync(path, ['--version'], { encoding: 'utf8' });
        return version.status === 0 && Number(version.stdout.match(/clang version (\d+)\./)?.[1]) >= 22;
      });
    }
    if (!clang) throw new Error('LLVM 22 or newer was not found. Install LLVM 22 or set SILK_CLANG to its clang executable.');
    const wrapper = join(root, '.cache/browser-clang/clang');
    mkdirSync(dirname(wrapper), { recursive: true });
    const quoted = `'${clang.replaceAll("'", "'\\''")}'`;
    writeFileSync(wrapper, `#!/bin/sh\nfor arg do\n  case "$arg" in -c|-S|-E|-v|--version) exec ${quoted} "$@";; esac\ndone\nexec ${quoted} "$@" -Wl,-z,stack-size=8388608\n`, { mode: 0o755 });
    process.env.SILK_CLANG = wrapper;
  }
  try { return build(packagePath, { release, wasm: true }); }
  finally { if (previous === undefined) delete process.env.SILK_CLANG; else process.env.SILK_CLANG = previous; }
}

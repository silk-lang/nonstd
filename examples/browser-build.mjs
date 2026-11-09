import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
    if (!previous) throw new Error('Set SILK_CLANG to LLVM 22 clang (scripts/setup-ci.mjs configures it)');
    const wrapper = join(root, '.cache/browser-clang/clang');
    mkdirSync(dirname(wrapper), { recursive: true });
    const quoted = `'${previous.replaceAll("'", "'\\''")}'`;
    writeFileSync(wrapper, `#!/bin/sh\nfor arg do\n  case "$arg" in -c|-S|-E|-v|--version) exec ${quoted} "$@";; esac\ndone\nexec ${quoted} "$@" -Wl,-z,stack-size=8388608\n`, { mode: 0o755 });
    process.env.SILK_CLANG = wrapper;
  }
  try { return build(packagePath, { release, wasm: true }); }
  finally { if (previous === undefined) delete process.env.SILK_CLANG; else process.env.SILK_CLANG = previous; }
}

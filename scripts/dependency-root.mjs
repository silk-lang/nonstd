import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dependencies, manifests, text } from './manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repositories = ['lib-native', 'lib-graphics', 'lib-fonts', 'lib-css', 'lib-svg', 'lib-ui'];
export function retainedManifests() {
  return ['db', 'crdt', 'examples'].flatMap(area => manifests(join(root, area)));
}
export function repositoryPins() {
  const pins = new Map();
  for (const manifest of retainedManifests()) {
    for (const dependency of dependencies(text(manifest))) {
      if (!dependency.git) continue;
      const name = dependency.git.match(/^https:\/\/github\.com\/silk-lang\/(lib-[a-z]+)\.git$/)?.[1];
      if (!repositories.includes(name) || !/^[0-9a-f]{40}$/.test(dependency.rev ?? '') || !dependency.path || !dependency.package) {
        throw new Error(`${manifest}: expected canonical { git, rev, path, package } dependency: ${dependency.alias}`);
      }
      if (pins.has(name) && pins.get(name) !== dependency.rev) throw new Error(`${name} has conflicting revisions in retained manifests`);
      pins.set(name, dependency.rev);
    }
  }
  return pins;
}
export function repositoryRoot(name) {
  const revision = repositoryPins().get(name);
  if (!revision) throw new Error(`No pinned ${name} dependency in retained manifests`);
  const checkout = resolve(process.env.SILK_HOME || join(homedir(), '.silk'), 'git', revision);
  if (!existsSync(join(checkout, 'silk.toml'))) throw new Error(`Missing ${name} at ${checkout}; fetch dependencies with silk check --manifest-path examples/graphics-demo/app/silk.toml first`);
  return checkout;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/dependency-root.mjs lib-native');
  console.log(repositoryRoot(process.argv[2]));
}

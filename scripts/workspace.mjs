import { dirname, join, relative } from 'node:path';
import { root } from './internal.mjs';
import { section, stringArray, stringField, text } from './manifest.mjs';
import { retainedManifests } from './dependency-root.mjs';

export function workspace() {
  const config = text(join(root, 'layers.toml'));
  const excluded = new Map([...section(config, 'excluded').matchAll(/^\s*("(?:[^"\\]|\\.)*")\s*=\s*("(?:[^"\\]|\\.)*")/gm)].map(match => [JSON.parse(match[1]), JSON.parse(match[2])]));
  const members = stringArray(section(text(join(root, 'silk.toml')), 'workspace'), 'members');
  const layers = config.split('[[layer]]').slice(1).map(source => ({ name: stringField(source, 'name'), rank: Number(source.match(/^rank\s*=\s*(\d+)/m)?.[1]), paths: stringArray(source, 'paths') }));
  const packages = retainedManifests().map(manifest => ({ manifest, path: relative(root, dirname(manifest)).replaceAll('\\', '/'), ...Object.fromEntries(['name', 'description'].map(key => [key, stringField(section(text(manifest), 'package'), key)])) }));
  const layerOf = path => layers.flatMap(layer => layer.paths.map(prefix => ({ ...layer, prefix }))).sort((a, b) => b.prefix.length - a.prefix.length).find(layer => path === layer.prefix || path.startsWith(layer.prefix + '/'));
  return { excluded, members, layers, packages, layerOf };
}

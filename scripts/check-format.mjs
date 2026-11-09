#!/usr/bin/env node
// Generated browser exports are checked against their pinned native generator, not reformatted.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, run } from './internal.mjs';
const files = [];
function collect(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['build', 'node_modules'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.name === 'silk.toml' || (entry.name.endsWith('.silk') && !entry.name.startsWith('generated_'))) files.push(path);
  }
}
for (const directory of ['db', 'crdt', 'examples']) collect(directory);
run('silk', ['format', '--check', ...files.sort()]);

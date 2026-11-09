import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Only read the manifest fields used by workspace tools. Silk remains the TOML validator.
export function text(path) { return readFileSync(path, 'utf8'); }
export function section(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`^\\[${escaped}\\]\\s*\\n([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, 'm'))?.[1] ?? '';
}
export function stringField(source, name) {
  const match = source.match(new RegExp(`^\\s*${name}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")`, 'm'));
  return match ? JSON.parse(match[1]) : undefined;
}
export function stringArray(source, name) {
  const value = source.match(new RegExp(`^\\s*${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'))?.[1] ?? '';
  return [...value.replace(/#[^\n]*/g, '').matchAll(/"(?:[^"\\]|\\.)*"/g)].map(match => JSON.parse(match[0]));
}
export function dependencies(source) {
  const entries = [];
  for (const line of section(source, 'dependencies').split('\n')) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) continue;
    const match = clean.match(/^([\w-]+)\s*=\s*\{(.*)\}\s*(?:#.*)?$/);
    if (!match) throw new Error(`Dependencies must use canonical single-line inline tables: ${line}`);
    const fields = {};
    for (const field of match[2].matchAll(/([\w-]+)\s*=\s*("(?:[^"\\]|\\.)*")/g)) fields[field[1]] = JSON.parse(field[2]);
    entries.push({ alias: match[1], ...fields });
  }
  if (/^\[dependencies\./m.test(source)) throw new Error('Use inline dependency entries, not dependency subtables');
  return entries;
}
export function manifests(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && !['build', 'node_modules', 'target'].includes(entry.name)) result.push(...manifests(join(directory, entry.name)));
    else if (entry.isFile() && entry.name === 'silk.toml') result.push(join(directory, entry.name));
  }
  return result;
}

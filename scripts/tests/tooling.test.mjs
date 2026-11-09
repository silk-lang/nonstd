import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest, install } from '../install-silk.mjs';
import { dependencies, section, stringArray } from '../manifest.mjs';

// A single uncompressed ZIP member exercises the actual downloader/extractor on every host.
function zip(name, value) {
  const filename = Buffer.from(name), data = Buffer.from(value);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + data.length, 16);
  return Buffer.concat([local, filename, data, central, filename, end]);
}
function temporary(fn) {
  const directory = mkdtempSync(join(tmpdir(), 'nonstd ü tools '));
  try { fn(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}
test('ZIP root stripping, flat distributions and verified reuse', () => temporary(directory => {
  for (const strip_root of [true, false]) {
    const archive = join(directory, `release-${strip_root}.zip`);
    writeFileSync(archive, zip(strip_root ? 'release/bin/tool.exe' : 'bin/tool.exe', 'verified release'));
    const asset = { url: pathToFileURL(archive).href, sha256: digest(archive), strip_root };
    const destination = join(directory, String(strip_root));
    install(asset, destination, 'bin/tool.exe');
    assert.equal(readFileSync(join(destination, 'bin/tool.exe'), 'utf8'), 'verified release');
    assert.equal(install(asset, destination, 'bin/tool.exe'), destination);
    assert.throws(() => install({ ...asset, sha256: '0'.repeat(64) }, destination, 'bin/tool.exe'), /Unverified installation/);
  }
}));
test('ZIP traversal and checksum mismatches fail before extraction', () => temporary(directory => {
  const archive = join(directory, 'release.zip');
  writeFileSync(archive, zip('../escape', 'bad'));
  const asset = { url: pathToFileURL(archive).href, sha256: digest(archive) };
  assert.throws(() => install(asset, join(directory, 'installed'), 'escape'), /Unsafe archive member/);
  assert.equal(existsSync(join(directory, 'escape')), false);
  assert.throws(() => install({ ...asset, sha256: '0'.repeat(64) }, join(directory, 'bad-hash'), 'escape'), /SHA-256 mismatch/);
}));
test('manifest reader keeps dependency tables separate from package and workspace fields', () => {
  const source = '[package]\nname = "test"\n[dependencies]\nui = { git = "https://github.com/silk-lang/lib-ui.git", rev = "' + 'a'.repeat(40) + '", path = "modules/tree", package = "ui-tree" }\n[workspace]\nmembers = [\n "db/sqlite", # retained\n "crdt/core",\n]\n';
  assert.equal(dependencies(source)[0].package, 'ui-tree');
  assert.deepEqual(stringArray(section(source, 'workspace'), 'members'), ['db/sqlite', 'crdt/core']);
  assert.throws(() => dependencies('[dependencies.ui]\npath = "../ui"\n'), /inline dependency/);
});

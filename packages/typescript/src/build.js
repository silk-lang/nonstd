import { readFile } from 'node:fs/promises'
import { moduleSource } from './glue.js'
import { buildWasm } from './silk.js'

/** Compiles a .silk file to a JavaScript module whose exports call into wasm. */
export async function compileSilkModule(fileName, content) {
  const source = content ?? (await readFile(fileName, 'utf8'))
  const { wasm, functions } = await buildWasm(fileName, source)
  return moduleSource(wasm, functions)
}

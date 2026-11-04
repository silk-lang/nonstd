import { fileURLToPath } from 'node:url'
import { compileSilkModule } from './build.js'

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.silk')) return nextLoad(url, context)
  return { format: 'module', source: await compileSilkModule(fileURLToPath(url)), shortCircuit: true }
}

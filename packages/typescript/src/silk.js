// Asks the Silk toolchain about one .silk file: its public functions (`silk doc`), its errors
// (`silk check --json`) and a wasm32 build. Each file is copied into a scratch package, so the
// editor's unsaved text is what gets analyzed and no silk.toml is needed next to it.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isUnit, typeScriptType } from './types.js'

const run = promisify(execFile)
const silk = process.env.SILK ?? 'silk'

async function scratchPackage(fileName, kind) {
  const hash = createHash('sha256').update(fileName).digest('hex').slice(0, 16)
  const root = join(tmpdir(), 'silk-typescript', `${hash}-${kind}`)
  await mkdir(join(root, 'src'), { recursive: true })
  const library = kind === 'library' ? 'kind = "library"\n' : ''
  await writeFile(join(root, 'silk.toml'), `[package]\nname = "silk-ts-${kind}"\nversion = "0.1.0"\n${library}`)
  return root
}

// Byte offsets from the compiler, turned into JavaScript string indices.
function indexer(content) {
  const bytes = Buffer.from(content, 'utf8')
  return (offset) => bytes.subarray(0, offset).toString('utf8').length
}

function parseFunction(item, parameters, content, toIndex) {
  const header = item.signature.match(/^pub fn ([A-Za-z_][A-Za-z0-9_]*)\((.*)\)\s*(?:->\s*(.+))?$/s)
  if (!header) return { name: item.name, unsupported: `\`${item.signature}\` is not a plain function` }
  const returns = header[3] ?? '()'
  const start = toIndex(item.source.start)
  const end = toIndex(item.source.end)
  const nameAt = content.indexOf(item.name, content.indexOf('fn', start) + 2)
  const fn = {
    name: item.name,
    documentation: item.documentation?.markdown,
    nameSpan: [nameAt, nameAt + item.name.length],
    span: [start, end],
    parameters: [],
    returns: { silk: returns, ts: isUnit(returns) ? 'void' : typeScriptType(returns) },
  }
  const returnAt = content.lastIndexOf(returns, content.indexOf('{', start))
  fn.returns.span = returnAt >= start ? [returnAt, returnAt + returns.length] : undefined
  for (const parameter of parameters) {
    const [, type] = parameter.signature.split(/:\s*/)
    const pStart = toIndex(parameter.source.start)
    const typeAt = content.indexOf(type, pStart + parameter.name.length)
    fn.parameters.push({
      name: parameter.name,
      nameSpan: [pStart, pStart + parameter.name.length],
      silk: type,
      ts: typeScriptType(type),
      typeSpan: [typeAt, typeAt + type.length],
    })
  }
  const bad = [...fn.parameters.filter((p) => !p.ts).map((p) => p.silk), ...(fn.returns.ts ? [] : [returns])]
  if (bad.length > 0) fn.unsupported = `${bad.map((t) => `\`${t}\``).join(', ')} cannot cross into TypeScript yet`
  return fn
}

/** Public functions of one Silk source text, with spans as JavaScript string indices. */
export async function describe(fileName, content) {
  const root = await scratchPackage(fileName, 'library')
  const source = join(root, 'src', 'lib.silk')
  await writeFile(source, content)
  const output = join(root, 'doc.json')
  const toIndex = indexer(content)
  const [checked, documented] = await Promise.allSettled([
    run(silk, ['check', '--json', '--quiet'], { cwd: root }),
    run(silk, ['doc', '--output', output], { cwd: root }),
  ])
  for (const result of [checked, documented]) {
    if (result.status === 'rejected' && result.reason.code === 'ENOENT') {
      throw new Error(`cannot run \`${silk}\`: put silk on PATH or set SILK to its path`)
    }
  }
  const diagnostics = []
  // `silk check --json` writes its diagnostic lines to stderr.
  const checkResult = checked.status === 'fulfilled' ? checked.value : checked.reason
  const checkOutput = `${checkResult.stdout ?? ''}\n${checkResult.stderr ?? ''}`
  for (const line of checkOutput.split('\n')) {
    if (!line.startsWith('{')) continue
    const entry = JSON.parse(line)
    if (entry.path !== source) continue
    const start = toIndex(entry.start)
    diagnostics.push({
      start,
      length: Math.max(toIndex(entry.end) - start, 0),
      message: `${entry.code}: ${entry.message}`,
      code: Number(entry.code.replace(/\D/g, '')) || 1,
      severity: entry.severity,
    })
  }
  const functions = []
  if (documented.status === 'fulfilled') {
    const doc = JSON.parse(await readFile(output, 'utf8'))
    const module = doc.modules.find((m) => m.sourcePath === source)
    const items = module?.items ?? []
    items.forEach((item, index) => {
      if (item.kind !== 'Function' || item.visibility !== 'Public') return
      const parameters = items.filter((p) => p.kind === 'Parameter' && p.parent === index)
      functions.push(parseFunction(item, parameters, content, toIndex))
    })
  }
  return { functions, diagnostics }
}

/** Builds one Silk source text for wasm32, exporting each supported public function by name. */
export async function buildWasm(fileName, content) {
  const { functions, diagnostics } = await describe(fileName, content)
  const errors = diagnostics.filter((d) => d.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`${fileName}: ${errors.map((d) => d.message).join('\n')}`)
  }
  const exported = functions.filter((fn) => !fn.unsupported && fn.name !== 'main')
  // The C ABI has no bool, so booleans cross as u8.
  const abiType = (silkType, ts) => (ts === 'boolean' ? 'u8' : silkType)
  const shims = exported.map((fn) => {
    const parameters = fn.parameters.map((p) => `${p.name}: ${abiType(p.silk, p.ts)}`).join(', ')
    const returns = fn.returns.ts === 'void' ? '' : ` -> ${abiType(fn.returns.silk, fn.returns.ts)}`
    const args = fn.parameters.map((p) => (p.ts === 'boolean' ? `${p.name} != 0` : p.name))
    const call = `${fn.name}(${args.join(', ')})`
    const body = fn.returns.ts === 'void'
      ? `${call}\n  return ()`
      : fn.returns.ts === 'boolean'
        ? `if ${call} {\n    return 1\n  }\n  return 0`
        : `return ${call}`
    return `export "C" fn silk_ts_export_${fn.name}(${parameters})${returns} as "${fn.name}" {\n  ${body}\n}`
  })
  const hasMain = functions.some((fn) => fn.name === 'main')
  const root = await scratchPackage(fileName, 'wasm')
  const program = [content, '', '// Generated by silk-typescript', ...shims, hasMain ? '' : 'pub fn main() -> i32 { return 0 }', ''].join('\n')
  await writeFile(join(root, 'src', 'main.silk'), program)
  await run(silk, ['build', '--release', '--quiet', '--target', 'wasm32-unknown-unknown'], { cwd: root })
  const wasm = await readFile(join(root, 'build', 'llvm', 'wasm32-unknown-unknown', 'release', 'silk-ts-wasm'))
  return { wasm, functions: exported }
}

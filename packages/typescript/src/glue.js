// The JavaScript module a .silk import becomes at run time: the wasm bytes inline, instantiated
// once, with one wrapper per exported function. Booleans cross wasm as i32.
export function moduleSource(wasm, functions) {
  const lines = [
    `const bytes = Uint8Array.from(atob(${JSON.stringify(Buffer.from(wasm).toString('base64'))}), (c) => c.charCodeAt(0))`,
    'const { instance } = await WebAssembly.instantiate(bytes, {})',
    'const silk = instance.exports',
  ]
  for (const fn of functions) {
    const names = fn.parameters.map((p) => p.name)
    const args = fn.parameters.map((p) => (p.ts === 'boolean' ? `${p.name} ? 1 : 0` : p.name))
    const call = `silk.${fn.name}(${args.join(', ')})`
    const body = fn.returns.ts === 'boolean' ? `return ${call} !== 0` : fn.returns.ts === 'void' ? call : `return ${call}`
    lines.push(`export function ${fn.name}(${names.join(', ')}) { ${body} }`)
  }
  return lines.join('\n') + '\n'
}

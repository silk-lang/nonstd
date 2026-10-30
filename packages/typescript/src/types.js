// How a Silk type crosses into TypeScript. The spike admits scalars only: they pass through wasm
// as plain values, so the glue needs no memory management. Anything else is left out of the
// TypeScript view and reported as unsupported.
const scalars = new Map([
  ['i8', 'number'], ['i16', 'number'], ['i32', 'number'],
  ['u8', 'number'], ['u16', 'number'], ['u32', 'number'],
  ['f32', 'number'], ['f64', 'number'],
  ['i64', 'bigint'], ['u64', 'bigint'],
  ['bool', 'boolean'],
])

export function typeScriptType(silkType) {
  return scalars.get(silkType.trim())
}

export function isUnit(silkType) {
  const text = silkType.trim()
  return text === '' || text === '()'
}

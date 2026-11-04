// A TypeScript 7.1 content mapper for .silk files. TypeScript sends each .silk file it meets;
// this answers with TypeScript declarations for the file's public functions, mapped back to the
// Silk source so hover, go to definition and diagnostics land in the .silk file.
import { MappedCodeBuilder, SpanMapFeature, runContentMapper } from 'ts-content-mapper'
import { describe } from './silk.js'

const navigation = SpanMapFeature.Hover | SpanMapFeature.Definition | SpanMapFeature.References |
  SpanMapFeature.DocumentHighlights | SpanMapFeature.Rename | SpanMapFeature.DocumentSymbols
const typeFeatures = SpanMapFeature.Hover | SpanMapFeature.Definition

function comment(markdown) {
  return `/**\n${markdown.split('\n').map((line) => ` * ${line.replaceAll('*/', '*\\/')}`).join('\n')}\n */\n`
}

runContentMapper({
  diagnosticSource: 'silk',
  async transform(params, context) {
    const { functions, diagnostics } = await describe(params.fileName, params.content)
    const code = new MappedCodeBuilder(params.content, { positionEncoding: context.positionEncoding })
    code.append('// TypeScript view of a Silk module (silk-typescript)\n')
    for (const fn of functions) {
      if (fn.unsupported) {
        code.append(`// ${fn.name}: ${fn.unsupported}\n`)
        continue
      }
      if (fn.documentation) code.append(comment(fn.documentation))
      code.append('export declare function ')
      code.appendVerbatim(fn.nameSpan[0], fn.nameSpan[1], navigation)
      code.append('(')
      fn.parameters.forEach((parameter, index) => {
        if (index > 0) code.append(', ')
        code.appendVerbatim(parameter.nameSpan[0], parameter.nameSpan[1], navigation)
        code.append(': ')
        code.appendAtom(parameter.ts, parameter.typeSpan[0], parameter.typeSpan[1], typeFeatures)
      })
      code.append('): ')
      if (fn.returns.span) code.appendAtom(fn.returns.ts, fn.returns.span[0], fn.returns.span[1], typeFeatures)
      else code.append(fn.returns.ts)
      code.append(';\n')
    }
    if (!functions.some((fn) => !fn.unsupported)) code.append('export {};\n')
    const output = code.build('.ts')
    const toPosition = (index) => Buffer.byteLength(params.content.slice(0, index), 'utf8')
    const position = context.positionEncoding === 'utf-8' ? toPosition : (index) => index
    return {
      ...output,
      diagnostics: diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => ({
          messageText: d.message,
          start: position(d.start),
          length: position(d.start + d.length) - position(d.start),
          code: d.code,
        })),
    }
  },
})

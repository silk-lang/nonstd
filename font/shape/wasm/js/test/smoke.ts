// Shapes a few strings with the wasm build and compares them with the native hr_shape output.
// Run `font/scripts/build-wasm` first; fonts come from the font/shape/test-data/harfrust submodule.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { Harfrust, type ShapeResult } from '../src/index.ts'

const root = new URL('../../../../../', import.meta.url)
const fonts = new URL('font/shape/test-data/harfrust/harfrust/benches/fonts/', root)
const harfrust = await Harfrust.instantiate(readFileSync(new URL('font/shape/wasm/js/dist/harfrust.wasm', root)))

// The native runner's format: name=cluster@x,y+advance, with clusters as character indices.
const serialize = (text: string, result: ShapeResult): string => {
  const bytes = new TextEncoder().encode(text)
  const characterAt = (byte: number): number =>
    new TextDecoder().decode(bytes.subarray(0, byte)).length -
    (new TextDecoder().decode(bytes.subarray(0, byte)).match(/[\uD800-\uDBFF]/g)?.length ?? 0)
  const glyphs = result.glyphs.map(glyph => {
    const offset = glyph.xOffset || glyph.yOffset ? `@${glyph.xOffset},${glyph.yOffset}` : ''
    return `${glyph.name ?? `gid${glyph.glyphId}`}=${characterAt(glyph.cluster)}${offset}+${glyph.xAdvance}`
  })
  return `[${glyphs.join('|')}]`
}

const cases: ReadonlyArray<{
  font: string
  text: string
  variations?: Record<string, number>
  expected: string
}> = [
  {
    font: 'Roboto-Regular.ttf',
    text: 'office',
    expected: '[gid84=0+1168|gid1833=1+1748|gid72=4+1072|gid74=5+1086]',
  },
  {
    font: 'Amiri-Regular.ttf',
    text: 'بِسْمِ اللَّهِ',
    expected:
      '[uni0650=12@-154,370+0|uni0647.fina_Lellah=12+721|uni064E.small=9@133,-336+0|uni0651=9@-277,-440+0|uni0644.medi_Lellah=9+473|uni0644.init_Lellah=8+319|uni0627=7+446|space=6+600|uni0650=4@156,0+0|uni0645.fina_PostTooth=4+1158|uni0652=2@-358,0+0|uni0633.medi_BaaSenAltInit=2+598|uni0650=0@-272,0+0|uni0628.init_BaaSenAltInit=0+449]',
  },
  {
    font: 'NotoSansDevanagari-Regular.ttf',
    text: 'नमस्ते',
    expected: '[uni0928=0+555|uni092E=1+598|saprehalfdeva=2+389|uni0924=4+570|uni0947=4+0]',
  },
  {
    font: 'SourceSerifVariable-Roman.ttf',
    text: 'Wave',
    variations: { wght: 900 },
    expected: '[gid24=0+899|gid28=1+520|gid49=2+506|gid32=3+526]',
  },
]

for (const testCase of cases) {
  const font = harfrust.font(readFileSync(new URL(testCase.font, fonts)))
  const result = font.shape(testCase.text, {
    glyphNames: true,
    outlines: true,
    ...(testCase.variations ? { variations: testCase.variations } : {}),
  })
  assert.equal(serialize(testCase.text, result), testCase.expected, testCase.font)
  for (const glyph of result.glyphs) {
    assert.ok(result.outlines.has(glyph.glyphId), `${testCase.font}: outline for ${glyph.glyphId}`)
  }
}

const roboto = harfrust.font(readFileSync(new URL('Roboto-Regular.ttf', fonts)))
assert.equal(roboto.info.unitsPerEm, 2048)
assert.match(roboto.shape('o', { outlines: true }).outlines.get(84) ?? '', /^M.*Z$/)
assert.equal(roboto.shape('office', { features: ['-liga'] }).glyphs.length, 6)
assert.throws(() => harfrust.font(new Uint8Array([1, 2, 3])), /InvalidFont/)
const serif = harfrust.font(readFileSync(new URL('SourceSerifVariable-Roman.ttf', fonts)))
assert.deepEqual(serif.info.axes.map(axis => [axis.tag, axis.min, axis.max]), [['wght', 200, 900]])
console.log(`ok: ${cases.length} shaping cases match hr_shape`)

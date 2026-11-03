import pixels from './assets/selection-pixels.json' with { type: 'json' }
import { makeNode, type Node } from './document'

export const selectionTitle = ['SILK + WEBGPU +EFFECT + FOLDKIT', '100K elements'] as const
const titleWidth = (text: string): number => Math.ceil(text.length * 512 * 0.6 + 4) * 2.5
export const selectionMosaicBounds = {
  x: 0,
  y: 0,
  width: 20_000,
  height: (20_000 * pixels.sourceHeight) / pixels.sourceWidth,
} as const
const pageWidth = Math.max(
  selectionMosaicBounds.width,
  ...selectionTitle.map((text) => titleWidth(text)),
)
export const selectionPageBounds = {
  ...selectionMosaicBounds,
  x: (selectionMosaicBounds.width - pageWidth) / 2,
  width: pageWidth,
  y: -4800,
  height: selectionMosaicBounds.height + 4800,
} as const
const shades = Array.from(
  { length: 256 },
  (_, value) => `#${value.toString(16).padStart(2, '0').repeat(3)}`,
)
const samples = atob(pixels.grayscale)
const pixelGap = 2

export const mosaicPixel = (id: string, index: number): Node => {
  const width = selectionMosaicBounds.width / pixels.columns
  const height = selectionMosaicBounds.height / pixels.rows
  return makeNode(id, 'rect', {
    name: `Rectangle ${String(index + 1).padStart(6, '0')}`,
    x: (index % pixels.columns) * width + pixelGap / 2,
    y: Math.floor(index / pixels.columns) * height + pixelGap / 2,
    width: width - pixelGap,
    height: height - pixelGap,
    fill: shades[samples.codePointAt(index) ?? 255] ?? '#ffffff',
  })
}
export const mosaicTitle = (id: string, line: number): Node => {
  // Courier New is monospaced; match the renderer's font-size and padding metrics.
  const text = selectionTitle[line] ?? ''
  const scale = 2.5
  const width = titleWidth(text)
  return makeNode(id, 'text', {
    name: text,
    text,
    x: (selectionMosaicBounds.width - width) / 2,
    y: selectionPageBounds.y + line * 2000,
    width,
    height: 772 * scale,
    fontSize: 512,
    fontFamily: 'Courier New',
    fontWeight: 700,
    fill: '#25352b',
  })
}

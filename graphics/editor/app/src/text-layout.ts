import type { Node } from './document'

// Canvas typography is an external browser boundary. Keep its measurement formula
// identical to the library's text atlas and vector glyph layout.
let context: CanvasRenderingContext2D | null = null
export const textMetrics = (node: Node) => {
  context ??= document.createElement('canvas').getContext('2d')
  if (!context) throw new Error('Text measurement is unavailable.')
  context.font = `${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`
  const metrics = context.measureText(node.text)
  const left = Math.max(0, metrics.actualBoundingBoxLeft)
  const ascent = Math.max(node.fontSize, metrics.actualBoundingBoxAscent)
  const descent = Math.max(node.fontSize * 0.5, metrics.actualBoundingBoxDescent)
  return {
    width: Math.max(
      1,
      Math.ceil(Math.max(metrics.width, metrics.actualBoundingBoxRight) + left + 4),
    ),
    height: Math.max(1, Math.ceil(ascent + descent + 4)),
    baseline: ascent + 2,
    left: left + 2,
  }
}
export const naturalText = (node: Node): Node => {
  const { width, height } = textMetrics(node)
  return { ...node, width, height }
}

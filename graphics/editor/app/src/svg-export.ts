import { paintExtent, svgFilter } from './svg-effects'
import { currentPage, descendants, type DesignDocument, type Node, type Page } from './document'
import { boundsOf, effectiveFlag } from './geometry'
import { inheritedOpacity, paintOrder } from './hierarchy'
import { textMetrics } from './text-layout'

export const escapeXml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
const shape = (n: Node, shared: string): string => {
  if (n.kind === 'ellipse')
    return `<ellipse cx="${n.x + n.width / 2}" cy="${n.y + n.height / 2}" rx="${n.width / 2}" ry="${n.height / 2}" ${shared}/>`
  if (n.kind === 'text') {
    const metrics = textMetrics(n)
    return `<g ${shared}><text transform="translate(${n.x} ${n.y}) scale(${n.width / metrics.width} ${n.height / metrics.height})" x="${metrics.left}" y="${metrics.baseline}" font-family="${escapeXml(n.fontFamily)}" font-size="${n.fontSize}" font-weight="${n.fontWeight}" xml:space="preserve">${escapeXml(n.text)}</text></g>`
  }
  return `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="${Math.min(n.radius, n.width / 2, n.height / 2)}" ${shared}/>`
}
export const svgDocument = (page: Page, selection: readonly string[] = []): string => {
  const ids = new Set(descendants(page.nodes, selection).map((n) => n.id))
  const nodes = paintOrder(page.nodes).filter(
    (n) =>
      n.kind !== 'group' &&
      !effectiveFlag(n, page.nodes, 'hidden') &&
      (selection.length === 0 || ids.has(n.id)),
  )
  if (nodes.some((n) => n.backdropBlur > 0))
    throw new Error(
      'SVG cannot preserve backdrop blur reliably. Export PNG or a .silk file instead.',
    )
  const bounds = boundsOf(nodes.map((n) => paintExtent(n))) ?? {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  }
  const lookup = new Map(page.nodes.map((n) => [n.id, n]))
  const definitions = nodes.map((n, i) => svgFilter(n, i)).join('')
  const shapes = nodes
    .map((n, i) => {
      const shared = `fill="${n.fill}" stroke="${n.stroke}" stroke-width="${n.strokeWidth}" opacity="${inheritedOpacity(n, lookup)}"${svgFilter(n, i) ? ` filter="url(#effect${i})"` : ''} style="mix-blend-mode:${n.blendMode}"`
      return shape(n, shared)
    })
    .join('')
  return `<svg style="isolation:isolate" xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><defs>${definitions}</defs>${shapes}</svg>`
}
export const documentSvg = (document: DesignDocument, selection: readonly string[]): string =>
  svgDocument(currentPage(document), selection)

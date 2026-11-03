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
const hasShadow = (n: Node): boolean => n.shadow.length !== 9 || n.shadow.slice(7) !== '00'
const extent = (n: Node) => {
  const stroke = n.strokeWidth / 2
  const blur = hasShadow(n) ? n.blur * 1.5 : 0
  const dx = hasShadow(n) ? n.shadowX : 0
  const dy = hasShadow(n) ? n.shadowY : 0
  const left = Math.max(stroke, blur - dx)
  const top = Math.max(stroke, blur - dy)
  return {
    x: n.x - left,
    y: n.y - top,
    width: n.width + left + Math.max(stroke, blur + dx),
    height: n.height + top + Math.max(stroke, blur + dy),
  }
}
const filter = (n: Node, id: number): string => {
  if (!hasShadow(n)) return ''
  const opacity = n.shadow.length === 9 ? Number.parseInt(n.shadow.slice(7), 16) / 255 : 1
  const b = extent(n)
  return `<filter id="shadow${id}" filterUnits="userSpaceOnUse" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" color-interpolation-filters="sRGB"><feDropShadow dx="${n.shadowX}" dy="${n.shadowY}" stdDeviation="${n.blur / 2}" flood-color="${n.shadow.slice(0, 7)}" flood-opacity="${opacity}"/></filter>`
}
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
  const bounds = boundsOf(nodes.map((n) => extent(n))) ?? { x: 0, y: 0, width: 800, height: 600 }
  const lookup = new Map(page.nodes.map((n) => [n.id, n]))
  const definitions = nodes.map((n, i) => filter(n, i)).join('')
  const shapes = nodes
    .map((n, i) => {
      const shared = `fill="${n.fill}" stroke="${n.stroke}" stroke-width="${n.strokeWidth}" opacity="${inheritedOpacity(n, lookup)}"${hasShadow(n) ? ` filter="url(#shadow${i})"` : ''}`
      return shape(n, shared)
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><defs>${definitions}</defs>${shapes}</svg>`
}
export const documentSvg = (document: DesignDocument, selection: readonly string[]): string =>
  svgDocument(currentPage(document), selection)

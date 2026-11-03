import { imageAssets, tweetSize } from './image-assets'
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
const shape = (n: Node, shared: string, index: number): string => {
  if (n.image) {
    const crop = n.imageCrop ?? { x: 0, y: 0, width: 1, height: 1 }
    return `<g ${shared}><g${n.radius > 0 ? ` clip-path="url(#image-clip${index})"` : ''}><svg x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" viewBox="${crop.x * tweetSize.width} ${crop.y * tweetSize.height} ${crop.width * tweetSize.width} ${crop.height * tweetSize.height}" preserveAspectRatio="none" overflow="hidden"><use href="#asset-${n.image}"/></svg></g></g>`
  }
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
      'SVG cannot preserve backdrop blur reliably. Export PNG or a .silkdesign file instead.',
    )
  const bounds = boundsOf(nodes.map((n) => paintExtent(n))) ?? {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  }
  const lookup = new Map(page.nodes.map((n) => [n.id, n]))
  const assets = [...new Set(nodes.flatMap((n) => (n.image ? [n.image] : [])))]
    .map(
      (name) =>
        `<image id="asset-${name}" width="${tweetSize.width}" height="${tweetSize.height}" href="${escapeXml(imageAssets[name])}"/>`,
    )
    .join('')
  const clips = nodes
    .map((n, i) =>
      n.image && n.radius > 0
        ? `<clipPath id="image-clip${i}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="${Math.min(n.radius, n.width / 2, n.height / 2)}"/></clipPath>`
        : '',
    )
    .join('')
  const definitions = assets + clips + nodes.map((n, i) => svgFilter(n, i)).join('')
  const shapes = nodes
    .map((n, i) => {
      const imageAlpha =
        n.image && n.fill.length === 9 ? Number.parseInt(n.fill.slice(7), 16) / 255 : 1
      const shared = `fill="${n.fill}" stroke="${n.stroke}" stroke-width="${n.strokeWidth}" opacity="${inheritedOpacity(n, lookup) * imageAlpha}"${svgFilter(n, i) ? ` filter="url(#effect${i})"` : ''} style="mix-blend-mode:${n.blendMode}"`
      return shape(n, shared, i)
    })
    .join('')
  return `<svg style="isolation:isolate" xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><defs>${definitions}</defs>${shapes}</svg>`
}
export const documentSvg = (document: DesignDocument, selection: readonly string[]): string =>
  svgDocument(currentPage(document), selection)

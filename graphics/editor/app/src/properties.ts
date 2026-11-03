import { Schema } from 'effect'
import { BlendModeSchema } from './document'
import { patchGeometry } from './property-geometry'
import { naturalText } from './text-layout'
import { currentPage, type Node } from './document'
import { transformSubtrees } from './selection-transform'
import { boundsOf, effectiveFlag } from './geometry'
import { type Model } from './model'
import { changeNodes, selectedNodes } from './state'

const numericProperty = (field: string, number: number): Partial<Node> => {
  switch (field) {
    case 'x':
    case 'y':
    case 'shadowX':
    case 'shadowY':
    case 'innerShadowX':
    case 'innerShadowY':
      return { [field]: Math.max(-1_000_000, Math.min(1_000_000, number)) }
    case 'width':
    case 'height':
      return { [field]: Math.max(0.1, Math.min(100_000, number)) }
    case 'radius':
      return { radius: Math.max(0, Math.min(50_000, number)) }
    case 'strokeWidth':
    case 'blur':
    case 'layerBlur':
    case 'backdropBlur':
    case 'innerBlur':
      return { [field]: Math.max(0, Math.min(1000, number)) }
    case 'brightness':
    case 'contrast':
    case 'saturation':
      return { [field]: Math.max(0, Math.min(4, number / 100)) }
    case 'opacity':
      return { opacity: Math.max(0, Math.min(1, number / 100)) }
    case 'fontSize':
      return { fontSize: Math.max(1, Math.min(512, number)) }
    default:
      return {}
  }
}
export const patch = (m: Model, field: string, value: string): Model => {
  const number = Number(value)
  let properties: Partial<Node> = {}
  if (field === 'name') properties = { name: value.slice(0, 160) }
  else if (field === 'blendMode' && Schema.is(BlendModeSchema)(value))
    properties = { blendMode: value }
  else if (field === 'text') properties = { text: value.replaceAll('\n', ' ').slice(0, 10_000) }
  else if (
    field === 'fill' ||
    field === 'stroke' ||
    field === 'shadow' ||
    field === 'innerShadow'
  ) {
    const normalized = value.startsWith('#') ? value : `#${value}`
    if (!/^#[\da-f]{6}([\da-f]{2})?$/iu.test(normalized))
      return { ...m, notice: 'Use a six- or eight-digit hex color.' }
    properties = { [field]: normalized }
  } else if (
    field === 'fontFamily' &&
    (value === 'Arial' || value === 'Georgia' || value === 'Courier New')
  )
    properties = { fontFamily: value }
  else if (
    field === 'fontWeight' &&
    (number === 400 || number === 500 || number === 600 || number === 700)
  )
    properties = { fontWeight: number }
  else if (Number.isFinite(number) && value.trim() !== '') {
    properties = numericProperty(field, number)
  } else return m
  return patchSelected(m, field, properties)
}
const patchSelected = (m: Model, field: string, properties: Partial<Node>): Model => {
  const nodes = currentPage(m.document).nodes
  const selection = selectedNodes(m).filter((n) => !effectiveFlag(n, nodes, 'locked'))
  const selected = new Set(selection.map((n) => n.id))
  if (
    (field === 'x' || field === 'y' || field === 'width' || field === 'height') &&
    properties[field] !== undefined
  )
    return patchGeometry(m, field, properties[field])
  return changeNodes(
    m,
    nodes.map((n) => {
      if (!selected.has(n.id)) return n
      if (n.image && ['strokeWidth', 'shadow', 'innerShadow'].includes(field)) return n
      if ((n.kind === 'ellipse' || n.kind === 'text') && ['strokeWidth', 'shadow'].includes(field))
        return n
      if (
        n.kind === 'group' &&
        [
          'layerBlur',
          'backdropBlur',
          'brightness',
          'contrast',
          'saturation',
          'blendMode',
          'innerShadow',
        ].includes(field)
      )
        return n
      if ((n.kind === 'text' || n.kind === 'ellipse') && field === 'innerShadow') return n
      if (n.kind === 'text' && field === 'backdropBlur') return n
      const changed = Object.assign({}, n, properties)
      return n.kind === 'text' && ['text', 'fontFamily', 'fontWeight', 'fontSize'].includes(field)
        ? naturalText(changed)
        : changed
    }),
  )
}

export const align = (m: Model, direction: string): Model => {
  const selection = selectedNodes(m).filter(
    (n) => !effectiveFlag(n, currentPage(m.document).nodes, 'locked'),
  )
  const bounds = boundsOf(selection)
  if (!bounds || selection.length < 2) return m
  const offsets = new Map<string, Readonly<{ dx: number; dy: number }>>()
  for (const n of selection) {
    let dx = 0
    let dy = 0
    switch (direction) {
      case 'left':
        dx = bounds.x - n.x
        break
      case 'center':
        dx = bounds.x + (bounds.width - n.width) / 2 - n.x
        break
      case 'right':
        dx = bounds.x + bounds.width - n.width - n.x
        break
      case 'top':
        dy = bounds.y - n.y
        break
      case 'middle':
        dy = bounds.y + (bounds.height - n.height) / 2 - n.y
        break
      case 'bottom':
        dy = bounds.y + bounds.height - n.height - n.y
        break
    }
    offsets.set(n.id, { dx, dy })
  }
  const nodes = transformSubtrees(currentPage(m.document).nodes, selection, (node, root) => {
    const offset = offsets.get(root.id)
    if (!offset || (offset.dx === 0 && offset.dy === 0)) return node
    return { ...node, x: node.x + offset.dx, y: node.y + offset.dy }
  })
  return changeNodes(m, nodes)
}

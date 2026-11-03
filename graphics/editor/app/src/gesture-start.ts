import { naturalText } from './text-layout'
import { currentPage, makeNode, replaceNodes } from './document'
import { contains, effectiveFlag, hitTest, worldPoint } from './geometry'
import { type Gesture, type Model, type Pointer } from './model'
import { idFor, duplicate, markChanged } from './state'

export const begin = (
  m: Model,
  point: Pointer,
  type: Gesture['type'],
  activeId: string | null = null,
): Gesture => ({
  type,
  start: { x: point.x, y: point.y },
  current: { x: point.x, y: point.y },
  camera: m.camera,
  before: m.document,
  source: m.document,
  selection: m.selection,
  handle: point.handle,
  activeId,
})
const createLayer = (
  m: Model,
  p: Pointer,
  tool: Exclude<Model['tool'], 'select' | 'hand'>,
): Model => {
  const world = worldPoint(p, m.camera)
  const nodes = currentPage(m.document).nodes

  const allocation = idFor(m.document)
  const frame = nodes.findLast(
    (n) =>
      n.kind === 'frame' &&
      !effectiveFlag(n, nodes, 'hidden') &&
      !effectiveFlag(n, nodes, 'locked') &&
      contains(n, world),
  )
  const draft = makeNode(allocation.id, tool, {
    ...world,
    width: 1,
    height: 1,
    parentId: tool === 'frame' ? null : (frame?.id ?? null),
    fill: tool === 'frame' ? '#ffffff' : '#b8c5ac',
    ...(tool === 'text' ? { width: 230, height: 52, fill: '#25352b' } : {}),
  })
  const node = tool === 'text' ? naturalText(draft) : draft
  const doc = replaceNodes({ ...m.document, nextId: allocation.nextId }, [...nodes, node])
  if (tool === 'text')
    return {
      ...markChanged(m, doc),
      selection: [node.id],
      tool: 'select',
      editingId: node.id,
      editingText: node.text,
    }
  return {
    ...m,
    document: doc,
    selection: [node.id],
    gesture: begin(m, p, 'draw', node.id),
    menu: 'none',
  }
}
export const down = (m: Model, p: Pointer): Model => {
  if (m.editingId !== null || !m.ready) return m
  if (p.button === 1 || p.space || m.tool === 'hand')
    return { ...m, gesture: begin(m, p, 'pan'), menu: 'none' }
  if (p.button !== 0) return m
  if (p.handle && m.selection.length > 0) return { ...m, gesture: begin(m, p, 'resize') }
  const world = worldPoint(p, m.camera)
  const nodes = currentPage(m.document).nodes
  if (m.tool !== 'select') return createLayer(m, p, m.tool)
  const hit = hitTest(nodes, world, p.meta)
  if (!hit)
    return {
      ...m,
      selection: p.shift ? m.selection : [],
      gesture: begin(m, p, 'marquee'),
      menu: 'none',
    }
  let selection = m.selection.includes(hit.id) ? m.selection : [hit.id]
  if (p.shift)
    selection = m.selection.includes(hit.id)
      ? m.selection.filter((id) => id !== hit.id)
      : [...m.selection, hit.id]
  let next = { ...m, selection, menu: 'none' as const }
  if (p.alt && selection.length > 0) {
    const copied = duplicate(next, undefined, 0)
    // The duplicate and its drag are one history entry at pointer release.
    next = { ...copied, past: m.past, future: m.future, revision: m.revision, menu: 'none' }
  }
  return {
    ...next,
    gesture: {
      ...begin(next, p, 'move'),
      before: p.alt ? m.document : next.document,
      selection: m.selection,
    },
  }
}

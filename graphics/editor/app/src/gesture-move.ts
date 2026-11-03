import { resizeBounds } from './resize'
import { marqueeSelection } from './marquee'
import { selectionRoots, selectionSet } from './hierarchy'
import { currentPage, descendants, replaceNodes, type Node } from './document'
import { boundsOf, effectiveFlag, round, worldPoint, type Bounds } from './geometry'
import { type Gesture, type Model, type Pointer } from './model'
import { groupBounds, markChanged } from './state'

export const snapMove = (
  m: Model,
  base: Bounds,
  dx: number,
  dy: number,
  ids: ReadonlySet<string>,
  disabled: boolean,
) => {
  let x = dx
  let y = dy
  let guideX: number | null = null
  let guideY: number | null = null
  if (!m.snap || disabled) return { x, y, guideX, guideY }
  const threshold = 5 / m.camera.zoom
  let bestX = threshold
  let bestY = threshold
  for (const n of currentPage(m.document).nodes) {
    if (ids.has(n.id) || effectiveFlag(n, currentPage(m.document).nodes, 'hidden')) continue
    for (const target of [n.x, n.x + n.width / 2, n.x + n.width])
      for (const source of [base.x, base.x + base.width / 2, base.x + base.width]) {
        const delta = target - source - dx
        if (Math.abs(delta) < bestX) {
          bestX = Math.abs(delta)
          x = dx + delta
          guideX = target
        }
      }
    for (const target of [n.y, n.y + n.height / 2, n.y + n.height])
      for (const source of [base.y, base.y + base.height / 2, base.y + base.height]) {
        const delta = target - source - dy
        if (Math.abs(delta) < bestY) {
          bestY = Math.abs(delta)
          y = dy + delta
          guideY = target
        }
      }
  }
  return { x, y, guideX, guideY }
}
const marqueeMove = (m: Model, p: Pointer, g: Gesture, dx: number, dy: number): Model => {
  const start = worldPoint(g.start, g.camera)
  const end = worldPoint(p, g.camera)

  const area = {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(dx),
    height: Math.abs(dy),
  }
  const nodes = currentPage(m.document).nodes
  return { ...m, gesture: g, selection: marqueeSelection(nodes, area, p.shift ? g.selection : []) }
}
const drawMove = (m: Model, p: Pointer, g: Gesture, dx: number, dy: number): Model => {
  const start = worldPoint(g.start, g.camera)

  if (p.shift) {
    const size = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * size
    dy = Math.sign(dy || 1) * size
  }
  const nodes = currentPage(m.document).nodes.map((n) =>
    n.id === g.activeId
      ? Object.assign({}, n, {
          x: Math.min(start.x, start.x + dx),
          y: Math.min(start.y, start.y + dy),
          width: Math.max(1, Math.abs(dx)),
          height: Math.max(1, Math.abs(dy)),
        })
      : n,
  )
  return { ...m, gesture: g, document: replaceNodes(m.document, nodes) }
}
const resizeNodes = (
  m: Model,
  p: Pointer,
  g: Gesture,
  b: Bounds,
  dx: number,
  dy: number,
  originals: readonly Node[],
  chosen: readonly Node[],
  ids: ReadonlySet<string>,
): readonly Node[] => {
  const { x, y, width, height } = resizeBounds(b, g.handle, dx, dy, p.shift)
  const frames = chosen.filter((n) => n.kind === 'frame' && selectionSet(m.selection).has(n.id))
  const retained = new Set(
    descendants(
      originals,
      frames.map((n) => n.id),
    ).map((n) => n.id),
  )
  return originals.map((n) => {
    if (!ids.has(n.id)) return n
    // Frame resizing changes its boundary; its contents keep their dimensions.
    if (!selectionSet(m.selection).has(n.id) && retained.has(n.id)) return n
    return Object.assign({}, n, {
      x: round(x + ((n.x - b.x) * width) / b.width),
      y: round(y + ((n.y - b.y) * height) / b.height),
      width: Math.max(0.1, round((n.width * width) / b.width)),
      height: Math.max(0.1, round((n.height * height) / b.height)),
    })
  })
}
const panMove = (m: Model, p: Pointer, gesture: Gesture): Model => {
  const g = gesture
  return {
    ...m,
    gesture,
    camera: {
      ...g.camera,
      x: g.camera.x - (p.x - g.start.x) / g.camera.zoom,
      y: g.camera.y - (p.y - g.start.y) / g.camera.zoom,
    },
  }
}
const isClickMotion = (m: Model, p: Pointer, g: Gesture): boolean =>
  g.type === 'move' && m.document === g.source && Math.hypot(p.x - g.start.x, p.y - g.start.y) < 3

export const move = (m: Model, p: Pointer): Model => {
  const g = m.gesture
  if (!g) return m
  const gesture = { ...g, current: { x: p.x, y: p.y } }
  if (isClickMotion(m, p, g)) return { ...m, gesture }
  if (g.type === 'pan') return panMove(m, p, gesture)
  const start = worldPoint(g.start, g.camera)
  const end = worldPoint(p, g.camera)
  let dx = end.x - start.x
  let dy = end.y - start.y
  if (g.type === 'marquee') return marqueeMove(m, p, gesture, dx, dy)
  if (g.type === 'draw') return drawMove(m, p, gesture, dx, dy)
  const originals = currentPage(g.source).nodes
  const roots = selectionRoots(originals, m.selection).filter(
    (n) => !effectiveFlag(n, originals, 'locked'),
  )
  const chosen = descendants(
    originals,
    roots.map((n) => n.id),
  )
  const ids = new Set(chosen.map((n) => n.id))
  const b = boundsOf(roots)
  if (!b) return m
  let transformed: readonly Node[]
  let guideX: number | null = null
  let guideY: number | null = null
  if (g.type === 'move') {
    if (p.shift) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0
      else dx = 0
    }
    const snapped = snapMove(m, b, dx, dy, ids, p.alt)
    guideX = snapped.guideX
    guideY = snapped.guideY
    transformed = originals.map((n) =>
      ids.has(n.id) ? { ...n, x: round(n.x + snapped.x), y: round(n.y + snapped.y) } : n,
    )
  } else transformed = resizeNodes(m, p, g, b, dx, dy, originals, chosen, ids)

  return {
    ...m,
    gesture,
    guideX,
    guideY,
    document: replaceNodes(m.document, groupBounds(transformed)),
  }
}
export const finish = (m: Model): Model => {
  const g = m.gesture
  if (!g) return m
  let next = { ...m, gesture: null, guideX: null, guideY: null }
  if (g.type === 'draw') {
    const nodes = currentPage(m.document).nodes.map((n) =>
      n.id === g.activeId && n.width < 3 && n.height < 3
        ? Object.assign({}, n, {
            width: 160,
            height: 120,
          })
        : n,
    )
    next = { ...next, document: replaceNodes(m.document, nodes), tool: 'select' }
  }
  if (g.type === 'pan' || g.type === 'marquee') return next
  if (sameGestureDocument(next.document, g.before)) return { ...next, document: g.before }
  return markChanged(next, next.document, g.before)
}

// A gesture edits one page and preserves nested property references. Compare only
// changed node snapshots; never allocate serialized copies of every page on click.
const sameGestureDocument = (after: Model['document'], before: Model['document']): boolean => {
  if (after === before) return true
  if (
    after.id !== before.id ||
    after.name !== before.name ||
    after.activePageId !== before.activePageId ||
    after.nextId !== before.nextId ||
    after.pages.length !== before.pages.length
  )
    return false
  return after.pages.every((page, index) => {
    const original = before.pages[index]
    if (page === original) return true
    if (
      !original ||
      page.id !== original.id ||
      page.name !== original.name ||
      page.nodes.length !== original.nodes.length
    )
      return false
    return page.nodes.every((node, i) => {
      const prior = original.nodes[i]
      return node === prior || (prior !== undefined && sameSnapshot(node, prior))
    })
  })
}

const sameSnapshot = (
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean => Object.keys(left).every((key) => left[key] === right[key])

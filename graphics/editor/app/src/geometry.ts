import { nodeIndex, paintOrder } from './hierarchy'
import type { Camera, Node } from './document'

export interface Point {
  readonly x: number
  readonly y: number
}
export interface Bounds extends Point {
  readonly width: number
  readonly height: number
}
export const boundsOf = (nodes: readonly Bounds[]): Bounds | null => {
  if (nodes.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const n of nodes) {
    left = Math.min(left, n.x)
    top = Math.min(top, n.y)
    right = Math.max(right, n.x + n.width)
    bottom = Math.max(bottom, n.y + n.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}
export const worldPoint = (p: Point, camera: Camera): Point => ({
  x: p.x / camera.zoom + camera.x,
  y: p.y / camera.zoom + camera.y,
})
export const screenBounds = (b: Bounds, camera: Camera): Bounds => ({
  x: (b.x - camera.x) * camera.zoom,
  y: (b.y - camera.y) * camera.zoom,
  width: b.width * camera.zoom,
  height: b.height * camera.zoom,
})
export const intersects = (a: Bounds, b: Bounds): boolean =>
  a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
export const contains = (b: Bounds, p: Point): boolean =>
  p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height
export const zoomAt = (camera: Camera, point: Point, zoom: number): Camera => {
  const world = worldPoint(point, camera)
  const next = Math.min(64, Math.max(0.02, zoom))
  return { zoom: next, x: world.x - point.x / next, y: world.y - point.y / next }
}
export const fit = (bounds: Bounds | null, width: number, height: number): Camera => {
  if (!bounds) return { x: -width / 2, y: -height / 2, zoom: 1 }
  const zoom = Math.max(
    0.02,
    Math.min(
      2,
      (width - 120) / Math.max(bounds.width, 1),
      (height - 160) / Math.max(bounds.height, 1),
    ),
  )
  return {
    zoom,
    x: bounds.x + bounds.width / 2 - width / (2 * zoom),
    y: bounds.y + bounds.height / 2 - height / (2 * zoom),
  }
}
export const effectiveFlag = (
  node: Node,
  nodes: readonly Node[],
  flag: 'hidden' | 'locked',
): boolean => {
  if (node.parentId === null) return node[flag]
  const lookup = nodeIndex(nodes)
  let n: Node | undefined = node
  const visited = new Set<string>()
  while (n && !visited.has(n.id)) {
    if (n[flag]) return true
    visited.add(n.id)
    const parentId: string | null = n.parentId
    n = parentId === null ? undefined : lookup.get(parentId)
  }
  return false
}
export const hitTest = (nodes: readonly Node[], point: Point, deep = false): Node | undefined => {
  const ordered = paintOrder(nodes)
  for (let i = ordered.length - 1; i >= 0; i--) {
    const node = ordered[i]
    if (
      !node ||
      node.kind === 'group' ||
      effectiveFlag(node, nodes, 'hidden') ||
      effectiveFlag(node, nodes, 'locked') ||
      !contains(node, point)
    )
      continue
    if (node.kind === 'ellipse') {
      const x = ((point.x - node.x) / node.width) * 2 - 1
      const y = ((point.y - node.y) / node.height) * 2 - 1
      if (x * x + y * y > 1) continue
    }
    if (deep) return node
    let selected = node
    let parent = nodes.find((n) => n.id === selected.parentId)
    while (parent?.kind === 'group') {
      selected = parent
      const parentId = selected.parentId
      parent = nodes.find((n) => n.id === parentId)
    }
    return selected
  }
  return undefined
}
export const round = (value: number): number => Math.round(value * 100) / 100

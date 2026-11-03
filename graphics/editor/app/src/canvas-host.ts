import { paintOrder, inheritedOpacity, nodeIndex } from './hierarchy'
import { Editor, type ElementProperties, type HexColor } from '../../dist/editor.js'
import { descendants, type Camera, type Page, type Node } from './document'
import { effectiveFlag } from './geometry'

const alpha = (color: string, opacity: number): HexColor => {
  const a = color.length === 9 ? Number.parseInt(color.slice(7), 16) : 255
  return `#${color.slice(1, 7)}${Math.round(a * opacity)
    .toString(16)
    .padStart(2, '0')}`
}
const properties = (n: Node, nodes: readonly Node[], opacity: number): ElementProperties => ({
  type: n.kind === 'frame' || n.kind === 'group' ? 'rect' : n.kind,
  name: n.name,
  x: n.x,
  y: n.y,
  width: n.width,
  height: n.height,
  radius: n.radius,
  fill: alpha(n.fill, opacity),
  border: alpha(n.stroke, opacity),
  borderWidth: n.strokeWidth,
  shadow: alpha(n.shadow, opacity),
  blur: n.blur,
  shadowX: n.shadowX,
  shadowY: n.shadowY,
  hidden: effectiveFlag(n, nodes, 'hidden'),
  locked: effectiveFlag(n, nodes, 'locked'),
  text: n.text,
  fontSize: n.fontSize,
  fontFamily: n.fontFamily,
  fontWeight: n.fontWeight,
})
const sameStructure = (before: Page, after: Page): boolean =>
  before.id === after.id &&
  before.nodes.length === after.nodes.length &&
  after.nodes.every((node, i) => {
    const previous = before.nodes[i]
    return (
      previous?.id === node.id &&
      previous.parentId === node.parentId &&
      (previous.kind === 'group') === (node.kind === 'group')
    )
  })
const inheritedChanges = (before: Page, after: Page): ReadonlySet<string> => {
  const changed = after.nodes
    .filter((node, i) => {
      const previous = before.nodes[i]
      return (
        (node.kind === 'group' || node.kind === 'frame') &&
        previous !== node &&
        (previous?.hidden !== node.hidden ||
          previous.locked !== node.locked ||
          previous.opacity !== node.opacity)
      )
    })
    .map((node) => node.id)
  return new Set(changed.length > 0 ? descendants(after.nodes, changed).map((node) => node.id) : [])
}
const nodeProperties = (node: Node, nodes: readonly Node[]): ElementProperties =>
  properties(
    node,
    nodes,
    node.parentId === null ? node.opacity : inheritedOpacity(node, nodeIndex(nodes)),
  )

export class CanvasHost {
  readonly editor: Editor
  private page: Page | null = null
  private ids = new Map<string, number>()
  constructor(editor: Editor) {
    this.editor = editor
  }
  sync(page: Page, camera: Camera): void {
    this.editor.setViewport(camera)
    const previous = this.page
    if (page === previous) return
    if (!previous || !sameStructure(previous, page)) this.replaceScene(page)
    else if (page.nodes !== previous.nodes) {
      const inherited = inheritedChanges(previous, page)
      this.editor.batch(() => {
        page.nodes.forEach((node, i) => {
          if (node.kind === 'group' || (node === previous.nodes[i] && !inherited.has(node.id)))
            return
          const id = this.ids.get(node.id)
          if (id !== undefined) this.editor.update(id, nodeProperties(node, page.nodes))
        })
      })
    }
    this.editor.clearHistory()
    this.page = page
  }
  private replaceScene(page: Page): void {
    const drawable = paintOrder(page.nodes).filter((node) => node.kind !== 'group')
    this.editor.load({
      version: 1,
      elements: drawable.map((node) => nodeProperties(node, page.nodes)),
    })
    const snapshots = this.editor.elements()
    this.ids.clear()
    for (const node of drawable) {
      const native = snapshots.next()
      if (native.done !== true) this.ids.set(node.id, native.value.id)
    }
  }
  destroy(): void {
    this.editor.destroy()
  }
}

import { paintOrder, inheritedOpacity } from './hierarchy'
import { Editor, type ElementProperties, type HexColor } from '../../dist/editor.js'
import type { Camera, Page, Node } from './document'
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
export class CanvasHost {
  readonly editor: Editor
  private page: Page | null = null
  private ids = new Map<string, number>()
  private previous = new Map<string, string>()
  constructor(editor: Editor) {
    this.editor = editor
  }
  sync(page: Page, camera: Camera): void {
    this.editor.setViewport(camera)
    if (page !== this.page) {
      const lookup = new Map(page.nodes.map((n) => [n.id, n]))
      const drawable = paintOrder(page.nodes).filter((n) => n.kind !== 'group')
      const order = drawable.map((n) => n.id)
      const previousOrder = [...this.ids.keys()]
      const sameOrder =
        order.length === previousOrder.length && order.every((id, i) => previousOrder[i] === id)
      if (!sameOrder || page.id !== this.page?.id) {
        this.replaceScene(drawable, page.nodes, lookup)
      }
      this.editor.batch(() => {
        for (const n of drawable) {
          const props = properties(n, page.nodes, inheritedOpacity(n, lookup))
          const serialized = JSON.stringify(props)
          const id = this.ids.get(n.id)
          if (id !== undefined && this.previous.get(n.id) !== serialized)
            this.editor.update(id, props)
          this.previous.set(n.id, serialized)
        }
      })
      this.editor.clearHistory()
      this.page = page
    }
  }
  private replaceScene(
    drawable: readonly Node[],
    nodes: readonly Node[],
    lookup: ReadonlyMap<string, Node>,
  ): void {
    const elements = drawable.map((n) => properties(n, nodes, inheritedOpacity(n, lookup)))
    this.editor.load({ version: 1, elements })
    const snapshots = [...this.editor.elements()]
    this.ids.clear()
    this.previous.clear()
    drawable.forEach((n, i) => {
      const native = snapshots[i]
      const props = elements[i]
      if (native && props) {
        this.ids.set(n.id, native.id)
        this.previous.set(n.id, JSON.stringify(props))
      }
    })
  }
  destroy(): void {
    this.editor.destroy()
  }
}

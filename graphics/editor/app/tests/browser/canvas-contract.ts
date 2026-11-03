import { Editor, type ElementProperties } from '../../../dist/editor.js'
import wasm from '../../../dist/editor.wasm?url'
import { CanvasHost } from '../../src/canvas-host'
import { makeNode } from '../../src/document'

export const run = async () => {
  const canvas = document.createElement('canvas')
  canvas.style.width = '300px'
  canvas.style.height = '200px'
  document.body.append(canvas)
  const editor = await Editor.create({ canvas, wasm, autoRender: false })
  const host = new CanvasHost(editor)
  const camera = { x: 0, y: 0, zoom: 1 }
  const parent = makeNode('g', 'group')
  const child = makeNode('a', 'rect', { parentId: 'g', name: 'Child', fill: '#ff0000' })
  const other = makeNode('b', 'rect', { name: 'Other' })
  const page = { id: 'p', name: 'Page', nodes: [parent, child, other] }
  let updates = 0
  const update = editor.update.bind(editor)
  editor.update = (id, patch: Readonly<ElementProperties>) => {
    updates++
    update(id, patch)
  }
  try {
    host.sync(page, camera)
    host.sync({ ...page, nodes: [...page.nodes] }, camera)
    const unchangedUpdates = updates
    const changed = { ...page, nodes: [parent, child, { ...other, x: 50 }] }
    host.sync(changed, camera)
    const singleUpdates = updates - unchangedUpdates
    host.sync(
      {
        ...changed,
        nodes: [{ ...parent, opacity: 0.5, hidden: true, locked: true }, child, changed.nodes[2]!],
      },
      camera,
    )
    const inherited = [...editor.elements()][0]
    host.sync(page, camera)
    const undone = [...editor.elements()][0]
    host.sync({ ...page, nodes: [other, parent, child] }, camera)
    const reordered = [...editor.elements()].map((node) => node.name)
    host.sync({ ...page, nodes: [other] }, camera)
    await editor.flush()
    return { unchangedUpdates, singleUpdates, inherited, undone, reordered, remaining: editor.size }
  } finally {
    host.destroy()
    canvas.remove()
  }
}

import { Editor } from '../../dist/editor.js'
import wasm from '../../dist/editor.wasm?url'
import { CanvasHost } from './canvas-host'
import { descendants, type Page, type Node } from './document'
import { boundsOf, effectiveFlag } from './geometry'
import { inheritedOpacity, nodeIndex, paintOrder } from './hierarchy'
import { paintExtent } from './svg-effects'

const png = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('PNG encoding failed.'))
    }, 'image/png')
  })
export const rasterExport = async (page: Page, selection: readonly string[]): Promise<Blob> => {
  const ids = new Set(descendants(page.nodes, selection).map((node) => node.id))
  const lookup = nodeIndex(page.nodes)
  const nodes: readonly Node[] = paintOrder(page.nodes)
    .filter(
      (node) =>
        node.kind !== 'group' &&
        !effectiveFlag(node, page.nodes, 'hidden') &&
        (selection.length === 0 || ids.has(node.id)),
    )
    .map((node) =>
      Object.assign({}, node, { parentId: null, opacity: inheritedOpacity(node, lookup) }),
    )
  const bounds = boundsOf(nodes.map((node) => paintExtent(node))) ?? {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  }
  const scale = Math.min(2, 4096 / Math.max(bounds.width, bounds.height))
  if (scale < 0.02)
    throw new Error(
      'This selection is too large to export with GPU effects. Export a smaller selection.',
    )
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(bounds.width * scale))
  canvas.height = Math.max(1, Math.ceil(bounds.height * scale))
  const editor = await Editor.create({
    canvas,
    wasm,
    autoRender: false,
    pixelRatio: 1,
    background: '#00000000',
  })
  const host = new CanvasHost(editor)
  try {
    editor.resize(canvas.width, canvas.height, 1)
    host.sync({ ...page, nodes }, { x: bounds.x, y: bounds.y, zoom: scale })
    editor.render()
    return await capturePng(canvas)
  } finally {
    host.destroy()
  }
}

const capturePng = (canvas: HTMLCanvasElement): Promise<Blob> => {
  // Capture before awaiting: WebGPU may recycle its presented canvas texture at a frame boundary.
  const copy = document.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  const context = copy.getContext('2d')
  if (!context) throw new Error('PNG export is unavailable.')
  context.drawImage(canvas, 0, 0)
  return png(copy)
}

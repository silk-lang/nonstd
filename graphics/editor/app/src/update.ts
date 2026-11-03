import { currentPage } from './document'
import { boundsOf, effectiveFlag, fit, hitTest, worldPoint, zoomAt } from './geometry'
import { Messages, type Message, type Model } from './model'
import { initialModel, frameCenter, markChanged, changeNodes } from './state'
import { down } from './gesture-start'
import { move, finish } from './gesture-move'
import { patch } from './properties'
import { action } from './actions'
import { key } from './keys'

type Transitions = {
  [K in Message['_tag']]: (message: Extract<Message, { _tag: K }>) => (m: Model) => Model
}
const transitions: Transitions = {
  Draft: (message) => (m) => ({ ...m, drafts: { ...m.drafts, [message.field]: message.value } }),
  RestoreEmpty: () => (m) => ({ ...m, revision: m.revision + 1 }),
  Ready: () => (m) => {
    return { ...m, ready: true }
  },
  Failed: (message) => (m) => {
    return { ...m, error: message.reason }
  },
  Synced: () => (m) => {
    return m
  },
  Saved: (message) => (m) => {
    return message.documentId === m.document.id
      ? { ...m, savedRevision: Math.max(m.savedRevision, message.revision) }
      : m
  },
  Loaded: (message) => (m) => {
    return {
      ...initialModel(message.document),
      clipboard: m.clipboard,
      ready: m.ready,
      width: m.width,
      height: m.height,
      recent: m.recent,
      camera: fit(boundsOf(currentPage(message.document).nodes), m.width, m.height),
    }
  },
  ListedDocuments: (message) => (m) => {
    return { ...m, recent: message.recent }
  },
  Resized: (message) => (m) => {
    return {
      ...m,
      width: message.width,
      height: message.height,
      camera: m.ready
        ? m.camera
        : fit(boundsOf(currentPage(m.document).nodes), message.width, message.height),
    }
  },
  ChooseTool: (message) => (m) => {
    return { ...m, tool: message.tool, editingId: null, menu: 'none' }
  },
  PointerDown: (message) => (m) => {
    return down(m, message.point)
  },
  PointerMove: (message) => (m) => {
    return move(m, message.point)
  },
  PointerUp: (message) => (m) => {
    return finish(m.gesture ? move(m, message.point) : m)
  },
  CancelGesture: () => (m) => {
    return m.gesture
      ? {
          ...m,
          document: m.gesture.before,
          selection: m.gesture.selection,
          gesture: null,
          guideX: null,
          guideY: null,
        }
      : m
  },
  DoubleClick: (message) => (m) => {
    const n = hitTest(currentPage(m.document).nodes, worldPoint(message.point, m.camera), true)
    if (n?.kind === 'text')
      return { ...m, selection: [n.id], editingId: n.id, editingText: n.text, gesture: null }
    return n ? { ...m, selection: [n.id] } : m
  },
  Wheel: (message) => (m) => {
    return {
      ...m,
      camera: message.zoom
        ? zoomAt(m.camera, message, m.camera.zoom * Math.exp(-message.deltaY * 0.0023))
        : {
            ...m.camera,
            x: m.camera.x + message.deltaX / m.camera.zoom,
            y: m.camera.y + message.deltaY / m.camera.zoom,
          },
    }
  },
  SelectLayer: (message) => (m) => {
    if (!message.extend) return { ...m, selection: [message.id] }
    const selection = m.selection.includes(message.id)
      ? m.selection.filter((id) => id !== message.id)
      : [...m.selection, message.id]
    return { ...m, selection }
  },
  ToggleLayer: (message) => (m) => {
    const next = changeNodes(
      m,
      currentPage(m.document).nodes.map((n) =>
        n.id === message.id ? Object.assign({}, n, { [message.flag]: !n[message.flag] }) : n,
      ),
    )
    const nodes = currentPage(next.document).nodes
    return {
      ...next,
      selection: next.selection.filter((id) => {
        const node = nodes.find((n) => n.id === id)
        return (
          node !== undefined &&
          !effectiveFlag(node, nodes, 'hidden') &&
          !effectiveFlag(node, nodes, 'locked')
        )
      }),
    }
  },
  Collapse: (message) => (m) => {
    return {
      ...m,
      collapsed: m.collapsed.includes(message.id)
        ? m.collapsed.filter((id) => id !== message.id)
        : [...m.collapsed, message.id],
    }
  },
  Patch: (message) => (m) => {
    return patch(m, message.field, message.value)
  },
  RenameDocument: (message) => (m) => {
    return message.value.trim()
      ? markChanged(m, { ...m.document, name: message.value.trim().slice(0, 160) })
      : m
  },
  RenamePage: (message) => (m) => {
    return message.value.trim()
      ? markChanged(m, {
          ...m.document,
          pages: m.document.pages.map((p) =>
            p.id === m.document.activePageId
              ? { ...p, name: message.value.trim().slice(0, 100) }
              : p,
          ),
        })
      : m
  },
  SelectPage: (message) => (m) => {
    const page = m.document.pages.find((p) => p.id === message.id)
    return page
      ? {
          ...m,
          document: { ...m.document, activePageId: page.id },
          revision: m.revision + 1,
          layerScroll: 0,
          selection: [],
          camera: fit(boundsOf(page.nodes), m.width, m.height),
          editingId: null,
        }
      : m
  },
  LayerScroll: (message) => (m) => {
    return { ...m, layerScroll: message.top }
  },
  ZoomPercent: (message) => (m) => {
    return { ...m, camera: zoomAt(m.camera, frameCenter(m), message.value / 100) }
  },
  Search: (message) => (m) => {
    return { ...m, search: message.value, layerScroll: 0 }
  },
  CommandQuery: (message) => (m) => {
    return { ...m, commandQuery: message.value }
  },
  Action: (message) => (m) => {
    return action(m, message.action)
  },
  EditText: (message) => (m) => {
    return { ...m, editingText: message.value }
  },
  CommitText: () => (m) => {
    return m.editingId === null
      ? m
      : { ...patch({ ...m, selection: [m.editingId] }, 'text', m.editingText), editingId: null }
  },
  CancelText: () => (m) => {
    return { ...m, editingId: null }
  },
  Key: (message) => (m) => {
    return key(m, message)
  },
  OpenDocument: () => (m) => {
    return { ...m, menu: 'none' }
  },
}
const commitsDraft = new Set<Message['_tag']>([
  'Patch',
  'RenameDocument',
  'RenamePage',
  'ZoomPercent',
  'SelectLayer',
  'ChooseTool',
  'SelectPage',
  'Loaded',
])
export const reduce = (m: Model, message: Message): Model => {
  const next = Messages.match<(m: Model) => Model>(message, transitions)(m)
  return commitsDraft.has(message._tag) ? { ...next, drafts: {} } : next
}

export { initialModel, selectedNodes } from './state'

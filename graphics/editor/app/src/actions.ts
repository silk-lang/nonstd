import { nodeIndex } from './hierarchy'
import { addSelectionPage } from './selection-page'
import { currentPage, makeNode, replaceNodes } from './document'
import { boundsOf, effectiveFlag, fit, zoomAt } from './geometry'
import { type Model } from './model'
import {
  selectedNodes,
  frameCenter,
  markChanged,
  idFor,
  changeNodes,
  mutableSelection,
  selectedIds,
  duplicate,
} from './state'
import { align } from './properties'

const handlers: Readonly<Record<string, (m: Model) => Model>> = {
  'selection-page': addSelectionPage,
  undo: (m) => {
    const previous = m.past.at(-1)
    return previous
      ? {
          ...m,
          document: previous,
          past: m.past.slice(0, -1),
          future: [...m.future, m.document],
          selection: m.selection.filter((id) => nodeIndex(currentPage(previous).nodes).has(id)),
          revision: m.revision + 1,
          editingId: null,
          gesture: null,
        }
      : m
  },
  redo: (m) => {
    const next = m.future.at(-1)
    return next
      ? {
          ...m,
          document: next,
          past: [...m.past, m.document],
          future: m.future.slice(0, -1),
          selection: m.selection.filter((id) => nodeIndex(currentPage(next).nodes).has(id)),
          revision: m.revision + 1,
          editingId: null,
        }
      : m
  },
  delete: (m) => {
    const nodes = currentPage(m.document).nodes
    const ids = selectedIds(m)
    return {
      ...changeNodes(
        m,
        nodes.filter((n) => !ids.has(n.id)),
      ),
      selection: [],
    }
  },
  duplicate: (m) => {
    return duplicate(m)
  },
  copy: (m) => {
    return { ...m, clipboard: mutableSelection(m), notice: 'Layers copied. Paste with ⌘/Ctrl V.' }
  },
  cut: (m) => {
    return action({ ...m, clipboard: mutableSelection(m) }, 'delete')
  },
  paste: (m) => {
    const copied = new Set(m.clipboard.map((n) => n.id))
    return duplicate(
      m,
      m.clipboard.map((n) =>
        Object.assign({}, n, {
          parentId: n.parentId !== null && copied.has(n.parentId) ? n.parentId : null,
        }),
      ),
    )
  },
  'select-all': (m) => {
    const nodes = currentPage(m.document).nodes
    return {
      ...m,
      selection: nodes
        .filter(
          (n) =>
            !effectiveFlag(n, nodes, 'hidden') &&
            !effectiveFlag(n, nodes, 'locked') &&
            n.parentId === null,
        )
        .map((n) => n.id),
    }
  },
  front: (m) => {
    const nodes = currentPage(m.document).nodes
    const ids = selectedIds(m)
    const selected = nodes.filter((n) => ids.has(n.id))
    const others = nodes.filter((n) => !ids.has(n.id))
    return changeNodes(m, [...others, ...selected])
  },
  back: (m) => {
    const nodes = currentPage(m.document).nodes
    const ids = selectedIds(m)
    const selected = nodes.filter((n) => ids.has(n.id))
    const others = nodes.filter((n) => !ids.has(n.id))
    return changeNodes(m, [...selected, ...others])
  },
  group: (m) => {
    const nodes = currentPage(m.document).nodes
    const selection = selectedNodes(m)
    const b = boundsOf(selection)
    if (selection.length < 2 || !b) return m
    const allocation = idFor(m.document)
    const parentId = selection.every((n) => n.parentId === selection[0]?.parentId)
      ? (selection[0]?.parentId ?? null)
      : null
    const group = makeNode(allocation.id, 'group', { ...b, name: 'Group', parentId })
    const grouped = new Set(selection.map((n) => n.id))
    return {
      ...markChanged(
        m,
        replaceNodes({ ...m.document, nextId: allocation.nextId }, [
          ...nodes.map((n) =>
            grouped.has(n.id) ? Object.assign({}, n, { parentId: group.id }) : n,
          ),
          group,
        ]),
      ),
      selection: [group.id],
    }
  },
  ungroup: (m) => {
    const nodes = currentPage(m.document).nodes
    const groups = selectedNodes(m).filter((n) => n.kind === 'group')
    const ids = new Set(groups.map((n) => n.id))
    const children = nodes.filter((n) => n.parentId !== null && ids.has(n.parentId))
    return {
      ...changeNodes(
        m,
        nodes
          .filter((n) => !ids.has(n.id))
          .map((n) =>
            n.parentId !== null && ids.has(n.parentId)
              ? Object.assign({}, n, {
                  parentId: groups.find((g) => g.id === n.parentId)?.parentId ?? null,
                })
              : n,
          ),
      ),
      selection: children.map((n) => n.id),
    }
  },
  'zoom-in': (m) => {
    return { ...m, camera: zoomAt(m.camera, frameCenter(m), m.camera.zoom * 1.2) }
  },
  'zoom-out': (m) => {
    return { ...m, camera: zoomAt(m.camera, frameCenter(m), m.camera.zoom / 1.2) }
  },
  'zoom-100': (m) => {
    return { ...m, camera: zoomAt(m.camera, frameCenter(m), 1) }
  },
  fit: (m) => {
    const nodes = currentPage(m.document).nodes
    return { ...m, camera: fit(boundsOf(nodes.filter((n) => !n.hidden)), m.width, m.height) }
  },
  'fit-selection': (m) => {
    return { ...m, camera: fit(boundsOf(selectedNodes(m)), m.width, m.height) }
  },
  grid: (m) => {
    return { ...m, grid: !m.grid }
  },
  snap: (m) => {
    return { ...m, snap: !m.snap }
  },
  panels: (m) => {
    return { ...m, panels: !m.panels }
  },
  file: (m) => {
    return { ...m, menu: m.menu === 'file' ? 'none' : 'file', commandQuery: '' }
  },
  commands: (m) => {
    return { ...m, menu: m.menu === 'commands' ? 'none' : 'commands', commandQuery: '' }
  },
  shortcuts: (m) => {
    return { ...m, menu: m.menu === 'shortcuts' ? 'none' : 'shortcuts', commandQuery: '' }
  },
  documents: (m) => {
    return { ...m, menu: m.menu === 'documents' ? 'none' : 'documents', commandQuery: '' }
  },
  dismiss: (m) => {
    return { ...m, menu: 'none', error: null, notice: '' }
  },
  'new-page': (m) => {
    const allocation = idFor(m.document)
    const page = { id: allocation.id, name: `Page ${m.document.pages.length + 1}`, nodes: [] }
    return {
      ...markChanged(m, {
        ...m.document,
        nextId: allocation.nextId,
        pages: [...m.document.pages, page],
        activePageId: page.id,
      }),
      selection: [],
      camera: fit(null, m.width, m.height),
    }
  },
  'delete-page': (m) => {
    if (m.document.pages.length < 2)
      return { ...m, notice: 'Keep at least one page in a document.' }
    const pages = m.document.pages.filter((p) => p.id !== m.document.activePageId)
    const first = pages[0]
    if (!first) return m
    return {
      ...markChanged(m, { ...m.document, pages, activePageId: first.id }),
      selection: [],
      camera: fit(boundsOf(first.nodes), m.width, m.height),
    }
  },
}
export const action = (m: Model, name: string): Model => {
  const next = name.startsWith('align-') ? align(m, name.slice(6)) : (handlers[name]?.(m) ?? m)
  return m.menu === 'commands' && name !== 'commands' ? { ...next, menu: 'none' } : next
}

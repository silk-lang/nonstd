import type { Html } from 'foldkit/html'
import { currentPage, type Node } from '../document'
import { icon } from '../icons'
import { Messages, type Model } from '../model'
import { empty, label, button, type H } from './common'
import { layerRows, type LayerRow } from './layer-tree'
import { LayerClick } from './mounts'

const pageList = (m: Model, h: H): Html =>
  h.div(
    [h.Class('pages-section')],
    [
      h.div(
        [h.Class('flex justify-between items-center mb-2')],
        [label(h, 'Pages'), button(h, 'plus', 'Add page', 'new-page')],
      ),
      ...m.document.pages.map((p) =>
        h.button(
          [
            h.Key(p.id),
            h.Class(`page-row ${p.id === m.document.activePageId ? 'selected-page' : ''}`),
            h.OnClick(Messages.SelectPage({ id: p.id })),
          ],
          [
            icon(h, 'file', 14),
            h.span([h.Class('truncate')], [p.name]),
            p.id === m.document.activePageId ? icon(h, 'check', 13) : empty(h),
          ],
        ),
      ),
    ],
  )
const collapse = (m: Model, h: H, n: Node): Html => {
  if (n.kind !== 'frame' && n.kind !== 'group') return h.span([h.Class('w-3 shrink-0')], [])
  return h.button(
    [
      h.Class(`collapse-button ${m.collapsed.includes(n.id) ? '' : 'expanded'}`),
      h.AriaLabel(`Toggle ${n.name} children`),
      h.OnClick(Messages.Collapse({ id: n.id })),
    ],
    [icon(h, 'chevron', 10)],
  )
}
const flagButton = (h: H, n: Node, flag: 'hidden' | 'locked'): Html => {
  const names = flag === 'hidden' ? ['Show', 'Hide'] : ['Unlock', 'Lock']
  const verb = n[flag] ? names[0] : names[1]
  return h.button(
    [
      h.Class(`layer-action ${n[flag] ? 'visible-action' : ''}`),
      h.AriaLabel(`${verb} ${n.name}`),
      h.OnClick(Messages.ToggleLayer({ id: n.id, flag })),
    ],
    [icon(h, flag === 'hidden' ? 'eye' : 'lock', 12)],
  )
}
const layerRow = (m: Model, h: H, row: LayerRow, index: number): Html => {
  const n = row.node
  return h.div(
    [
      h.Key(n.id),
      h.Class(
        `layer-row ${m.selection.includes(n.id) ? 'selected-layer' : ''} ${n.hidden ? 'hidden-layer' : ''}`,
      ),
      h.Style({ top: `${index * 32}px`, paddingLeft: `${8 + Math.min(row.depth, 6) * 12}px` }),
      h.Role('treeitem'),
      h.AriaSelected(m.selection.includes(n.id)),
      h.AriaLevel(row.depth + 1),
    ],
    [
      collapse(m, h, n),
      h.button(
        [
          h.Class('layer-select'),
          h.AriaLabel(`Select ${n.name}`),
          h.OnMount(LayerClick({ id: n.id })),
        ],
        [icon(h, n.kind, 14), h.span([h.Class('truncate')], [n.name])],
      ),
      flagButton(h, n, 'locked'),
      flagButton(h, n, 'hidden'),
    ],
  )
}
const noLayers = (m: Model, h: H): Html =>
  h.div(
    [h.Class('empty-layers')],
    [
      icon(h, 'rect', 25),
      h.p([], [m.search ? 'No matching layers' : 'A little room for an idea.']),
      h.p(
        [h.Class('text-[11px] text-stone-400')],
        [m.search ? 'Try another name or shape type.' : 'Choose a tool below and draw.'],
      ),
    ],
  )
const layers = (m: Model, h: H): Html => {
  const rows = layerRows(m)
  const first = Math.max(0, Math.floor(m.layerScroll / 32) - 5)
  return h.div(
    [
      h.Class('layer-list'),
      h.Role('tree'),
      h.AriaLabel('Layers'),
      h.OnScroll((top) => Messages.LayerScroll({ top })),
    ],
    [
      h.div(
        [h.Style({ height: `${rows.length * 32}px`, position: 'relative' })],
        rows.slice(first, first + 55).map((row, i) => layerRow(m, h, row, first + i)),
      ),
      rows.length === 0 ? noLayers(m, h) : empty(h),
    ],
  )
}
const search = (m: Model, h: H): Html =>
  h.label(
    [h.Class('layer-search')],
    [
      icon(h, 'search', 14),
      h.input([
        h.Placeholder('Find a layer…'),
        h.Value(m.search),
        h.AriaLabel('Search layers'),
        h.OnInput((value) => Messages.Search({ value })),
      ]),
    ],
  )
export const sidebar = (m: Model, h: H): Html =>
  h.aside(
    [h.Class('left-panel'), h.AriaLabel('Pages and layers')],
    [
      h.div(
        [h.Class('panel-heading')],
        [h.span([], ['Workspace']), button(h, 'more', 'Open local documents', 'documents')],
      ),
      pageList(m, h),
      h.div(
        [h.Class('layers-heading')],
        [
          label(h, 'Layers'),
          h.span([h.Class('count-badge')], [String(currentPage(m.document).nodes.length)]),
        ],
      ),
      search(m, h),
      layers(m, h),
      h.div(
        [h.Class('sidebar-footer')],
        [h.span([], ['YOUR SPACE TO MAKE.']), button(h, 'help', 'Keyboard shortcuts', 'shortcuts')],
      ),
    ],
  )

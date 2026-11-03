import { effectsSection, innerShadowSection } from './inspector-effects'
import type { Html } from 'foldkit/html'
import { currentPage } from '../document'
import { icon } from '../icons'
import { Messages, type Model } from '../model'
import { selectedNodes } from '../state'
import { item, type H } from './common'
import {
  appearanceSection,
  arrangeSection,
  exportSection,
  geometrySection,
  section,
  shadowSection,
  strokeSection,
  typographySection,
} from './inspector-fields'

const intro = (h: H): Html =>
  h.div(
    [h.Class('intro-note')],
    [
      h.div([h.Class('intro-symbol')], ['✳']),
      h.h2([], ['A space for', h.br([]), 'your next idea.']),
      h.p([], ['Draw a shape, set some type, and make it yours. Everything stays on this device.']),
      h.button(
        [h.Class('text-button'), h.OnClick(Messages.Action({ action: 'shortcuts' }))],
        ['Find your flow  ↗'],
      ),
    ],
  )
const setting = (m: Model, h: H, action: 'grid' | 'snap', title: string): Html =>
  h.button(
    [h.Class('setting-row'), h.OnClick(Messages.Action({ action }))],
    [
      icon(h, action, 16),
      h.span([h.Class('grow text-left')], [title]),
      h.span([h.Class(`toggle ${m[action] ? 'on' : ''}`)], []),
    ],
  )
const pageInspector = (m: Model, h: H): readonly Html[] => [
  section(h, 'Page name', [
    h.input([
      h.Class('select-field'),
      h.Value(m.drafts['page-name'] ?? currentPage(m.document).name),
      h.OnInput((value) => Messages.Draft({ field: 'page-name', value })),
      h.AriaLabel('Page name'),
      h.OnChange((value) => Messages.RenamePage({ value })),
    ]),
  ]),
  section(h, 'Canvas', [setting(m, h, 'grid', 'Show grid'), setting(m, h, 'snap', 'Smart guides')]),
  intro(h),
  section(h, 'Quick actions', [
    item(h, 'Fit to canvas', 'fit', '⇧1', 'frame'),
    item(h, 'Add a page', 'new-page', '', 'plus'),
    item(h, 'Delete this page', 'delete-page', '', 'close'),
    item(h, 'Export SVG', 'export-svg', '', 'export'),
  ]),
]
export const inspector = (m: Model, h: H): Html => {
  const n = selectedNodes(m)[0]
  const sections = n
    ? [
        geometrySection(m, n, h),
        typographySection(m, n, h),
        appearanceSection(m, n, h),
        strokeSection(m, n, h),
        effectsSection(m, n, h),
        shadowSection(m, n, h),
        innerShadowSection(m, n, h),
        arrangeSection(h),
        exportSection(h),
      ]
    : pageInspector(m, h)
  return h.aside(
    [h.Class('right-panel'), h.AriaLabel('Design inspector')],
    [
      h.div(
        [h.Class('panel-heading')],
        [
          h.span([], ['Design']),
          h.span(
            [h.Class('text-[10px] uppercase tracking-[.12em] text-stone-400')],
            [n ? n.kind : 'Page'],
          ),
        ],
      ),
      h.div([h.Class('inspector-scroll')], sections),
    ],
  )
}

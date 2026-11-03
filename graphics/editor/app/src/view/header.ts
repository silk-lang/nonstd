import type { Html } from 'foldkit/html'
import { icon } from '../icons'
import { Messages, type Model } from '../model'
import { button, type H } from './common'

const saveLabel = (m: Model): string => {
  if (m.error !== null) return 'Needs attention'
  return m.savedRevision >= m.revision ? 'Saved on this device' : 'Saving…'
}
const identity = (m: Model, h: H): Html =>
  h.div(
    [h.Class('flex items-center gap-3')],
    [
      h.button(
        [
          h.Class('brand-mark'),
          h.Title('File menu'),
          h.AriaLabel('File menu'),
          h.OnClick(Messages.Action({ action: 'file' })),
        ],
        ['s'],
      ),
      h.span([h.Class('brand-name')], ['silk', h.span([], ['studio'])]),
      h.span([h.Class('header-divider')], []),
      h.input([
        h.Class('document-title'),
        h.Value(m.drafts['document-name'] ?? m.document.name),
        h.OnInput((value) => Messages.Draft({ field: 'document-name', value })),
        h.AriaLabel('Document name'),
        h.OnChange((value) => Messages.RenameDocument({ value })),
      ]),
      h.span([h.Class('local-badge')], ['LOCAL']),
    ],
  )
const actions = (m: Model, h: H): Html =>
  h.div(
    [h.Class('flex items-center gap-1')],
    [
      h.span(
        [h.Class('save-state'), h.Role('status')],
        [icon(h, m.error === null ? 'check' : 'help', 13), saveLabel(m)],
      ),
      button(h, 'undo', 'Undo · ⌘Z', 'undo', m.past.length === 0),
      button(h, 'redo', 'Redo · ⇧⌘Z', 'redo', m.future.length === 0),
      h.span([h.Class('header-divider')], []),
      button(h, 'search', 'Commands · ⌘K', 'commands'),
      h.button(
        [h.Class('export-button'), h.OnClick(Messages.Action({ action: 'export-png' }))],
        [icon(h, 'export', 15), 'Export PNG'],
      ),
    ],
  )
export const header = (m: Model, h: H): Html =>
  h.header([h.Class('app-header')], [identity(m, h), actions(m, h)])

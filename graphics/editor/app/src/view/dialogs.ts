import { Option } from 'effect'
import type { Html } from 'foldkit/html'
import { FocusText } from '../engine'
import { icon, type IconName } from '../icons'
import { Messages, type Model } from '../model'
import { DialogFocus } from './mounts'
import { empty, button, item, type H } from './common'

const commands: readonly (readonly [string, string, string, IconName])[] = [
  ['Fit everything', 'fit', '⇧1', 'frame'],
  ['Zoom to selection', 'fit-selection', '⇧2', 'select'],
  ['100% zoom', 'zoom-100', '0', 'search'],
  ['Duplicate selection', 'duplicate', '⌘D', 'rect'],
  ['Group selection', 'group', '⌘G', 'group'],
  ['Ungroup selection', 'ungroup', '⇧⌘G', 'group'],
  ['Bring to front', 'front', '⌘]', 'top'],
  ['Send to back', 'back', '⌘[', 'bottom'],
  ['Toggle grid', 'grid', '', 'grid'],
  ['Toggle smart guides', 'snap', '', 'snap'],
  ['Add page', 'new-page', '', 'plus'],
  ['Add 100k rectangles', 'selection-page', '', 'rect'],
  ['Download .silk file', 'export-json', '⌘S', 'export'],
  ['Import document', 'import', '', 'file'],
  ['New document', 'new', '', 'plus'],
]

const fileMenu = (h: H): Html =>
  h.div(
    [h.Class('popover file-menu'), h.Role('menu'), h.AriaLabel('File actions')],
    [
      item(h, 'New document', 'new', '', 'plus'),
      item(h, 'Open local documents', 'documents'),
      item(h, 'Import .silk file…', 'import'),
      h.hr([]),
      item(h, 'Download .silk file', 'export-json', '⌘S', 'export'),
      item(h, 'Export SVG', 'export-svg', '', 'export'),
      item(h, 'Export PNG', 'export-png', '', 'export'),
      h.hr([]),
      item(h, 'Keyboard shortcuts', 'shortcuts', '?', 'help'),
      item(h, 'Close menu', 'dismiss', 'Esc', 'close'),
    ],
  )

const commandContent = (m: Model, h: H): readonly Html[] => [
  h.input([
    h.Class('command-search'),
    h.Placeholder('What would you like to do?'),
    h.AriaLabel('Search commands'),
    h.Value(m.commandQuery),
    h.OnInput((value) => Messages.CommandQuery({ value })),
    h.OnMount(FocusText()),
    h.OnKeyDownPreventDefault((key) => {
      const first = commands.find(([title]) =>
        title.toLowerCase().includes(m.commandQuery.toLowerCase()),
      )
      return key === 'Enter' && first
        ? Option.some(Messages.Action({ action: first[1] }))
        : Option.none()
    }),
  ]),
  ...commands
    .filter(([text]) => text.toLowerCase().includes(m.commandQuery.toLowerCase()))
    .map(([text, action, key, name]) => item(h, text, action, key, name)),
]

const documentContent = (m: Model, h: H): readonly Html[] => [
  h.p(
    [h.Class('dialog-description')],
    ['Your local documents. Download a .silk file to move work between devices.'],
  ),
  ...m.recent.map((recent) =>
    h.button(
      [h.Class('document-card'), h.OnClick(Messages.OpenDocument({ id: recent.id }))],
      [
        icon(h, 'file', 22),
        h.div(
          [h.Class('grow text-left')],
          [h.strong([], [recent.name]), h.p([], [new Date(recent.updatedAt).toLocaleDateString()])],
        ),
      ],
    ),
  ),
  item(h, 'Start a new document', 'new', '', 'plus'),
]

const shortcutContent = (h: H): readonly Html[] => [
  h.p(
    [h.Class('dialog-description')],
    [
      'A few familiar gestures to keep your ideas moving. Use Ctrl in place of ⌘ on Windows and Linux.',
    ],
  ),
  ...(
    [
      ['Move / Frame / Rectangle', 'V / F / R'],
      ['Ellipse / Text / Hand', 'O / T / H'],
      ['Pan canvas', 'Space + drag'],
      ['Zoom at pointer', '⌘ + scroll / pinch'],
      ['Select more layers', 'Shift + click'],
      ['Draw square / keep proportions', 'Shift + drag'],
      ['Duplicate while dragging', 'Alt + drag'],
      ['Skip smart guides', 'Alt while dragging'],
      ['Undo / Redo', '⌘Z / ⇧⌘Z'],
      ['Copy / Cut / Paste', '⌘C / ⌘X / ⌘V'],
      ['Group / Ungroup', '⌘G / ⇧⌘G'],
      ['Nudge / Large nudge', 'Arrows / Shift + arrows'],
      ['Fit all / Fit selection', '⇧1 / ⇧2'],
      ['Commands / Download file', '⌘K / ⌘S'],
      ['Cancel gesture', 'Esc'],
    ] as const
  ).map(([text, key]) =>
    h.div([h.Class('shortcut-row')], [h.span([], [text ?? '']), h.kbd([], [key ?? ''])]),
  ),
]

export const dialogs = (m: Model, h: H): Html => {
  if (m.menu === 'none') return empty(h)
  if (m.menu === 'file')
    return h.div([h.Key('file'), h.Class('menu-backdrop'), h.OnMount(DialogFocus())], [fileMenu(h)])
  let title = 'Keyboard shortcuts'
  let content = shortcutContent(h)
  if (m.menu === 'commands') {
    title = 'Commands'
    content = commandContent(m, h)
  }
  if (m.menu === 'documents') {
    title = 'On this device'
    content = documentContent(m, h)
  }
  return h.div(
    [h.Key(m.menu), h.Class('modal-backdrop'), h.OnMount(DialogFocus())],
    [
      h.section(
        [h.Class('dialog'), h.Role('dialog'), h.AriaModal(true), h.AriaLabel(title)],
        [
          h.div(
            [h.Class('dialog-header')],
            [h.h2([], [title]), button(h, 'close', 'Close dialog', 'dismiss')],
          ),
          h.div([h.Class('dialog-body')], content),
        ],
      ),
    ],
  )
}

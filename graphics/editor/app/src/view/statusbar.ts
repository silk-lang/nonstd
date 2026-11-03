import type { Html } from 'foldkit/html'
import { icon } from '../icons'
import { Messages, type Model } from '../model'
import { type H } from './common'

export const statusbar = (m: Model, h: H): Html =>
  h.footer(
    [h.Class('statusbar')],
    [
      h.div(
        [h.Class('flex items-center gap-3')],
        [
          h.span([h.Class('status-dot')], []),
          h.span(
            [],
            [m.selection.length > 0 ? `${m.selection.length} selected` : 'Ready to make something'],
          ),
          h.span([h.Class('status-tip')], ['Space to pan · ⌘/Ctrl + scroll to zoom']),
        ],
      ),
      h.div(
        [h.Class('flex items-center gap-3')],
        [
          h.button(
            [
              h.OnClick(Messages.Action({ action: 'snap' })),
              h.Class(m.snap ? 'status-enabled' : ''),
            ],
            [icon(h, 'snap', 12), 'Snap'],
          ),
          h.button([h.OnClick(Messages.Action({ action: 'grid' }))], [icon(h, 'grid', 12), 'Grid']),
          h.span([], ['SILK STUDIO']),
        ],
      ),
    ],
  )

import { SaveGuard } from './view/mounts'
import type { Document } from 'foldkit/html'
import { type Model } from './model'
import { empty, button, type H } from './view/common'
import { header } from './view/header'
import { sidebar } from './view/layers'
import { inspector } from './view/inspector'
import { workspace } from './view/canvas'
import { statusbar } from './view/statusbar'
import { dialogs } from './view/dialogs'

export const view = (m: Model, h: H): Document => ({
  title: `${m.document.name} — Silk Studio`,
  body: h.div(
    [h.Class(`studio ${m.panels ? '' : 'panels-hidden'}`)],
    [
      m.savedRevision < m.revision
        ? h.span([h.Key('pending-save'), h.OnMount(SaveGuard())], [])
        : empty(h),
      header(m, h),
      h.div([h.Class('app-body')], [sidebar(m, h), workspace(m, h), inspector(m, h)]),
      statusbar(m, h),
      dialogs(m, h),
      m.error !== null || m.notice.length > 0
        ? h.div(
            [
              h.Class(`toast ${m.error === null ? '' : 'error-toast'}`),
              h.Role(m.error === null ? 'status' : 'alert'),
            ],
            [
              h.span([], [m.error ?? m.notice]),
              button(h, 'close', 'Dismiss notification', 'dismiss'),
            ],
          )
        : empty(h),
    ],
  ),
})

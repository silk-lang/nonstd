import { Option } from 'effect'
import type { Html } from 'foldkit/html'
import { currentPage, type Node } from '../document'
import { FocusText, MountCanvas } from '../engine'
import { boundsOf, round, screenBounds, worldPoint } from '../geometry'
import { icon } from '../icons'
import { Messages, type Model, type Tool } from '../model'
import { selectedNodes } from '../update'
import { empty, button, type H } from './common'

const toolbar = (m: Model, h: H): Html => {
  const tools: readonly (readonly [Tool, string, string])[] = [
    ['select', 'Move', 'V'],
    ['frame', 'Frame', 'F'],
    ['rect', 'Rectangle', 'R'],
    ['ellipse', 'Ellipse', 'O'],
    ['text', 'Text', 'T'],
    ['hand', 'Hand', 'H'],
  ]
  return h.div(
    [h.Class('tool-dock'), h.Role('toolbar'), h.AriaLabel('Drawing tools')],
    tools.map(([tool, title, shortcut]) =>
      h.button(
        [
          h.Class(`tool ${m.tool === tool ? 'active-tool' : ''}`),
          h.Title(`${title} · ${shortcut}`),
          h.AriaLabel(`${title} tool`),
          h.AriaPressed(String(m.tool === tool)),
          h.OnClick(Messages.ChooseTool({ tool })),
        ],
        [icon(h, tool, 20), h.span([h.Class('tool-key')], [shortcut])],
      ),
    ),
  )
}
const handles = [
  ['nw', 0, 0],
  ['n', 0.5, 0],
  ['ne', 1, 0],
  ['e', 1, 0.5],
  ['se', 1, 1],
  ['s', 0.5, 1],
  ['sw', 0, 1],
  ['w', 0, 0.5],
] as const

const selectionOverlay = (m: Model, h: H): Html => {
  const nodes = selectedNodes(m)
  const b = boundsOf(nodes),
    screen = b && screenBounds(b, m.camera)
  return screen
    ? h.div(
        [
          h.Class('selection-box'),
          h.Style({
            left: `${screen.x}px`,
            top: `${screen.y}px`,
            width: `${screen.width}px`,
            height: `${screen.height}px`,
          }),
        ],
        [
          ...handles.map(([name, x, y]) =>
            h.div(
              [
                h.Id(`resize-${name}`),
                h.Class('resize-handle'),
                h.Style({ left: `${x * 100}%`, top: `${y * 100}%`, cursor: `${name}-resize` }),
                h.Title(`Resize ${name}`),
              ],
              [],
            ),
          ),
          h.span(
            [h.Class('dimension-label')],
            [`${round(b?.width ?? 0)} × ${round(b?.height ?? 0)}`],
          ),
        ],
      )
    : empty(h)
}
const marqueeOverlay = (m: Model, h: H): Html => {
  const g = m.gesture
  let marquee = empty(h)
  if (g?.type === 'marquee') {
    const start = worldPoint(g.start, g.camera)
    const end = worldPoint(g.current, g.camera)
    const rect = screenBounds(
      {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(start.x - end.x),
        height: Math.abs(start.y - end.y),
      },
      m.camera,
    )
    marquee = h.div(
      [
        h.Class('marquee'),
        h.Style({
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        }),
      ],
      [],
    )
  }
  return marquee
}
const textOverlay = (m: Model, h: H): Html => {
  if (m.editingId === null) return empty(h)
  const editing = currentPage(m.document).nodes.find((n) => n.id === m.editingId)
  let textEdit = empty(h)
  if (editing) {
    const rect = screenBounds(editing, m.camera)
    textEdit = h.input([
      h.Key(`edit-${editing.id}`),
      h.Class('canvas-text-input'),
      h.AriaLabel('Edit text on canvas'),
      h.Value(m.editingText),
      h.Style({
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${Math.max(160, rect.width)}px`,
        height: `${Math.max(30, rect.height)}px`,
        fontFamily: editing.fontFamily,
        fontSize: `${Math.min(200, editing.fontSize * m.camera.zoom)}px`,
        fontWeight: String(editing.fontWeight),
        color: editing.fill,
      }),
      h.OnInput((value) => Messages.EditText({ value })),
      h.OnBlur(Messages.CommitText()),
      h.OnMount(FocusText()),
      h.OnKeyDownPreventDefault((key) => {
        if (key === 'Enter') return Option.some(Messages.CommitText())
        if (key === 'Escape') return Option.some(Messages.CancelText())
        return Option.none()
      }),
    ])
  }
  return textEdit
}
const framesByNodes = new WeakMap<readonly Node[], readonly Node[]>()
const visibleFrames = (m: Model): readonly Node[] => {
  const nodes = currentPage(m.document).nodes
  let frames = framesByNodes.get(nodes)
  if (!frames) {
    frames = nodes.filter((n) => n.kind === 'frame' && !n.hidden)
    framesByNodes.set(nodes, frames)
  }
  return frames
    .filter((n) => {
      const b = screenBounds(n, m.camera)
      return (
        b.width >= 60 &&
        b.x + b.width >= 0 &&
        b.y + b.height >= 0 &&
        b.x < m.width &&
        b.y < m.height
      )
    })
    .slice(0, 300)
}
const overlays = (m: Model, h: H): Html => {
  return h.div(
    [h.Class('canvas-overlays')],
    [
      ...visibleFrames(m).map((n) => {
        const rect = screenBounds(n, m.camera)
        return h.span(
          [
            h.Key(n.id),
            h.Class('frame-label'),
            h.Style({
              left: `${rect.x}px`,
              top: `${rect.y - 22}px`,
              maxWidth: `${Math.max(60, rect.width)}px`,
            }),
          ],
          [n.name],
        )
      }),
      selectionOverlay(m, h),
      marqueeOverlay(m, h),
      m.guideX === null
        ? empty(h)
        : h.div(
            [
              h.Class('guide vertical'),
              h.Style({ left: `${(m.guideX - m.camera.x) * m.camera.zoom}px` }),
            ],
            [],
          ),
      m.guideY === null
        ? empty(h)
        : h.div(
            [
              h.Class('guide horizontal'),
              h.Style({ top: `${(m.guideY - m.camera.y) * m.camera.zoom}px` }),
            ],
            [],
          ),
      textOverlay(m, h),
    ],
  )
}
const zoomControls = (m: Model, h: H): Html =>
  h.div(
    [h.Class('zoom-controls')],
    [
      button(h, 'minus', 'Zoom out', 'zoom-out'),
      h.input([
        h.AriaLabel('Zoom percentage'),
        h.Value(m.drafts['zoom'] ?? `${Math.round(m.camera.zoom * 100)}%`),
        h.OnInput((value) => Messages.Draft({ field: 'zoom', value })),
        h.OnChange((value) => {
          const number = Number(value.replace('%', ''))
          return Number.isFinite(number)
            ? Messages.ZoomPercent({ value: number })
            : Messages.Synced()
        }),
      ]),
      button(h, 'plus', 'Zoom in', 'zoom-in'),
      button(h, 'frame', 'Fit all · ⇧1', 'fit'),
    ],
  )

const loadingState = (m: Model, h: H): Html =>
  m.ready
    ? empty(h)
    : h.div(
        [h.Class('canvas-loading')],
        [
          h.div([h.Class('loading-dot')], []),
          h.p([], [m.error === null ? 'Preparing your workspace…' : 'The canvas could not start.']),
        ],
      )
export const workspace = (m: Model, h: H): Html =>
  h.main(
    [h.Class('workspace'), h.AriaLabel('Design workspace')],
    [
      h.div(
        [
          h.Id('canvas-host'),
          h.Class(`canvas-host tool-${m.tool}`),
          h.Tabindex(0),
          h.AriaLabel('Design canvas'),
          h.OnMount(MountCanvas()),
        ],
        [
          h.canvas([h.Class('gpu-canvas'), h.AriaLabel('Silk design canvas')], []),
          m.grid
            ? h.div(
                [
                  h.Class('canvas-grid'),
                  h.Style({
                    backgroundSize: `${Math.max(4, 16 * m.camera.zoom)}px ${Math.max(4, 16 * m.camera.zoom)}px`,
                    backgroundPosition: `${-m.camera.x * m.camera.zoom}px ${-m.camera.y * m.camera.zoom}px`,
                  }),
                ],
                [],
              )
            : empty(h),
          overlays(m, h),
        ],
      ),
      h.div(
        [h.Class('canvas-topline')],
        [
          h.span([], [m.document.name]),
          h.span([h.Class('text-stone-400')], ['/']),
          h.span([], [currentPage(m.document).name]),
        ],
      ),
      zoomControls(m, h),
      toolbar(m, h),
      loadingState(m, h),
    ],
  )

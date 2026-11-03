import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Message } from './model'

const paths = {
  select: 'M5 3l14 9-7 1-3 7z',
  frame: 'M8 3v18M16 3v18M3 8h18M3 16h18',
  rect: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
  ellipse: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  text: 'M4 5V3h16v2M12 3v18M8 21h8',
  hand: 'M8 12V7a2 2 0 0 1 4 0v4-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v9c0 4-3 6-7 6-3 0-4-2-6-4L3 13a2 2 0 0 1 3-2l2 1',
  group: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  chevron: 'M8 5l7 7-7 7',
  down: 'M5 9l7 7 7-7',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3',
  undo: 'M9 4L3 10l6 6M3 10h11a6 6 0 0 1 6 6v3',
  redo: 'M15 4l6 6-6 6M21 10H10a6 6 0 0 0-6 6v3',
  export: 'M12 16V3M7 8l5-5 5 5M4 15v6h16v-6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  snap: 'M6 3v9a6 6 0 0 0 12 0V3M6 7h4M14 7h4M10 3v9a2 2 0 0 0 4 0V3',
  check: 'M4 12l5 5L20 6',
  close: 'M6 6l12 12M6 18L18 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  help: 'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17v.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  left: 'M4 3v18M8 6h12v4H8zM8 14h8v4H8z',
  center: 'M12 2v20M4 6h16v4H4zM7 14h10v4H7z',
  right: 'M20 3v18M4 6h12v4H4zM8 14h8v4H8z',
  top: 'M3 4h18M6 8h4v12H6zM14 8h4v8h-4z',
  middle: 'M2 12h20M6 4h4v16H6zM14 7h4v10h-4z',
  bottom: 'M3 20h18M6 4h4v12H6zM14 8h4v8h-4z',
  file: 'M5 2h9l5 5v15H5zM14 2v6h5M8 13h8M8 17h5',
} as const
export type IconName = keyof typeof paths
export const icon = (h: HtmlBuilder<Message>, name: IconName, size = 18): Html =>
  h.svg(
    [
      h.ViewBox('0 0 24 24'),
      h.Width(String(size)),
      h.Height(String(size)),
      h.Fill('none'),
      h.Stroke('currentColor'),
      h.StrokeWidth('1.6'),
      h.StrokeLinecap('round'),
      h.StrokeLinejoin('round'),
      h.AriaHidden(true),
    ],
    [h.path([h.D(paths[name])], [])],
  )

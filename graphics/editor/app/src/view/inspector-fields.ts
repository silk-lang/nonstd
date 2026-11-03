import type { Html } from 'foldkit/html'
import type { Node } from '../document'
import { icon } from '../icons'
import { Messages, type Model } from '../model'
import { selectedNodes } from '../state'
import { button, colorField, empty, input, label, numeric, type H } from './common'

export const section = (h: H, title: string, children: readonly Html[]): Html =>
  h.section([h.Class('inspector-section')], [label(h, title), ...children])
const pair = (h: H, children: readonly Html[]): Html => h.div([h.Class('property-grid')], children)
export const geometrySection = (m: Model, n: Node, h: H): Html => {
  const selected = selectedNodes(m)
  const alignment = ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const
  const title = selected.length > 1 ? `${selected.length} layers selected` : n.name
  return h.section(
    [h.Class('inspector-section')],
    [
      h.div([h.Class('selection-heading')], [icon(h, n.kind, 16), h.span([], [title])]),
      input(m, h, 'name', n.name, 'Layer name'),
      h.div(
        [h.Class('alignment-row')],
        alignment.map((direction) =>
          button(h, direction, `Align ${direction}`, `align-${direction}`, selected.length < 2),
        ),
      ),
      label(h, 'Position'),
      pair(h, [numeric(m, h, n, 'x', 'X'), numeric(m, h, n, 'y', 'Y')]),
      label(h, 'Dimensions'),
      pair(h, [numeric(m, h, n, 'width', 'W'), numeric(m, h, n, 'height', 'H')]),
      selected.length > 1
        ? h.p([h.Class('hint')], ['Values apply to all selected layers.'])
        : empty(h),
    ],
  )
}
const fontSelect = (n: Node, h: H, field: 'fontFamily' | 'fontWeight'): Html => {
  const values =
    field === 'fontFamily' ? ['Arial', 'Georgia', 'Courier New'] : ['400', '500', '600', '700']
  const title = field === 'fontFamily' ? 'Font family' : 'Font weight'
  return h.select(
    [
      h.Class('select-field'),
      h.Value(String(n[field])),
      h.AriaLabel(title),
      h.OnChange((value) => Messages.Patch({ field, value })),
    ],
    values.map((value) => h.option([h.Value(value)], [value])),
  )
}
export const typographySection = (m: Model, n: Node, h: H): Html => {
  if (n.kind !== 'text') return empty(h)
  return section(h, 'Typography', [
    fontSelect(n, h, 'fontFamily'),
    pair(h, [numeric(m, h, n, 'fontSize', 'Size'), fontSelect(n, h, 'fontWeight')]),
    h.input([
      h.Class('select-field'),
      h.Value(m.drafts['text'] ?? n.text),
      h.OnInput((value) => Messages.Draft({ field: 'text', value })),
      h.AriaLabel('Text content'),
      h.OnChange((value) => Messages.Patch({ field: 'text', value })),
    ]),
    h.p([h.Class('hint')], ['Double-click text on the canvas to edit.']),
  ])
}
export const appearanceSection = (m: Model, n: Node, h: H): Html =>
  n.kind === 'group'
    ? section(h, 'Group opacity', [
        input(m, h, 'opacity', String(Math.round(n.opacity * 100)), 'Opacity %', 'number'),
      ])
    : section(h, 'Appearance', [
        pair(h, [
          input(m, h, 'opacity', String(Math.round(n.opacity * 100)), 'Opacity %', 'number'),
          numeric(m, h, n, 'radius', 'Radius'),
        ]),
        label(h, 'Fill'),
        colorField(m, h, n, 'fill', 'Fill'),
        h.div(
          [h.Class('swatches')],
          ['#25352b', '#b8c5ac', '#e6b84e', '#e3ad90', '#f7f5ec', '#ffffff', '#111111'].map(
            (color) =>
              h.button(
                [
                  h.Style({ backgroundColor: color }),
                  h.AriaLabel(`Fill ${color}`),
                  h.Title(color),
                  h.OnClick(Messages.Patch({ field: 'fill', value: color })),
                ],
                [],
              ),
          ),
        ),
      ])
export const strokeSection = (m: Model, n: Node, h: H): Html =>
  n.kind === 'ellipse' || n.kind === 'text' || n.kind === 'group'
    ? empty(h)
    : section(h, 'Stroke', [
        colorField(m, h, n, 'stroke', 'Stroke'),
        numeric(m, h, n, 'strokeWidth', 'Width'),
      ])
export const shadowSection = (m: Model, n: Node, h: H): Html =>
  n.kind === 'ellipse' || n.kind === 'text' || n.kind === 'group'
    ? empty(h)
    : section(h, 'Drop shadow', [
        colorField(m, h, n, 'shadow', 'Shadow'),
        pair(h, [numeric(m, h, n, 'blur', 'Blur'), numeric(m, h, n, 'shadowY', 'Offset Y')]),
        h.p([h.Class('hint')], ['Use an eight-digit hex value for transparency.']),
      ])
const actionButton = (h: H, title: string, action: string): Html =>
  h.button([h.Class('secondary-button grow'), h.OnClick(Messages.Action({ action }))], [title])
export const arrangeSection = (h: H): Html =>
  section(h, 'Arrange', [
    h.div(
      [h.Class('flex gap-2')],
      [actionButton(h, 'Send back', 'back'), actionButton(h, 'Bring front', 'front')],
    ),
    h.div(
      [h.Class('flex gap-2 mt-2')],
      [actionButton(h, 'Duplicate', 'duplicate'), actionButton(h, 'Delete', 'delete')],
    ),
  ])
export const exportSection = (h: H): Html =>
  section(h, 'Export selection', [
    h.div(
      [h.Class('flex gap-2')],
      [actionButton(h, 'SVG', 'export-svg'), actionButton(h, 'PNG', 'export-png')],
    ),
  ])

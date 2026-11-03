import type { Html } from 'foldkit/html'
import { blendModes } from '../../../dist/editor.js'
import type { Node } from '../document'
import { Messages, type Model } from '../model'
import { colorField, empty, input, label, numeric, type H } from './common'
import { section } from './inspector-fields'

export const effectsSection = (m: Model, n: Node, h: H): Html => {
  if (n.kind === 'group') return empty(h)
  return section(h, 'Effects', [
    label(h, 'Blend mode'),
    h.select(
      [
        h.Class('select-field'),
        h.Value(n.blendMode),
        h.AriaLabel('Blend mode'),
        h.OnChange((value) => Messages.Patch({ field: 'blendMode', value })),
      ],
      blendModes.map((mode) => h.option([h.Value(mode)], [mode.replaceAll('-', ' ')])),
    ),
    numeric(m, h, n, 'layerBlur', 'Layer blur'),
    n.kind === 'text' ? empty(h) : numeric(m, h, n, 'backdropBlur', 'Backdrop blur'),
    ...(['brightness', 'contrast', 'saturation'] as const).map((field) =>
      input(
        m,
        h,
        field,
        String(Math.round(n[field] * 100)),
        `${field[0]?.toUpperCase()}${field.slice(1)} %`,
        'number',
      ),
    ),
    h.p(
      [h.Class('hint')],
      [
        'Layer blur softens this layer. Backdrop blur softens layers behind it; use a transparent fill to see through.',
      ],
    ),
  ])
}
export const innerShadowSection = (m: Model, n: Node, h: H): Html =>
  n.kind === 'rect' || n.kind === 'frame'
    ? section(h, 'Inner shadow', [
        colorField(m, h, n, 'innerShadow', 'Inner shadow'),
        numeric(m, h, n, 'innerBlur', 'Inner blur'),
        h.div(
          [h.Class('property-grid')],
          [
            numeric(m, h, n, 'innerShadowX', 'Inner X'),
            numeric(m, h, n, 'innerShadowY', 'Inner Y'),
          ],
        ),
      ])
    : empty(h)

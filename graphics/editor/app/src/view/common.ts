import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Node } from '../document'
import { round } from '../geometry'
import { icon, type IconName } from '../icons'
import { Messages, type Message, type Model } from '../model'

export type H = HtmlBuilder<Message>
export const empty = (h: H): Html => h.span([], [])
export const label = (h: H, text: string): Html => h.h3([h.Class('section-label')], [text])
export const button = (
  h: H,
  name: IconName,
  title: string,
  action: string,
  disabled = false,
  active = false,
): Html =>
  h.button(
    [
      h.Class(`icon-button ${active ? 'is-active' : ''}`),
      h.Type('button'),
      h.Title(title),
      h.AriaLabel(title),
      h.Disabled(disabled),
      h.OnClick(Messages.Action({ action })),
    ],
    [icon(h, name)],
  )
export const item = (
  h: H,
  title: string,
  action: string,
  shortcut = '',
  name: IconName = 'file',
): Html =>
  h.button(
    [h.Class('menu-item'), h.OnClick(Messages.Action({ action }))],
    [icon(h, name, 16), h.span([h.Class('grow text-left')], [title]), h.kbd([], [shortcut])],
  )
export const input = (
  m: Model,
  h: H,
  field: string,
  value: string,
  title: string,
  kind = 'text',
): Html =>
  h.label(
    [h.Class('property-field')],
    [
      h.span([h.Class('property-prefix')], [title]),
      h.input([
        h.Type(kind),
        h.Value(m.drafts[field] ?? value),
        h.OnInput((draft) => Messages.Draft({ field, value: draft })),
        h.AriaLabel(title),
        h.OnChange((next) => Messages.Patch({ field, value: next })),
        h.Spellcheck(false),
      ]),
    ],
  )
export const numeric = (
  m: Model,
  h: H,
  n: Node,
  field:
    | 'x'
    | 'y'
    | 'width'
    | 'height'
    | 'radius'
    | 'strokeWidth'
    | 'blur'
    | 'layerBlur'
    | 'backdropBlur'
    | 'innerBlur'
    | 'innerShadowX'
    | 'innerShadowY'
    | 'shadowX'
    | 'shadowY'
    | 'fontSize',
  title: string,
): Html => input(m, h, field, String(round(n[field])), title, 'number')
export const colorField = (
  m: Model,
  h: H,
  n: Node,
  field: 'fill' | 'stroke' | 'shadow' | 'innerShadow',
  title: string,
): Html =>
  h.div(
    [h.Class('color-field')],
    [
      h.input([
        h.Type('color'),
        h.Value(n[field].slice(0, 7)),
        h.AriaLabel(`${title} color`),
        h.OnChange((value) => Messages.Patch({ field, value })),
      ]),
      h.input([
        h.Value(m.drafts[field] ?? n[field].slice(1).toUpperCase()),
        h.OnInput((draft) => Messages.Draft({ field, value: draft })),
        h.AriaLabel(`${title} hex`),
        h.Spellcheck(false),
        h.OnChange((value) => Messages.Patch({ field, value })),
      ]),
      h.span([h.Class('text-[10px] text-stone-400')], [title]),
    ],
  )

import type { Node } from './document'

export const hasLayerEffects = (n: Node): boolean =>
  n.layerBlur > 0 ||
  n.backdropBlur > 0 ||
  n.brightness !== 1 ||
  n.contrast !== 1 ||
  n.saturation !== 1 ||
  n.blendMode !== 'normal'
export const colorMatrix = (n: Node): readonly number[] => {
  const s = n.saturation
  const k = n.brightness * n.contrast
  const r = (1 - s) * 0.2126 * k
  const g = (1 - s) * 0.7152 * k
  const b = (1 - s) * 0.0722 * k
  const t = (1 - n.contrast) * 0.5
  return [r + s * k, g, b, 0, t, r, g + s * k, b, 0, t, r, g, b + s * k, 0, t, 0, 0, 0, 1, 0]
}

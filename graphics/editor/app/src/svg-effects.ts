import type { Node } from './document'
import { colorMatrix } from './layer-effects'

export const hasShadow = (n: Node): boolean => n.shadow.length !== 9 || n.shadow.slice(7) !== '00'
export const paintExtent = (n: Node) => {
  const stroke = n.strokeWidth / 2
  const shadowBlur = hasShadow(n) ? n.blur * 1.5 : 0
  const dx = hasShadow(n) ? n.shadowX : 0
  const dy = hasShadow(n) ? n.shadowY : 0
  const padding = n.layerBlur * 3
  const left = Math.max(stroke, shadowBlur - dx) + padding
  const top = Math.max(stroke, shadowBlur - dy) + padding
  return {
    x: n.x - left,
    y: n.y - top,
    width: n.width + left + Math.max(stroke, shadowBlur + dx) + padding,
    height: n.height + top + Math.max(stroke, shadowBlur + dy) + padding,
  }
}
const alpha = (hex: string): number =>
  hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1
export const svgFilter = (n: Node, id: number): string => {
  const stages: string[] = []
  if (hasShadow(n))
    stages.push(
      `<feDropShadow dx="${n.shadowX}" dy="${n.shadowY}" stdDeviation="${n.blur / 2}" flood-color="${n.shadow.slice(0, 7)}" flood-opacity="${alpha(n.shadow)}" result="base"/>`,
    )
  if (alpha(n.innerShadow) > 0) {
    const base = stages.length > 0 ? 'base' : 'SourceGraphic'
    stages.push(
      `<feGaussianBlur in="SourceAlpha" stdDeviation="${n.innerBlur / 2}" result="innerBlur"/><feOffset in="innerBlur" dx="${n.innerShadowX}" dy="${n.innerShadowY}" result="innerOffset"/><feComposite in="SourceAlpha" in2="innerOffset" operator="out" result="innerMask"/><feFlood flood-color="${n.innerShadow.slice(0, 7)}" flood-opacity="${alpha(n.innerShadow)}"/><feComposite in2="innerMask" operator="in" result="innerColor"/><feMerge><feMergeNode in="${base}"/><feMergeNode in="innerColor"/></feMerge>`,
    )
  }
  if (n.layerBlur > 0) stages.push(`<feGaussianBlur stdDeviation="${n.layerBlur}"/>`)
  if (n.brightness !== 1 || n.contrast !== 1 || n.saturation !== 1)
    stages.push(`<feColorMatrix type="matrix" values="${colorMatrix(n).join(' ')}"/>`)
  if (stages.length === 0) return ''
  const b = paintExtent(n)
  return `<filter id="effect${id}" filterUnits="userSpaceOnUse" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" color-interpolation-filters="sRGB">${stages.join('')}</filter>`
}

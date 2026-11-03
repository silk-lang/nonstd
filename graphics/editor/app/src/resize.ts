import type { Bounds } from './geometry'

/** Resize from the opposite edge, keeping that anchor fixed when Shift constrains aspect. */
export const resizeBounds = (
  b: Bounds,
  handle: string,
  dx: number,
  dy: number,
  proportional: boolean,
): Bounds => {
  const west = handle.includes('w')
  const north = handle.includes('n')
  const horizontal = west || handle.includes('e')
  const vertical = north || handle.includes('s')
  let width = Math.min(100_000, Math.max(1, b.width + (horizontal ? dx * (west ? -1 : 1) : 0)))
  let height = Math.min(100_000, Math.max(1, b.height + (vertical ? dy * (north ? -1 : 1) : 0)))
  if (proportional) {
    let scale = width / b.width
    if (!horizontal || (vertical && Math.abs(height / b.height - 1) > Math.abs(scale - 1)))
      scale = height / b.height
    scale = Math.min(scale, 100_000 / b.width, 100_000 / b.height)
    width = b.width * scale
    height = b.height * scale
  }
  const x = west ? b.x + b.width - width : b.x
  const y = north ? b.y + b.height - height : b.y
  return {
    x: horizontal ? x : b.x + (b.width - width) / 2,
    y: vertical ? y : b.y + (b.height - height) / 2,
    width,
    height,
  }
}

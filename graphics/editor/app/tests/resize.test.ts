import { expect, test } from 'bun:test'
import { resizeBounds } from '../src/resize'

test('constrained west/north resizing preserves the opposite corner', () => {
  const before = { x: 100, y: 200, width: 200, height: 100 }
  const next = resizeBounds(before, 'nw', -100, -10, true)
  expect(next.width / next.height).toBe(2)
  expect(next.x + next.width).toBe(300)
  expect(next.y + next.height).toBe(300)
})
test('constrained vertical resizing changes both dimensions around the opposite edge', () => {
  expect(resizeBounds({ x: 0, y: 0, width: 200, height: 100 }, 'n', 0, -100, true)).toEqual({
    x: -100,
    y: -100,
    width: 400,
    height: 200,
  })
})

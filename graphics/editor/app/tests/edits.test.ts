import { expect, test } from 'bun:test'
import { currentPage, emptyDocument, makeNode, replaceNodes } from '../src/document'
import { align, patch } from '../src/properties'
import { groupBounds, initialModel } from '../src/state'

test('alignment moves selected subtrees once, preserves locked roots, and records one undo step', () => {
  const nodes = [
    makeNode('child', 'rect', { parentId: 'g', x: 110, y: 20, width: 20 }),
    makeNode('g', 'group', { x: 100, y: 20, width: 30 }),
    makeNode('a', 'rect', { x: 10, width: 20 }),
    makeNode('locked', 'rect', { x: -500, locked: true }),
  ]
  const m = {
    ...initialModel(replaceNodes(emptyDocument('edits'), nodes)),
    selection: ['g', 'child', 'a', 'locked'],
  }
  const next = align(m, 'left')
  expect(currentPage(next.document).nodes.map((n) => n.x)).toEqual([20, 20, 10, -500])
  expect(next.past).toEqual([m.document])
  expect(currentPage(m.document).nodes).toEqual(nodes)
})

test('bulk geometry edits scale groups but leave frame contents at their original size', () => {
  const nodes = [
    makeNode('gc', 'rect', { parentId: 'g', x: 110, width: 20, height: 20 }),
    makeNode('fc', 'rect', { parentId: 'f', x: 220, width: 20, height: 20 }),
    makeNode('g', 'group', { x: 100, width: 40 }),
    makeNode('f', 'frame', { x: 200, width: 40 }),
  ]
  const m = { ...initialModel(replaceNodes(emptyDocument('edits'), nodes)), selection: ['g', 'f'] }
  const next = patch(m, 'width', '80')
  expect(currentPage(next.document).nodes.map((n) => [n.x, n.width])).toEqual([
    [120, 40],
    [220, 20],
    [120, 40],
    [200, 80],
  ])
  expect(next.past).toEqual([m.document])
})

test('nested group bounds include drawable descendants in any order and reuse unchanged nodes', () => {
  const nodes = [
    makeNode('leaf', 'rect', { parentId: 'inner', x: 10, y: 20, width: 30, height: 40 }),
    makeNode('outer', 'group'),
    makeNode('inner', 'group', { parentId: 'outer' }),
    makeNode('empty', 'group', { x: 500 }),
  ]
  const first = groupBounds(nodes)
  expect(first.slice(1, 3).map((n) => [n.x, n.y, n.width, n.height])).toEqual([
    [10, 20, 30, 40],
    [10, 20, 30, 40],
  ])
  const second = groupBounds(first)
  expect(second.every((n, i) => n === first[i])).toBe(true)
  expect(first[3]).toBe(nodes[3])
})

test('one width edit in 100k grouped cards stays within a linear-work budget', () => {
  const nodes = Array.from({ length: 100_000 }, (_, i) => [
    makeNode(`g${i}`, 'group', { x: i, width: 20, height: 20 }),
    makeNode(`i${i}`, 'rect', {
      parentId: `g${i}`,
      x: i,
      width: 20,
      height: 20,
      image: 'tweet-challenge',
    }),
    makeNode(`t${i}`, 'text', { parentId: `g${i}`, x: i, width: 10, height: 10 }),
  ]).flat()
  const m = { ...initialModel(replaceNodes(emptyDocument('cards'), nodes)), selection: ['i99999'] }
  const start = performance.now()
  const next = patch(m, 'width', '30')
  const elapsed = performance.now() - start
  expect(elapsed).toBeLessThan(2000)
  const changed = currentPage(next.document).nodes
  expect(changed.at(-3)?.width).toBe(30)
  expect(changed.at(-2)?.width).toBe(30)
  expect(changed[0]).toBe(nodes[0])
  expect(next.past).toEqual([m.document])
}, 10_000)

import { expect, test } from 'bun:test'
import { currentPage, emptyDocument, makeNode, replaceNodes } from '../src/document'
import { align, patch } from '../src/properties'
import { initialModel } from '../src/state'

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

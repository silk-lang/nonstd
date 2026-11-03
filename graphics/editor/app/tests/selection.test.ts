import { expect, test } from 'bun:test'
import { emptyDocument, makeNode, replaceNodes, type Node } from '../src/document'
import { selectionRoots } from '../src/hierarchy'
import { Messages, type Model, type Pointer } from '../src/model'
import { initialModel, reduce } from '../src/update'

const point = (x: number, y: number, shift = false): Pointer => ({
  x,
  y,
  shift,
  button: 0,
  alt: false,
  meta: false,
  space: false,
  handle: '',
})
const model = (nodes: readonly Node[], selection: readonly string[] = []): Model => ({
  ...initialModel(replaceNodes(emptyDocument('selection'), nodes)),
  ready: true,
  camera: { x: 0, y: 0, zoom: 1 },
  selection,
})
const marquee = (m: Model, x: number, y: number, shift = false): Model =>
  reduce(
    reduce(m, Messages.PointerDown({ point: point(-10, -10, shift) })),
    Messages.PointerMove({ point: point(x, y, shift) }),
  )

test('marquee preserves edge intersections, inherited flags and additive selection order', () => {
  const nodes = [
    makeNode('frame', 'frame'),
    makeNode('a', 'rect', { parentId: 'frame' }),
    makeNode('edge', 'rect', { x: 200, y: 200 }),
    makeNode('hidden', 'group', { hidden: true }),
    makeNode('hidden-child', 'rect', { parentId: 'hidden' }),
    makeNode('locked', 'group', { locked: true }),
    makeNode('locked-child', 'rect', { parentId: 'locked' }),
    makeNode('far', 'rect', { x: 1000 }),
  ]
  const before = model(nodes, ['far', 'a'])
  const selected = marquee(before, 200, 200, true)
  expect(selected.selection).toEqual(['far', 'a', 'edge'])
  expect(selected.document).toBe(before.document)
  expect(selected.revision).toBe(before.revision)
  expect(marquee(before, 200, 200).selection).toEqual(['a', 'edge'])
  const shrunk = reduce(selected, Messages.PointerMove({ point: point(100, 100, true) }))
  expect(shrunk.selection).toEqual(['far', 'a'])
  expect(reduce(selected, Messages.CancelGesture()).selection).toEqual(before.selection)
})

test('selection queries see geometry, hierarchy and flag changes, including restored snapshots', () => {
  const original = [makeNode('a', 'rect'), makeNode('b', 'rect', { x: 1000 })]
  const before = model(original)
  expect(marquee(before, 200, 200).selection).toEqual(['a'])
  const edited = [makeNode('a', 'rect', { hidden: true }), makeNode('b', 'rect')]
  expect(marquee(model(edited), 200, 200).selection).toEqual(['b'])
  expect(marquee(before, 200, 200).selection).toEqual(['a'])
  const parent = makeNode('g', 'group')
  const child = makeNode('c', 'rect', { parentId: 'g' })
  const nodes = [child, parent, ...original]
  const ids = ['b', 'c', 'g', 'missing', 'a']
  expect(selectionRoots(nodes, ids).map((n) => n.id)).toEqual(['g', 'a', 'b'])
  expect(selectionRoots(nodes, ['c']).map((n) => n.id)).toEqual(['c'])
  const reparented = [makeNode('c', 'rect'), parent, ...original]
  expect(selectionRoots(reparented, ids).map((n) => n.id)).toEqual(['c', 'g', 'a', 'b'])
  expect(selectionRoots(nodes, ids).map((n) => n.id)).toEqual(['g', 'a', 'b'])
  const queried = marquee(model(nodes), 200, 200)
  expect(queried.selection).toEqual(['c', 'g', 'a'])
  expect(selectionRoots(nodes, queried.selection).map((n) => n.id)).toEqual(['g', 'a'])
})

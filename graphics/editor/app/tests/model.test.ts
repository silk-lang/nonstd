import { expect, test } from 'bun:test'
import {
  currentPage,
  documentIssue,
  emptyDocument,
  makeNode,
  replaceNodes,
  type Node,
} from '../src/document'
import { boundsOf, hitTest, worldPoint, zoomAt } from '../src/geometry'
import { paintOrder } from '../src/hierarchy'
import { Messages, type Model, type Pointer } from '../src/model'
import { initialModel, reduce } from '../src/update'
import { svgDocument } from '../src/svg-export'

const model = (nodes: readonly Node[], selection: readonly string[] = []): Model => ({
  ...initialModel(replaceNodes(emptyDocument('test'), nodes)),
  ready: true,
  camera: { x: 0, y: 0, zoom: 1 },
  selection,
  snap: false,
})
const point = (x: number, y: number, patch: Partial<Pointer> = {}): Pointer => ({
  x,
  y,
  button: 0,
  shift: false,
  alt: false,
  meta: false,
  space: false,
  handle: '',
  ...patch,
})
const action = (m: Model, name: string): Model => reduce(m, Messages.Action({ action: name }))
const node = (m: Model, id = 'a') => currentPage(m.document).nodes.find((n) => n.id === id)!

test('drag samples use the frozen origin and commit one undo snapshot', () => {
  const before = model([makeNode('a', 'rect')], ['a'])
  const down = reduce(before, Messages.PointerDown({ point: point(20, 20) }))
  const first = reduce(down, Messages.PointerMove({ point: point(30, 40) }))
  const second = reduce(first, Messages.PointerMove({ point: point(40, 60) }))
  const done = reduce(second, Messages.PointerUp({ point: point(40, 60) }))
  expect(node(done)).toMatchObject({ x: 20, y: 40 })
  expect(node(before)).toMatchObject({ x: 0, y: 0 })
  expect(done.past).toHaveLength(1)
  expect(action(done, 'undo').document).toEqual(before.document)
  expect(action(action(done, 'undo'), 'redo').document).toEqual(done.document)
})
test('cancelled shape creation and alt duplication restore the original document', () => {
  const before = model([makeNode('a', 'rect')], ['a'])
  const duplicate = reduce(before, Messages.PointerDown({ point: point(20, 20, { alt: true }) }))
  expect(currentPage(duplicate.document).nodes).toHaveLength(2)
  expect(node(duplicate, duplicate.selection[0])).toMatchObject({ x: 0, y: 0 })
  const cancelled = reduce(duplicate, Messages.CancelGesture())
  expect(cancelled.document).toEqual(before.document)
  expect(cancelled.selection).toEqual(['a'])
  const drawing = reduce(
    { ...before, tool: 'rect' },
    Messages.PointerDown({ point: point(300, 300) }),
  )
  const moved = reduce(drawing, Messages.PointerMove({ point: point(400, 450) }))
  expect(reduce(moved, Messages.CancelGesture()).document).toEqual(before.document)
})
test('properties and ungroup do not mutate prior history snapshots', () => {
  const before = model([makeNode('g', 'group'), makeNode('a', 'rect', { parentId: 'g' })], ['g'])
  const moved = reduce(before, Messages.Patch({ field: 'x', value: '60' }))
  expect(node(moved)).toMatchObject({ x: 60 })
  expect(node(before)).toMatchObject({ x: 0, parentId: 'g' })
  const ungrouped = action(moved, 'ungroup')
  expect(node(ungrouped).parentId).toBeNull()
  expect(node(moved).parentId).toBe('g')
  expect(action(ungrouped, 'undo').document).toEqual(moved.document)
})
test('nested selection moves once and copied trees receive fresh parent IDs', () => {
  const before = model(
    [makeNode('g', 'group'), makeNode('a', 'rect', { parentId: 'g' })],
    ['g', 'a'],
  )
  const nudged = reduce(
    before,
    Messages.Key({ key: 'ArrowRight', mod: false, shift: true, alt: false }),
  )
  expect(node(nudged).x).toBe(10)
  const copied = action(before, 'duplicate')
  expect(copied.selection).toHaveLength(1)
  const newGroup = copied.selection[0]
  expect(
    currentPage(copied.document).nodes.some((n) => n.id !== 'a' && n.parentId === newGroup),
  ).toBe(true)
  expect(documentIssue(copied.document)).toBeNull()
})
test('sending a child backward retains parent-first paint and hit-test order', () => {
  const before = model([makeNode('f', 'frame'), makeNode('a', 'rect', { parentId: 'f' })], ['a'])
  const moved = action(before, 'back')
  const nodes = currentPage(moved.document).nodes
  expect(paintOrder(nodes).map((n) => n.id)).toEqual(['f', 'a'])
  expect(hitTest(nodes, { x: 50, y: 50 })?.id).toBe('a')
})
test('locked descendants cannot be moved and hiding a frame clears child selection', () => {
  const before = model(
    [makeNode('f', 'frame', { locked: true }), makeNode('a', 'rect', { parentId: 'f' })],
    ['a'],
  )
  expect(node(reduce(before, Messages.Patch({ field: 'x', value: '80' }))).x).toBe(0)
  expect(reduce(before, Messages.ToggleLayer({ id: 'f', flag: 'hidden' })).selection).toEqual([])
})
test('wheel zoom preserves the point under the cursor', () => {
  const camera = { x: 80, y: -200, zoom: 0.4 }
  const cursor = { x: 321, y: 123 }
  const next = zoomAt(camera, cursor, 2)
  expect(worldPoint(cursor, next)).toEqual(worldPoint(cursor, camera))
})
test('imports reject cycles, duplicate IDs, invalid parents and excessive depth', () => {
  const cycle = [
    makeNode('a', 'group', { parentId: 'b' }),
    makeNode('b', 'group', { parentId: 'a' }),
  ]
  expect(documentIssue(replaceNodes(emptyDocument('x'), cycle))).toContain('cycles')
  const duplicate = [makeNode('a', 'rect'), makeNode('a', 'rect')]
  expect(documentIssue(replaceNodes(emptyDocument('x'), duplicate))).toContain('unique')
  expect(
    documentIssue(
      replaceNodes(emptyDocument('x'), [makeNode('a', 'rect', { parentId: 'missing' })]),
    ),
  ).toContain('parent')
  const deep = Array.from({ length: 66 }, (_, i) =>
    makeNode(`g${i}`, 'group', { parentId: i === 0 ? null : `g${i - 1}` }),
  )
  expect(documentIssue(replaceNodes(emptyDocument('x'), deep))).toContain('64')
})
test('SVG selection includes descendants and room for shadows', () => {
  const nodes = [
    makeNode('g', 'group'),
    makeNode('a', 'rect', { parentId: 'g', shadow: '#00000080', blur: 20, shadowY: 10 }),
  ]
  const svg = svgDocument(currentPage(replaceNodes(emptyDocument('x'), nodes)), ['g'])
  expect(svg).toContain('<rect ')
  expect(svg).toContain('viewBox="-30 -20 220 180"')
  expect(svg).toContain('feDropShadow')
  expect(boundsOf(nodes)?.width).toBe(160)
})

test('resizing a group scales its children; resizing a frame only changes its boundary', () => {
  const children = [
    makeNode('a', 'rect', { parentId: 'g', width: 100, height: 100 }),
    makeNode('b', 'rect', { parentId: 'g', x: 100, width: 100, height: 100 }),
  ]
  const before = model([makeNode('g', 'group', { width: 200, height: 100 }), ...children], ['g'])
  const next = reduce(before, Messages.Patch({ field: 'width', value: '400' }))
  expect(node(next, 'a').width).toBe(200)
  expect(node(next, 'b').x).toBe(200)
  const frame = model([makeNode('g', 'frame', { width: 200, height: 100 }), ...children], ['g'])
  const resized = reduce(frame, Messages.Patch({ field: 'width', value: '400' }))
  expect(node(resized, 'a').width).toBe(100)
  expect(node(resized, 'b').x).toBe(100)
})

test('deleting a container includes locked children and leaves no orphan references', () => {
  const before = model(
    [makeNode('g', 'group'), makeNode('a', 'rect', { parentId: 'g', locked: true })],
    ['g'],
  )
  const deleted = action(before, 'delete')
  expect(currentPage(deleted.document).nodes).toHaveLength(0)
  expect(documentIssue(deleted.document)).toBeNull()
})

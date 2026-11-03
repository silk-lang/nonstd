import { expect, test } from 'bun:test'
import { emptyDocument, makeNode, replaceNodes } from '../src/document'
import { changesSince, restoreChanges } from '../src/storage-changes'

test('small edits journal changed nodes, including undo, and restore over the saved base', () => {
  const a = makeNode('a', 'rect')
  const b = makeNode('b', 'rect')
  const base = replaceNodes(emptyDocument('storage'), [a, b])
  const edited = replaceNodes(base, [{ ...a, x: 100 }, b])
  const delta = changesSince(base, edited)
  expect(delta).toEqual([{ ...a, x: 100 }])
  expect(restoreChanges(base, delta)).toEqual(edited)
  expect(changesSince(edited, base)).toEqual([a])
  expect(restoreChanges(base, changesSince(edited, base))).toEqual(base)
  expect(changesSince(base, base)).toEqual([])
})

test('structural changes checkpoint rather than leaving stale journal entries', () => {
  const a = makeNode('a', 'rect')
  const b = makeNode('b', 'rect')
  const base = replaceNodes(emptyDocument('storage'), [a, b])
  expect(changesSince(null, base)).toBeNull()
  expect(changesSince(base, replaceNodes(base, [b, a]))).toBeNull()
  expect(changesSince(base, replaceNodes(base, [a]))).toBeNull()
  expect(changesSince(base, { ...base, id: 'another' })).toBeNull()
  expect(changesSince(base, { ...base, name: 'renamed' })).toBeNull()
  const many = Array.from({ length: 600 }, (_, i) => makeNode(`n${i}`, 'rect'))
  const large = replaceNodes(base, many)
  expect(
    changesSince(
      large,
      replaceNodes(
        large,
        many.map((n) => Object.assign({}, n, { x: 1 })),
      ),
    ),
  ).toBeNull()
})

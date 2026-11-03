import { expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  NodeSchema,
  emptyDocument,
  makeNode,
  replaceNodes,
  currentPage,
  documentIssue,
} from '../src/document'
import { patch } from '../src/properties'
import { initialModel } from '../src/state'
import { svgDocument } from '../src/svg-export'

test('old documents decode neutral effect defaults and invalid effects are rejected', () => {
  const original = makeNode('a', 'rect')
  const legacy = Object.fromEntries(
    Object.entries(original).filter(
      ([key]: readonly [string, unknown]) =>
        ![
          'layerBlur',
          'backdropBlur',
          'brightness',
          'contrast',
          'saturation',
          'blendMode',
          'innerShadow',
          'innerBlur',
          'innerShadowX',
          'innerShadowY',
        ].includes(key),
    ),
  )
  expect(Schema.decodeUnknownSync(NodeSchema)(legacy)).toEqual(original)
  for (const invalid of [{ layerBlur: -1 }, { saturation: 9 }, { blendMode: 'unknown' }])
    expect(() => Schema.decodeUnknownSync(NodeSchema)({ ...legacy, ...invalid })).toThrow()
})

test('effect edits preserve history and unsupported container effects do not enter the document', () => {
  const base = {
    ...initialModel(replaceNodes(emptyDocument('effects'), [makeNode('a', 'rect')])),
    selection: ['a'],
  }
  const changed = patch(patch(base, 'layerBlur', '12'), 'saturation', '50')
  expect(currentPage(changed.document).nodes[0]).toMatchObject({ layerBlur: 12, saturation: 0.5 })
  expect(currentPage(base.document).nodes[0]?.layerBlur).toBe(0)
  expect(changed.past).toHaveLength(2)
  const invalid = replaceNodes(base.document, [makeNode('g', 'group', { layerBlur: 10 })])
  expect(documentIssue(invalid)).toContain('whole groups')
})

test('vector export preserves supported filters and refuses to silently drop backdrop blur', () => {
  const node = makeNode('a', 'rect', {
    x: 40,
    y: 40,
    width: 80,
    height: 80,
    layerBlur: 8,
    saturation: 0,
    innerShadow: '#00000080',
    blendMode: 'multiply',
  })
  const page = { id: 'page', name: 'Effects', nodes: [node] }
  const svg = svgDocument(page)
  expect(svg).toContain('feGaussianBlur stdDeviation="8"')
  expect(svg).toContain('feColorMatrix')
  expect(svg).toContain('innerMask')
  expect(svg).toContain('mix-blend-mode:multiply')
  expect(svg).toContain('viewBox="16 16 128 128"')
  expect(() => svgDocument({ ...page, nodes: [{ ...node, backdropBlur: 4 }] })).toThrow(
    'Export PNG',
  )
})

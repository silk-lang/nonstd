import { expect, test } from 'bun:test'
import { Schema } from 'effect'
import { challengeCount, challengeCrop } from '../src/challenge-page'
import { documentIssue, emptyDocument, makeNode, NodeSchema } from '../src/document'
import { svgDocument } from '../src/svg-export'

test('100k crops remain distinct at source pixel precision', () => {
  const crops = new Set<string>()
  for (let index = 0; index < challengeCount; index++) {
    const crop = challengeCrop(index)
    const values = [
      Math.round(Math.fround(crop.x) * 1224),
      Math.round(Math.fround(crop.y) * 248),
      Math.round(Math.fround(crop.width) * 1224),
      Math.round(Math.fround(crop.height) * 248),
    ]
    crops.add(values.join(','))
    expect(crop.x + crop.width).toBeLessThanOrEqual(1)
    expect(crop.y + crop.height).toBeLessThanOrEqual(1)
  }
  expect(crops.size).toBe(challengeCount)
})

test('old documents default image fields and crop imports reject out-of-source bounds', () => {
  const node = makeNode('image', 'rect', { image: 'tweet-challenge', imageCrop: challengeCrop(42) })
  const { image, imageCrop, ...old } = node
  expect(image).toBe('tweet-challenge')
  expect(imageCrop).not.toBeNull()
  expect(Schema.decodeSync(NodeSchema)(old).image).toBeNull()
  const doc = {
    ...emptyDocument('test'),
    pages: [
      {
        id: 'page-1',
        name: 'Page',
        nodes: [{ ...node, imageCrop: { x: 0.9, y: 0, width: 0.2, height: 1 } }],
      },
    ],
  }
  expect(documentIssue(doc)).toBe('Image crops must stay within their source.')
})

test('SVG embeds an image source once and keeps per-layer source crops', () => {
  const first = makeNode('a', 'rect', { image: 'tweet-challenge', imageCrop: challengeCrop(42) })
  const second = { ...first, id: 'b', x: 200, imageCrop: challengeCrop(80) }
  const svg = svgDocument({ id: 'page', name: 'Images', nodes: [first, second] })
  expect(svg.match(/<image /gu)).toHaveLength(1)
  expect(svg.match(/<use /gu)).toHaveLength(2)
  expect(svg).toContain('preserveAspectRatio="none"')
})

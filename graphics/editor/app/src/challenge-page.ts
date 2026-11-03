import { makeNode, type Node } from './document'
import { fit, boundsOf } from './geometry'
import type { Model } from './model'
import { markChanged } from './state'
import { naturalText } from './text-layout'
import { tweetSize } from './image-assets'

export const challengeCount = 100_000
export const challengeName = '100k image + text cards'
const words = [
  'now',
  'make',
  '100k',
  'different',
  'boxes',
  'with',
  'images',
  'and',
  'text',
  'inside',
  'zoom',
  'around',
  'in',
  'those',
] as const
const fonts = ['Arial', 'Georgia', 'Courier New'] as const

// Each integer crop is distinct in the original screenshot (not merely in floating-point UVs).
export const challengeCrop = (index: number): NonNullable<Node['imageCrop']> => {
  const x = index % 400
  const y = Math.floor(index / 400) % 125
  const width = 800 - Math.floor(index / 50_000) * 100
  return {
    x: x / tweetSize.width,
    y: y / tweetSize.height,
    width: width / tweetSize.width,
    height: 120 / tweetSize.height,
  }
}

export const challengeNodes = (allocate: () => string): Node[] => {
  const nodes: Node[] = []
  const title = (text: string, y: number, fontSize: number): void => {
    const node = naturalText(
      makeNode(allocate(), 'text', {
        name: text,
        text,
        x: 0,
        y,
        fontSize,
        fontWeight: 700,
        fill: '#263e30',
      }),
    )
    nodes.push({ ...node, width: node.width * 4, height: node.height * 4 })
  }
  title('YOU ASKED. WE ZOOMED.', -5300, 300)
  title('100,000 image + text cards · 300,000 editable layers', -3300, 110)
  title('One tweet. 100k distinct crops. Its words in Arial, Georgia & Courier.', -2500, 80)
  nodes.push(
    makeNode(allocate(), 'rect', {
      name: 'The challenge — original tweet',
      image: 'tweet-challenge',
      x: 0,
      y: -1750,
      width: 7350,
      height: 1489,
      fill: '#ffffff',
    }),
  )

  const layouts = new Map<string, Pick<Node, 'width' | 'height'>>()
  for (let index = 0; index < challengeCount; index++) nodes.push(...card(allocate, layouts, index))
  return nodes
}

const card = (
  allocate: () => string,
  layouts: Map<string, Pick<Node, 'width' | 'height'>>,
  index: number,
): Node[] => {
  const nodes: Node[] = []
  const x = (index % 400) * 80
  const y = Math.floor(index / 400) * 40
  const group = allocate()
  const fontFamily = fonts[index % fonts.length]!
  const text = `${words[index % words.length]} ${words[Math.floor(index / words.length) % words.length]}`
  const name = `Box ${String(index + 1).padStart(6, '0')}`
  nodes.push(
    makeNode(group, 'group', { name, x, y, width: 74, height: 34 }),
    makeNode(allocate(), 'rect', {
      name: `${name} · image crop`,
      parentId: group,
      x,
      y,
      width: 74,
      height: 20,
      image: 'tweet-challenge',
      imageCrop: challengeCrop(index),
      fill: '#ffffff',
    }),
  )
  const label = makeNode(allocate(), 'text', {
    name: `${name} · ${fontFamily}`,
    parentId: group,
    x,
    y: y + 21,
    text,
    fontSize: 7,
    fontFamily,
    fontWeight: 400,
    fill: '#263e30',
  })
  const key = `${fontFamily}:${text}`
  let layout = layouts.get(key)
  if (!layout) {
    const measured = naturalText(label)
    layout = { width: measured.width, height: measured.height }
    layouts.set(key, layout)
  }
  nodes.push({ ...label, ...layout })
  return nodes
}

export const addChallengePage = (m: Model): Model => {
  const existing = m.document.pages.find((page) => page.name === challengeName)
  if (existing)
    return {
      ...m,
      document: { ...m.document, activePageId: existing.id },
      selection: [],
      camera: fit(boundsOf(existing.nodes), m.width, m.height),
    }
  if (m.document.pages.length >= 100)
    return { ...m, notice: 'This document has reached its page limit.' }
  const used = new Set(
    m.document.pages.flatMap((page) => [page.id, ...page.nodes.map((node) => node.id)]),
  )
  let nextId = m.document.nextId
  const allocate = (): string => {
    while (used.has(`n${nextId}`)) nextId++
    const id = `n${nextId++}`
    used.add(id)
    return id
  }
  const id = allocate()
  const nodes = challengeNodes(allocate)
  const page = { id, name: challengeName, nodes }
  const document = { ...m.document, pages: [...m.document.pages, page], activePageId: id, nextId }
  return {
    ...markChanged(m, document),
    selection: [],
    tool: 'select',
    gesture: null,
    editingId: null,
    drafts: {},
    search: '',
    layerScroll: 0,
    camera: fit(boundsOf(nodes), m.width, m.height),
    notice: '100k cards: distinct crops of one screenshot + editable text in three fonts.',
  }
}

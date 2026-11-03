import { emptyDocument, makeNode, type DesignDocument, type Node } from './document'

import { naturalText } from './text-layout'

type Add = (kind: Node['kind'], patch: Partial<Node>) => string
type Title = (
  text: string,
  x: number,
  y: number,
  size: number,
  parentId: string,
  fill?: string,
  width?: number,
  fontFamily?: Node['fontFamily'],
) => void
const introduction = (add: Add, title: Title): void => {
  const a = add('frame', {
    name: '01 / The introduction',
    x: 0,
    y: 0,
    width: 440,
    height: 560,
    fill: '#f7f5ec',
  })
  title('FORM & FIELD', 32, 28, 14, a, '#25352b', 152)
  title('Make room', 30, 110, 56, a, '#25352b', 345, 'Georgia')
  title('for the good.', 30, 175, 56, a, '#25352b', 365, 'Georgia')
  title('Objects for a slower, better everyday.', 32, 265, 15, a, '#687267', 305)
  add('rect', {
    name: 'Explore button',
    parentId: a,
    x: 32,
    y: 322,
    width: 155,
    height: 44,
    radius: 22,
    fill: '#283e30',
  })
  title('Explore collection  ↗', 47, 332, 12, a, '#ffffff', 125)
  introductionFooter(add, title, a)
}
const introductionFooter = (add: Add, title: Title, a: string): void => {
  add('ellipse', {
    name: 'Sun',
    parentId: a,
    x: 292,
    y: 363,
    width: 112,
    height: 112,
    fill: '#e6b84e',
  })
  add('rect', {
    name: 'Ground',
    parentId: a,
    x: 0,
    y: 475,
    width: 440,
    height: 85,
    fill: '#d9dfc8',
  })
  title('LESS, BUT LOVELY.', 32, 510, 11, a, '#25352b', 147)
  title('EST. 2026', 325, 510, 11, a, '#25352b', 80)
}
const perspective = (add: Add, title: Title): void => {
  const b = add('frame', {
    name: '02 / A little perspective',
    x: 500,
    y: 0,
    width: 360,
    height: 360,
    fill: '#2d4535',
  })
  title('A LITTLE PERSPECTIVE', 530, 25, 10, b, '#d3debf', 170)
  title('Good things', 530, 84, 38, b, '#f4f3df', 290, 'Georgia')
  title('take space.', 530, 134, 38, b, '#f4f3df', 275, 'Georgia')
  add('ellipse', {
    name: 'Circle study',
    parentId: b,
    x: 740,
    y: 224,
    width: 84,
    height: 84,
    fill: '#d6dfb5',
  })
  title('Find your everyday ritual.', 530, 282, 12, b, '#d3debf', 191)
}
const palette = (add: Add, title: Title): void => {
  const c = add('frame', {
    name: '03 / Color & character',
    x: 500,
    y: 412,
    width: 360,
    height: 148,
    fill: '#fafaf6',
  })
  title('THE PALETTE', 522, 426, 10, c, '#687267', 107)
  for (const [i, fill] of ['#2d4535', '#d6dfb5', '#e6b84e', '#e3ad90', '#f7f5ec'].entries())
    add('rect', {
      name: `Swatch ${i + 1}`,
      parentId: c,
      x: 522 + i * 64,
      y: 465,
      width: 52,
      height: 52,
      radius: 26,
      fill,
    })
}
export const starterDocument = (): DesignDocument => {
  const nodes: Node[] = []
  let index = 2
  const add = (kind: Node['kind'], patch: Partial<Node>): string => {
    const id = `n${index++}`
    const node = makeNode(id, kind, patch)
    nodes.push(kind === 'text' ? naturalText(node) : node)
    return id
  }
  const title = (
    text: string,
    x: number,
    y: number,
    size: number,
    parentId: string,
    fill = '#25352b',
    width = 300,
    fontFamily: Node['fontFamily'] = 'Arial',
  ): void => {
    add('text', {
      name: text,
      text,
      x,
      y,
      width,
      height: size * 1.5 + 4,
      fontSize: size,
      fontFamily,
      fill,
      parentId,
    })
  }
  introduction(add, title)
  perspective(add, title)
  palette(add, title)
  return {
    ...emptyDocument('starter'),
    name: 'Form & Field',
    pages: [{ id: 'page-1', name: 'Explorations', nodes }],
    nextId: index,
  }
}

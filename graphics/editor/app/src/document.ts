import { Schema } from 'effect'

const coordinate = Schema.Finite.check(
  Schema.isBetween({ minimum: -1_000_000, maximum: 1_000_000 }),
)
const dimension = Schema.Finite.check(Schema.isBetween({ minimum: 0.1, maximum: 100_000 }))
const color = Schema.String.check(Schema.isPattern(/^#[\da-f]{6}([\da-f]{2})?$/iu))
export const KindSchema = Schema.Literals(['rect', 'ellipse', 'text', 'frame', 'group'])
export type Kind = typeof KindSchema.Type
export const NodeSchema = Schema.Struct({
  id: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  kind: KindSchema,
  name: Schema.String,
  x: coordinate,
  y: coordinate,
  width: dimension,
  height: dimension,
  fill: color,
  stroke: color,
  strokeWidth: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
  radius: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 50_000 })),
  opacity: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  shadow: color,
  blur: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
  shadowX: coordinate,
  shadowY: coordinate,
  text: Schema.String.check(Schema.isMaxLength(10_000)),
  fontSize: Schema.Finite.check(Schema.isBetween({ minimum: 1, maximum: 512 })),
  fontFamily: Schema.Literals(['Arial', 'Georgia', 'Courier New']),
  fontWeight: Schema.Literals([400, 500, 600, 700]),
  hidden: Schema.Boolean,
  locked: Schema.Boolean,
})
export type Node = typeof NodeSchema.Type
export const CameraSchema = Schema.Struct({
  x: coordinate,
  y: coordinate,
  zoom: Schema.Finite.check(Schema.isBetween({ minimum: 0.02, maximum: 64 })),
})
export type Camera = typeof CameraSchema.Type
export const PageSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  nodes: Schema.Array(NodeSchema).check(Schema.isMaxLength(200_000)),
})
export type Page = typeof PageSchema.Type
export const DesignDocumentSchema = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  name: Schema.String,
  pages: Schema.Array(PageSchema).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  activePageId: Schema.String,
  nextId: Schema.Int.check(Schema.isGreaterThan(0)),
})
export type DesignDocument = typeof DesignDocumentSchema.Type

export const makeNode = (id: string, kind: Kind, patch: Partial<Node> = {}): Node => ({
  id,
  kind,
  parentId: null,
  name: kind[0]?.toUpperCase() + kind.slice(1),
  x: 0,
  y: 0,
  width: 160,
  height: 120,
  fill: '#b8c5ac',
  stroke: '#222822',
  strokeWidth: 0,
  radius: 0,
  opacity: 1,
  shadow: '#00000000',
  blur: 16,
  shadowX: 0,
  shadowY: 8,
  text: 'Your words here',
  fontSize: 32,
  fontFamily: 'Arial',
  fontWeight: 400,
  hidden: false,
  locked: false,
  ...patch,
})

export const currentPage = (doc: DesignDocument): Page =>
  doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0]!
export const replaceNodes = (doc: DesignDocument, nodes: readonly Node[]): DesignDocument => ({
  ...doc,
  pages: doc.pages.map((p) => (p.id === doc.activePageId ? { ...p, nodes } : p)),
})

/** Structural checks supplement the schema before an imported file can replace a document. */
export const documentIssue = (doc: DesignDocument): string | null => {
  if (!doc.pages.some((p) => p.id === doc.activePageId)) return 'The active page is missing.'
  const ids = new Set<string>()
  for (const page of doc.pages) {
    if (ids.has(page.id)) return 'Page and layer IDs must be unique.'
    ids.add(page.id)
    const nodes = new Map(page.nodes.map((n) => [n.id, n]))
    for (const n of page.nodes) {
      if (ids.has(n.id)) return 'Page and layer IDs must be unique.'
      if (
        (n.kind === 'ellipse' || n.kind === 'text') &&
        (n.strokeWidth > 0 || n.shadow.toLowerCase() !== '#00000000')
      )
        return 'Text and ellipses do not support strokes or shadows in this version.'
      ids.add(n.id)
      const path = new Set([n.id])
      let parent = n.parentId
      while (parent !== null) {
        const ancestor = nodes.get(parent)
        if (!ancestor || (ancestor.kind !== 'frame' && ancestor.kind !== 'group'))
          return 'A layer has an invalid parent.'
        if (path.has(parent)) return 'Layer groups cannot contain cycles.'
        if (path.size >= 64) return 'Layer nesting is limited to 64 levels.'
        path.add(parent)
        parent = ancestor.parentId
      }
    }
  }
  return null
}

export const descendants = (nodes: readonly Node[], ids: readonly string[]): readonly Node[] => {
  const selected = new Set(ids)
  // Documents are not required to store parents before children.
  let changed = true
  while (changed) {
    changed = false
    for (const n of nodes)
      if (n.parentId !== null && selected.has(n.parentId) && !selected.has(n.id)) {
        selected.add(n.id)
        changed = true
      }
  }
  return nodes.filter((n) => selected.has(n.id))
}

export const emptyDocument = (id: string): DesignDocument => ({
  version: 1,
  id,
  name: 'Untitled',
  pages: [{ id: 'page-1', name: 'Page 1', nodes: [] }],
  activePageId: 'page-1',
  nextId: 2,
})

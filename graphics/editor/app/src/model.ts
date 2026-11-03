import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { CameraSchema, DesignDocumentSchema, NodeSchema } from './document'

export const ToolSchema = Schema.Literals(['select', 'frame', 'rect', 'ellipse', 'text', 'hand'])
export type Tool = typeof ToolSchema.Type
export const Point = Schema.Struct({ x: Schema.Finite, y: Schema.Finite })
export const Bounds = Schema.Struct({
  ...Point.fields,
  width: Schema.Finite,
  height: Schema.Finite,
})
export const PointerSchema = Schema.Struct({
  ...Point.fields,
  button: Schema.Int,
  shift: Schema.Boolean,
  alt: Schema.Boolean,
  meta: Schema.Boolean,
  space: Schema.Boolean,
  handle: Schema.String,
})
export type Pointer = typeof PointerSchema.Type
export const GestureSchema = Schema.Struct({
  type: Schema.Literals(['move', 'resize', 'draw', 'marquee', 'pan']),
  start: Point,
  current: Point,
  camera: CameraSchema,
  before: DesignDocumentSchema,
  source: DesignDocumentSchema,
  selection: Schema.Array(Schema.String),
  handle: Schema.String,
  activeId: Schema.NullOr(Schema.String),
})
export type Gesture = typeof GestureSchema.Type
export const ModelSchema = Schema.Struct({
  document: DesignDocumentSchema,
  drafts: Schema.Record(Schema.String, Schema.String),
  camera: CameraSchema,
  width: Schema.Finite,
  height: Schema.Finite,
  selection: Schema.Array(Schema.String),
  tool: ToolSchema,
  gesture: Schema.NullOr(GestureSchema),
  past: Schema.Array(DesignDocumentSchema),
  future: Schema.Array(DesignDocumentSchema),
  revision: Schema.Int,
  savedRevision: Schema.Int,
  ready: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  notice: Schema.String,
  search: Schema.String,
  layerScroll: Schema.Finite,
  menu: Schema.Literals(['none', 'file', 'commands', 'shortcuts', 'documents']),
  commandQuery: Schema.String,
  editingId: Schema.NullOr(Schema.String),
  editingText: Schema.String,
  grid: Schema.Boolean,
  snap: Schema.Boolean,
  panels: Schema.Boolean,
  guideX: Schema.NullOr(Schema.Finite),
  guideY: Schema.NullOr(Schema.Finite),
  clipboard: Schema.Array(NodeSchema),
  collapsed: Schema.Array(Schema.String),
  recent: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, updatedAt: Schema.String }),
  ),
})
export type Model = typeof ModelSchema.Type

export const Messages = defineMessageUnion({
  Ready: {},
  RestoreEmpty: {},
  Failed: { reason: Schema.String },
  Synced: {},
  Loaded: { document: DesignDocumentSchema },
  Saved: { revision: Schema.Int, documentId: Schema.String },
  ListedDocuments: { recent: ModelSchema.fields.recent },
  Resized: { width: Schema.Finite, height: Schema.Finite },
  ChooseTool: { tool: ToolSchema },
  PointerDown: { point: PointerSchema },
  PointerMove: { point: PointerSchema },
  PointerUp: { point: PointerSchema },
  CancelGesture: {},
  DoubleClick: { point: Point },
  Wheel: { ...Point.fields, deltaX: Schema.Finite, deltaY: Schema.Finite, zoom: Schema.Boolean },
  SelectLayer: { id: Schema.String, extend: Schema.Boolean },
  ToggleLayer: { id: Schema.String, flag: Schema.Literals(['hidden', 'locked']) },
  Collapse: { id: Schema.String },
  Draft: { field: Schema.String, value: Schema.String },
  Patch: { field: Schema.String, value: Schema.String },
  RenameDocument: { value: Schema.String },
  RenamePage: { value: Schema.String },
  SelectPage: { id: Schema.String },
  LayerScroll: { top: Schema.Finite },
  ZoomPercent: { value: Schema.Finite },
  Search: { value: Schema.String },
  CommandQuery: { value: Schema.String },
  Action: { action: Schema.String },
  EditText: { value: Schema.String },
  CommitText: {},
  CancelText: {},
  Key: { key: Schema.String, shift: Schema.Boolean, mod: Schema.Boolean, alt: Schema.Boolean },
  OpenDocument: { id: Schema.String },
})
export type Message = typeof Messages.Type

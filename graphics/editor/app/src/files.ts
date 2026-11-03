import { rasterExport } from './raster-export'
import { loadDocument, listDocuments, saveDocument } from './storage'
import { Data, Effect, Schema } from 'effect'
import { Command } from 'foldkit'
import { DesignDocumentSchema, currentPage, documentIssue, emptyDocument } from './document'
import { svgDocument } from './svg-export'
import { Messages, ModelSchema, type Model } from './model'

class FileError extends Data.TaggedError('FileError')<{ readonly message: string }> {}
const fileError = (cause: unknown): FileError =>
  new FileError({ message: cause instanceof Error ? cause.message : String(cause) })
const readDocument = Effect.fn('readDocument')(function* (parsed: unknown) {
  const decoded = yield* Schema.decodeUnknownEffect(DesignDocumentSchema)(parsed).pipe(
    Effect.mapError(
      () => new FileError({ message: 'This file is not a supported Silk Studio document.' }),
    ),
  )
  const issue = documentIssue(decoded)
  if (issue !== null) return yield* new FileError({ message: issue })
  return decoded
})
const readRecent = listDocuments.pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(ModelSchema.fields.recent)),
  Effect.map((recent) =>
    recent.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50),
  ),
  Effect.mapError(fileError),
)
export const ListDocuments = Command.define('ListDocuments', {
  messages: [Messages.ListedDocuments, Messages.Failed],
  execute: readRecent.pipe(
    Effect.map((recent: Model['recent']) => Messages.ListedDocuments({ recent })),
    Effect.match({
      onFailure: (error) => Messages.Failed({ reason: error.message }),
      onSuccess: (message) => message,
    }),
  ),
})
export const SaveDocument = Command.define('SaveDocument', {
  args: { document: DesignDocumentSchema, revision: Schema.Int },
  messages: [Messages.Saved, Messages.Failed],
  execute: ({ document, revision }) =>
    Effect.gen(function* () {
      yield* saveDocument(document)
      return Messages.Saved({ revision, documentId: document.id })
    }).pipe(
      Effect.match({
        onFailure: (error) => Messages.Failed({ reason: error.message }),
        onSuccess: (message) => message,
      }),
    ),
})
export const OpenDocument = Command.define('OpenDocument', {
  args: { id: Schema.String },
  messages: [Messages.Loaded, Messages.RestoreEmpty, Messages.Failed],
  execute: ({ id }) =>
    Effect.gen(function* () {
      const stored = yield* loadDocument(id)
      if (stored === null) {
        if (id.length > 0)
          return yield* new FileError({ message: 'This local document is no longer available.' })
        return Messages.RestoreEmpty()
      }
      const document = yield* readDocument(stored)
      return Messages.Loaded({ document })
    }).pipe(
      Effect.match({
        onFailure: (error) => Messages.Failed({ reason: error.message }),
        onSuccess: (message) => message,
      }),
    ),
})
export const NewDocument = Command.define('NewDocument', {
  messages: [Messages.Loaded],
  execute: Effect.sync(() => Messages.Loaded({ document: emptyDocument(crypto.randomUUID()) })),
})
const download = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
}
const pngBlob = (svg: string) =>
  Effect.acquireUseRelease(
    Effect.sync(() => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))),
    (url) =>
      Effect.tryPromise({
        try: () =>
          new Promise<Blob>((resolve, reject) => {
            const image = new Image()
            image.addEventListener(
              'error',
              () => {
                reject(new FileError({ message: 'The image could not be exported.' }))
              },
              { once: true },
            )
            image.addEventListener(
              'load',
              () => {
                const canvas = document.createElement('canvas')
                const scale = Math.min(2, 8192 / Math.max(image.width, image.height))
                canvas.width = Math.max(1, Math.round(image.width * scale))
                canvas.height = Math.max(1, Math.round(image.height * scale))
                const context = canvas.getContext('2d')
                if (!context) {
                  reject(new FileError({ message: 'Image export is unavailable.' }))
                  return
                }
                context.drawImage(image, 0, 0, canvas.width, canvas.height)
                canvas.toBlob((blob) => {
                  if (blob) resolve(blob)
                  else reject(new FileError({ message: 'The image could not be encoded.' }))
                }, 'image/png')
              },
              { once: true },
            )
            image.src = url
          }),
        catch: fileError,
      }),
    (url) =>
      Effect.sync(() => {
        URL.revokeObjectURL(url)
      }),
  )
const exportImage = (
  document: Model['document'],
  selection: readonly string[],
  format: 'png' | 'svg',
) =>
  Effect.gen(function* () {
    const page = currentPage(document)
    if (
      format === 'png' &&
      page.nodes.some(
        (n) =>
          n.layerBlur > 0 ||
          n.backdropBlur > 0 ||
          n.blendMode !== 'normal' ||
          n.brightness !== 1 ||
          n.contrast !== 1 ||
          n.saturation !== 1 ||
          n.innerShadow !== '#00000000',
      )
    )
      return yield* Effect.tryPromise({
        try: () => rasterExport(page, selection),
        catch: fileError,
      })
    const svg = yield* Effect.try({ try: () => svgDocument(page, selection), catch: fileError })
    return format === 'png' ? yield* pngBlob(svg) : new Blob([svg], { type: 'image/svg+xml' })
  })
export const ExportDocument = Command.define('ExportDocument', {
  args: {
    document: DesignDocumentSchema,
    format: Schema.Literals(['json', 'svg', 'png']),
    selection: Schema.Array(Schema.String),
  },
  messages: [Messages.Synced, Messages.Failed],
  execute: ({ document, format, selection }) =>
    Effect.gen(function* () {
      const name = document.name.replaceAll(/[^\w\s-]/gu, '').trim() || 'Untitled'
      if (format === 'json')
        yield* Effect.sync(() => {
          download(
            new Blob([JSON.stringify(document)], { type: 'application/json' }),
            `${name}.silkdesign`,
          )
        })
      else {
        const blob = yield* exportImage(document, selection, format)
        yield* Effect.sync(() => {
          download(blob, `${name}.${format}`)
        })
      }
      return Messages.Synced()
    }).pipe(
      Effect.match({
        onFailure: (error) => Messages.Failed({ reason: error.message }),
        onSuccess: (message) => message,
      }),
    ),
})
export const ImportDocument = Command.define('ImportDocument', {
  messages: [Messages.Loaded, Messages.Synced, Messages.Failed],
  execute: Effect.gen(function* () {
    const file = yield* Effect.callback<File | null>((resume) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.silkdesign,.json,application/json'
      input.addEventListener(
        'change',
        () => {
          resume(Effect.succeed(input.files?.[0] ?? null))
        },
        {
          once: true,
        },
      )
      input.addEventListener(
        'cancel',
        () => {
          resume(Effect.succeed(null))
        },
        { once: true },
      )
      input.click()
      return Effect.sync(() => {
        input.remove()
      })
    })
    if (!file) return Messages.Synced()
    if (file.size > 64 * 1024 * 1024)
      return yield* new FileError({ message: 'Choose a document smaller than 64 MB.' })
    const text = yield* Effect.tryPromise({ try: () => file.text(), catch: fileError })
    const parsed = yield* Effect.try({ try: () => JSON.parse(text) as unknown, catch: fileError })
    const loaded = yield* readDocument(parsed)
    // Import a local copy so a file cannot silently overwrite an existing document.
    return Messages.Loaded({ document: { ...loaded, id: crypto.randomUUID() } })
  }).pipe(
    Effect.match({
      onFailure: (error) => Messages.Failed({ reason: error.message }),
      onSuccess: (message) => message,
    }),
  ),
})

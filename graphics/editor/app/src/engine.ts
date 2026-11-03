import { registerImages } from './image-assets'
import { Data, Effect, Queue, Stream } from 'effect'
import { Command, Mount } from 'foldkit'
import { Editor } from '../../dist/editor.js'
import wasmUrl from '../../dist/editor.wasm?url'
import { CameraSchema, PageSchema } from './document'
import { CanvasHost } from './canvas-host'
import { CanvasInput, type CanvasMessage } from './canvas-input'
import { Messages } from './model'

class CanvasError extends Data.TaggedError('CanvasError')<{ readonly message: string }> {}
const canvasError = (cause: unknown): CanvasError =>
  new CanvasError({ message: cause instanceof Error ? cause.message : String(cause) })
// Only the imperative GPU handle lives outside the Model. Its lifetime belongs to MountCanvas.
let host: CanvasHost | null = null
export const SyncCanvas = Command.define('SyncCanvas', {
  args: { page: PageSchema, camera: CameraSchema },
  messages: [Messages.Synced, Messages.Failed],
  execute: ({ page, camera }) =>
    Effect.try({
      try: () => {
        host?.sync(page, camera)
        return Messages.Synced()
      },
      catch: canvasError,
    }).pipe(Effect.catch((error) => Effect.succeed(Messages.Failed({ reason: error.message })))),
})
const mount = (element: Element, queue: Queue.Enqueue<CanvasMessage>) => {
  const emit = (message: CanvasMessage): void => {
    Queue.offerUnsafe(queue, message)
  }
  return Effect.gen(function* () {
    if (!(element instanceof HTMLElement))
      return yield* new CanvasError({ message: 'Canvas host is missing.' })
    const canvas = element.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement))
      return yield* new CanvasError({ message: 'Canvas element is missing.' })
    const instance = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => Editor.create({ canvas, wasm: wasmUrl, background: '#e8eae6' }),
        catch: canvasError,
      }).pipe(Effect.map((editor) => new CanvasHost(editor))),
      (resource) =>
        Effect.sync(() => {
          if (host === resource) host = null
          resource.destroy()
        }),
    )
    yield* Effect.tryPromise({ try: () => registerImages(instance.editor), catch: canvasError })
    host = instance
    yield* Effect.acquireRelease(
      Effect.sync(() => new CanvasInput(element, emit)),
      (input) =>
        Effect.sync(() => {
          input.destroy()
        }),
    )
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        instance.editor.on('error', (event) => {
          emit(Messages.Failed({ reason: event.detail.error.message }))
        }),
      ),
      (off) => Effect.sync(off),
    )
    emit(Messages.Ready())
    return yield* Effect.never
  })
}
export const MountCanvas = Mount.defineStream('MountCanvas', {
  messages: [
    Messages.Ready,
    Messages.Failed,
    Messages.Resized,
    Messages.PointerDown,
    Messages.PointerMove,
    Messages.PointerUp,
    Messages.CancelGesture,
    Messages.DoubleClick,
    Messages.Wheel,
    Messages.Key,
    Messages.Action,
  ],
  execute: ({ element }) =>
    Stream.callback<CanvasMessage>((queue) =>
      mount(element, queue).pipe(
        Effect.catch((error) =>
          Effect.sync(() => Queue.offerUnsafe(queue, Messages.Failed({ reason: error.message }))),
        ),
      ),
    ),
})
export const FocusText = Mount.define('FocusText', {
  messages: [Messages.Synced],
  execute: ({ element }) =>
    Effect.sync(() => {
      if (element instanceof HTMLInputElement) {
        element.focus()
        element.select()
      }
      return Messages.Synced()
    }),
})

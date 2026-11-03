import { Effect, Queue, Schema, Stream } from 'effect'
import { Mount } from 'foldkit'
import { Messages } from '../model'

export const LayerClick = Mount.defineStream('LayerClick', {
  args: { id: Schema.String },
  messages: [Messages.SelectLayer],
  execute: ({ element, id }) =>
    Stream.callback<typeof Messages.SelectLayer.Type>((queue) => {
      const click = (event: Event): void => {
        Queue.offerUnsafe(
          queue,
          Messages.SelectLayer({ id, extend: event instanceof MouseEvent && event.shiftKey }),
        )
      }
      return Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            element.addEventListener('click', click)
          }),
          () =>
            Effect.sync(() => {
              element.removeEventListener('click', click)
            }),
        )
        return yield* Effect.never
      })
    }),
})
const focusable = (element: Element): readonly HTMLElement[] => [
  ...element.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]'),
]
const trapFocus = (element: Element, event: KeyboardEvent): void => {
  if (event.key !== 'Tab') return
  const items = focusable(element)
  const first = items[0]
  const last = items.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
export const DialogFocus = Mount.defineStream('DialogFocus', {
  messages: [Messages.Action],
  execute: ({ element }) =>
    Stream.callback<typeof Messages.Action.Type>((queue) => {
      const close = (): void => {
        Queue.offerUnsafe(queue, Messages.Action({ action: 'dismiss' }))
      }
      const key = (event: Event): void => {
        if (!(event instanceof KeyboardEvent)) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
        trapFocus(element, event)
      }
      const backdrop = (event: Event): void => {
        if (event.target === element) close()
      }
      return Effect.gen(function* () {
        const previous = document.activeElement
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            element.addEventListener('keydown', key)
            element.addEventListener('mousedown', backdrop)
            const target = element.querySelector<HTMLInputElement>('input') ?? focusable(element)[0]
            target?.focus()
          }),
          () =>
            Effect.sync(() => {
              element.removeEventListener('keydown', key)
              element.removeEventListener('mousedown', backdrop)
              if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
            }),
        )
        return yield* Effect.never
      })
    }),
})

const preventUnload = (event: BeforeUnloadEvent): void => {
  event.preventDefault()
}
export const SaveGuard = Mount.define('SaveGuard', {
  messages: [Messages.Synced],
  execute: () =>
    Effect.acquireRelease(
      Effect.sync(() => {
        window.addEventListener('beforeunload', preventUnload)
      }),
      () =>
        Effect.sync(() => {
          window.removeEventListener('beforeunload', preventUnload)
        }),
    ).pipe(Effect.as(Messages.Synced())),
})

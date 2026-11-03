import { Data, Effect, Semaphore } from 'effect'
import type { DesignDocument } from './document'

export class StorageError extends Data.TaggedError('StorageError')<{ readonly message: string }> {}
const storageError = (): StorageError =>
  new StorageError({
    message: 'Local storage is unavailable or full. Download a .silk file to keep your work.',
  })
// Serialize commits and reads so a slower write cannot replace a more recent edit.
const access = Semaphore.makeUnsafe(1)
const openDatabase = Effect.tryPromise({
  try: () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('silk-studio', 1)
      request.addEventListener('upgradeneeded', () => {
        const db = request.result
        db.createObjectStore('documents')
        db.createObjectStore('recent')
        db.createObjectStore('metadata')
      })
      request.addEventListener(
        'success',
        () => {
          resolve(request.result)
        },
        { once: true },
      )
      request.addEventListener(
        'error',
        () => {
          reject(storageError())
        },
        { once: true },
      )
      request.addEventListener(
        'blocked',
        () => {
          reject(storageError())
        },
        { once: true },
      )
    }),
  catch: storageError,
})
const withDatabase = <T>(run: (db: IDBDatabase) => Promise<T>) =>
  access.withPermit(
    Effect.acquireUseRelease(
      openDatabase,
      (db) => Effect.tryPromise({ try: () => run(db), catch: storageError }),
      (db) =>
        Effect.sync(() => {
          db.close()
        }),
    ),
  )
const read = (db: IDBDatabase, store: string, key: string | null): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly')
    const objectStore = transaction.objectStore(store)
    const request = key === null ? objectStore.getAll() : objectStore.get(key)
    let value: unknown
    request.addEventListener('success', () => {
      value = request.result
    })
    transaction.addEventListener(
      'complete',
      () => {
        resolve(value)
      },
      { once: true },
    )
    transaction.addEventListener(
      'abort',
      () => {
        reject(storageError())
      },
      { once: true },
    )
    transaction.addEventListener(
      'error',
      () => {
        reject(storageError())
      },
      { once: true },
    )
  })
export const loadDocument = (id: string) =>
  withDatabase(async (db) => {
    const selected: unknown = id || (await read(db, 'metadata', 'current'))
    if (typeof selected !== 'string') return null
    return (await read(db, 'documents', selected)) ?? null
  })
export const listDocuments = withDatabase((db) => read(db, 'recent', null))
export const saveDocument = (document: DesignDocument) =>
  withDatabase(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['documents', 'recent', 'metadata'], 'readwrite')
        transaction.addEventListener(
          'complete',
          () => {
            resolve()
          },
          { once: true },
        )
        transaction.addEventListener(
          'abort',
          () => {
            reject(storageError())
          },
          { once: true },
        )
        transaction.addEventListener(
          'error',
          () => {
            reject(storageError())
          },
          { once: true },
        )
        transaction.objectStore('documents').put(document, document.id)
        transaction
          .objectStore('recent')
          .put(
            { id: document.id, name: document.name, updatedAt: new Date().toISOString() },
            document.id,
          )
        transaction.objectStore('metadata').put(document.id, 'current')
      }),
  )

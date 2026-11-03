import { Data, Effect, Semaphore } from 'effect'
import type { DesignDocument } from './document'
import { changesSince, restoreChanges } from './storage-changes'

export class StorageError extends Data.TaggedError('StorageError')<{ readonly message: string }> {}
const storageError = (): StorageError =>
  new StorageError({
    message: 'Local storage is unavailable or full. Download a .silk file to keep your work.',
  })
// Serialize commits and reads so a slower write cannot replace a more recent edit.
const access = Semaphore.makeUnsafe(1)
let lastSaved: DesignDocument | null = null
const editRange = (id: string): IDBKeyRange => IDBKeyRange.bound([id], [id, []])
const openDatabase = Effect.tryPromise({
  try: () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('silk-studio', 2)
      request.addEventListener('upgradeneeded', () => {
        const db = request.result
        for (const name of ['documents', 'recent', 'metadata', 'edits'])
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
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
const read = (db: IDBDatabase, store: string, key: string | IDBKeyRange | null): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly')
    const objectStore = transaction.objectStore(store)
    const request =
      key === null || key instanceof IDBKeyRange
        ? objectStore.getAll(key ?? undefined)
        : objectStore.get(key)
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
    const stored = await read(db, 'documents', selected)
    if (stored === null || stored === undefined) return null
    return restoreChanges(stored, await read(db, 'edits', editRange(selected)))
  })
export const listDocuments = withDatabase((db) => read(db, 'recent', null))
const recentEntry = (document: DesignDocument) => ({
  id: document.id,
  name: document.name,
  updatedAt: new Date().toISOString(),
})
export const saveDocument = (document: DesignDocument) =>
  withDatabase(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const changes = changesSince(lastSaved, document)
        const transaction = db.transaction(
          ['documents', 'recent', 'metadata', 'edits'],
          'readwrite',
        )
        transaction.addEventListener(
          'complete',
          () => {
            lastSaved = document
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
        try {
          if (changes === null) {
            transaction.objectStore('documents').put(document, document.id)
            transaction.objectStore('edits').delete(editRange(document.id))
          } else
            for (const node of changes)
              transaction.objectStore('edits').put(node, [document.id, node.id])
          transaction.objectStore('recent').put(recentEntry(document), document.id)
          transaction.objectStore('metadata').put(document.id, 'current')
        } catch {
          transaction.abort()
          reject(storageError())
        }
      }),
  )

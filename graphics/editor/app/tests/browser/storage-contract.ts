import { Effect, Exit, Schema } from 'effect'
import {
  DesignDocumentSchema,
  emptyDocument,
  makeNode,
  replaceNodes,
  type DesignDocument,
} from '../../src/document'
import { loadDocument, saveDocument } from '../../src/storage'

const seedLegacy = (document: DesignDocument): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open('silk-studio', 1)
    request.addEventListener('upgradeneeded', () => {
      for (const name of ['documents', 'recent', 'metadata']) request.result.createObjectStore(name)
    })
    request.addEventListener('error', () => {
      reject(new Error('Legacy database setup failed'))
    })
    request.addEventListener('success', () => {
      const db = request.result
      const transaction = db.transaction(['documents', 'metadata'], 'readwrite')
      transaction.objectStore('documents').put(document, document.id)
      transaction.objectStore('metadata').put(document.id, 'current')
      transaction.addEventListener('complete', () => {
        db.close()
        resolve()
      })
      transaction.addEventListener('abort', () => {
        db.close()
        reject(new Error('Legacy transaction failed'))
      })
    })
  })
const read = async (): Promise<DesignDocument> =>
  Schema.decodeUnknownSync(DesignDocumentSchema)(await Effect.runPromise(loadDocument('')))

export const run = async () => {
  const a = makeNode('a', 'rect')
  const b = makeNode('b', 'rect')
  const base = replaceNodes(emptyDocument('journal'), [a, b])
  await seedLegacy(base)
  const migrated = await read()
  await Effect.runPromise(saveDocument(base))
  const edited = replaceNodes(base, [{ ...a, x: 10 }, b])
  await Effect.runPromise(saveDocument(edited))
  const journal = await read()
  const failed = replaceNodes(base, [{ ...a, x: 50 }, b])
  // Preserve the native method to call with the original receiver and restore after injection.
  // oxlint-disable-next-line typescript/unbound-method
  const original = IDBObjectStore.prototype.put
  // Match IndexedDB's native key signature; this wrapper only forwards it.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
    if (this.name === 'recent') throw new DOMException('Full', 'QuotaExceededError')
    return original.call(this, value, key)
  }
  let rejected = false
  try {
    rejected = Exit.isFailure(await Effect.runPromiseExit(saveDocument(failed)))
  } finally {
    IDBObjectStore.prototype.put = original
  }
  const afterFailure = await read()
  await Effect.runPromise(saveDocument(failed))
  const retried = await read()
  await Effect.runPromise(saveDocument(base))
  const undone = await read()
  await Effect.runPromise(saveDocument(replaceNodes(base, [b])))
  const deleted = await read()
  await Effect.runPromise(saveDocument(base))
  const restored = await read()
  return { migrated, journal, rejected, afterFailure, retried, undone, deleted, restored }
}

import { Effect } from 'effect'
import { loadDocument } from '../../src/storage'

// Read through the same snapshot/journal boundary that a real reload uses.
export const readCurrentDocument = (): Promise<unknown> => Effect.runPromise(loadDocument(''))

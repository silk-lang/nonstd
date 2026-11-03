import { currentPage, emptyDocument, makeNode, replaceNodes } from '../src/document'
import { action } from '../src/actions'
import { align, patch } from '../src/properties'
import { duplicate, initialModel } from '../src/state'
import type { Model } from '../src/model'

const count = Number(process.argv[2] ?? 100_000)
if (!Number.isInteger(count) || count < 1 || count > 100_000)
  throw new Error('Expected an element count from 1 to 100000')
const nodes = Array.from({ length: count }, (_, i) =>
  makeNode(`n${i + 2}`, 'rect', {
    x: (i % 400) * 50,
    y: Math.floor(i / 400) * 75,
    width: 48,
    height: 73,
  }),
)
const base = {
  ...initialModel(replaceNodes({ ...emptyDocument('edits'), nextId: count + 2 }, nodes)),
  selection: nodes.map((node) => node.id),
}
const times: Record<string, number> = {}
const measure = (name: string, run: () => Model): Model => {
  const started = performance.now()
  const result = run()
  times[name] = performance.now() - started
  return result
}
const aligned = measure('alignMs', () => align(base, 'left'))
const undone = measure('undoMs', () => action(aligned, 'undo'))
const redone = measure('redoMs', () => action(undone, 'redo'))
const resized = measure('widthMs', () => patch(base, 'width', '80'))
const duplicated = measure('duplicateMs', () => duplicate(base))
if (currentPage(aligned.document).nodes.some((node) => node.x !== 0))
  throw new Error('Alignment changed semantics')
if (
  undone.document !== base.document ||
  redone.document !== aligned.document ||
  redone.selection.length !== count
)
  throw new Error('History did not restore the full document and selection')
if (currentPage(resized.document).nodes.some((node) => node.width !== 80))
  throw new Error('Bulk resizing changed semantics')
if (
  currentPage(duplicated.document).nodes.length !== count * 2 ||
  duplicated.selection.length !== count
)
  throw new Error('Duplication lost nodes or selected roots')
console.log(
  JSON.stringify({
    count,
    ...times,
    workload: 'One cold operation per command; reducer only, no browser or GPU',
  }),
)
if (Object.values(times).some((ms) => ms > 2000))
  throw new Error('A bulk edit exceeded the 2-second CPU regression budget')

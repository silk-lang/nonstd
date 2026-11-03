import { emptyDocument } from '../src/document'
import { down } from '../src/gesture-start'
import { move } from '../src/gesture-move'
import type { Model, Pointer } from '../src/model'
import { addSelectionPage } from '../src/selection-page'
import { initialModel, selectedNodes } from '../src/state'

const point = (x: number, y: number): Pointer => ({
  x,
  y,
  button: 0,
  shift: false,
  alt: false,
  meta: false,
  space: false,
  handle: '',
})
const base: Model = {
  ...addSelectionPage(initialModel(emptyDocument('benchmark'))),
  ready: true,
  camera: { x: -100, y: -100, zoom: 0.02 },
}
let model = down(base, point(0, 0))
const times: number[] = []
let consumed = 0
for (let i = 0; i < 36; i++) {
  const start = performance.now()
  model = move(model, point(100 + (i % 12) * 20, 180 + (i % 12) * 24))
  // The overlay, inspector, and inspector geometry each read the selection.
  for (let reader = 0; reader < 3; reader++) consumed += selectedNodes(model).length
  times.push(performance.now() - start)
}
const sorted = times.slice(6).toSorted((a, b) => a - b)
console.log(
  JSON.stringify({
    count: 100_000,
    selected: model.selection.length,
    medianMs: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    consumed,
    workload:
      '36 marquee moves plus three selection readers per move; first six discarded; no browser or GPU work',
  }),
)

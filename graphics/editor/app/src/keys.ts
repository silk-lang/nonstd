import { type Message, type Model } from './model'
import { action } from './actions'
import { transformSelection } from './state'

const tools: Readonly<Record<string, Model['tool']>> = {
  v: 'select',
  f: 'frame',
  r: 'rect',
  o: 'ellipse',
  t: 'text',
  h: 'hand',
} as const

const escape = (m: Model): Model => {
  if (m.gesture)
    return {
      ...m,
      document: m.gesture.before,
      selection: m.gesture.selection,
      gesture: null,
      guideX: null,
      guideY: null,
    }
  return { ...m, selection: [], editingId: null, menu: 'none', tool: 'select' }
}
export const key = (m: Model, message: Extract<Message, { _tag: 'Key' }>): Model => {
  const k = message.key.toLowerCase()
  if (k === 'escape') return escape(m)
  if (m.gesture !== null) return m
  if (message.mod) {
    const shortcuts: Readonly<Record<string, string>> = {
      z: message.shift ? 'redo' : 'undo',
      y: 'redo',
      d: 'duplicate',
      a: 'select-all',
      c: 'copy',
      x: 'cut',
      v: 'paste',
      g: message.shift ? 'ungroup' : 'group',
      ']': 'front',
      '[': 'back',
      k: 'commands',
    }
    const chosen = shortcuts[k]
    return chosen === undefined ? m : action(m, chosen)
  }
  if (k.startsWith('arrow')) {
    const step = message.shift ? 10 : 1
    return transformSelection(m, (n) => ({
      ...n,
      x: n.x + (k === 'arrowright' ? step : 0) - (k === 'arrowleft' ? step : 0),
      y: n.y + (k === 'arrowdown' ? step : 0) - (k === 'arrowup' ? step : 0),
    }))
  }
  if (k === '1' && message.shift) return action(m, 'fit')
  if (k === '2' && message.shift) return action(m, 'fit-selection')
  if (k === 'delete' || k === 'backspace' || k === '0')
    return action(m, k === '0' ? 'zoom-100' : 'delete')
  if (k === '=' || k === '+') return action(m, 'zoom-in')
  if (k === '-') return action(m, 'zoom-out')
  if (k === '?') return action(m, 'shortcuts')
  if (k === 'tab') return action(m, 'panels')
  const chosenTool = tools[k]
  if (chosenTool !== undefined) return { ...m, tool: chosenTool, editingId: null }
  return m
}

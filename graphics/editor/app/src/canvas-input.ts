import { Messages, type Message, type Pointer } from './model'

export type CanvasMessage = Extract<
  Message,
  {
    _tag:
      | 'Ready'
      | 'Failed'
      | 'Resized'
      | 'PointerDown'
      | 'PointerMove'
      | 'PointerUp'
      | 'CancelGesture'
      | 'DoubleClick'
      | 'Wheel'
      | 'Key'
      | 'Action'
  }
>
export const editable = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('input,textarea,select,[contenteditable=true]') !== null
const plainKeys = new Set(
  'v f r o t h escape delete backspace arrowup arrowdown arrowleft arrowright 1 2 0 + = - ? tab'.split(
    ' ',
  ),
)
const modifiedKeys = new Set('z y d a c x v g k s [ ]'.split(' '))

export class CanvasInput {
  private readonly element: HTMLElement
  private readonly emit: (message: CanvasMessage) => void
  private readonly observer: ResizeObserver
  private activePointer: number | null = null
  private frame = 0
  private pending: Pointer | null = null
  private space = false
  constructor(element: HTMLElement, emit: (message: CanvasMessage) => void) {
    this.element = element
    this.emit = emit
    this.observer = new ResizeObserver(this.resize)
    this.observer.observe(element)
    element.addEventListener('pointerdown', this.pointerDown)
    element.addEventListener('pointermove', this.pointerMove)
    element.addEventListener('pointerup', this.pointerUp)
    element.addEventListener('pointercancel', this.cancel)
    element.addEventListener('lostpointercapture', this.cancel)
    element.addEventListener('wheel', this.wheel, { passive: false })
    element.addEventListener('dblclick', this.doubleClick)
    window.addEventListener('keydown', this.keyDown)
    window.addEventListener('keyup', this.keyUp)
    window.addEventListener('blur', this.cancel)
    this.resize()
  }
  private point(event: PointerEvent): Pointer {
    const rect = this.element.getBoundingClientRect()
    const handle =
      event.target instanceof Element
        ? (event.target.closest('[id^="resize-"]')?.id.slice(7) ?? '')
        : ''
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      button: event.button,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey || event.ctrlKey,
      space: this.space,
      handle,
    }
  }
  private readonly pointerDown = (event: PointerEvent): void => {
    if (editable(event.target) || (event.button !== 0 && event.button !== 1)) return
    event.preventDefault()
    this.element.focus({ preventScroll: true })
    this.activePointer = event.pointerId
    this.element.setPointerCapture(event.pointerId)
    this.emit(Messages.PointerDown({ point: this.point(event) }))
  }
  private readonly pointerMove = (event: PointerEvent): void => {
    if (this.activePointer !== event.pointerId) return
    this.pending = this.point(event)
    if (this.frame === 0)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0
        if (this.pending) this.emit(Messages.PointerMove({ point: this.pending }))
        this.pending = null
      })
  }
  private readonly pointerUp = (event: PointerEvent): void => {
    if (this.activePointer !== event.pointerId) return
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.pending = null
    this.activePointer = null
    this.emit(Messages.PointerUp({ point: this.point(event) }))
    if (this.element.hasPointerCapture(event.pointerId))
      this.element.releasePointerCapture(event.pointerId)
  }
  private readonly cancel = (): void => {
    if (this.activePointer !== null) {
      this.activePointer = null
      cancelAnimationFrame(this.frame)
      this.frame = 0
      this.pending = null
      this.emit(Messages.CancelGesture())
    }
    this.space = false
  }
  private readonly wheel = (event: WheelEvent): void => {
    if (editable(event.target)) return
    event.preventDefault()
    const rect = this.element.getBoundingClientRect()
    let unit = 1
    if (event.deltaMode === 1) unit = 16
    if (event.deltaMode === 2) unit = rect.height
    this.emit(
      Messages.Wheel({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        deltaX: event.deltaX * unit,
        deltaY: event.deltaY * unit,
        zoom: event.ctrlKey || event.metaKey,
      }),
    )
  }
  private readonly doubleClick = (event: MouseEvent): void => {
    if (editable(event.target)) return
    const rect = this.element.getBoundingClientRect()
    this.emit(
      Messages.DoubleClick({
        point: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      }),
    )
  }
  private readonly keyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return
    if (editable(event.target)) {
      if (
        event.key === 'Enter' &&
        event.target instanceof HTMLInputElement &&
        !event.target.classList.contains('canvas-text-input')
      )
        event.target.blur()
      return
    }
    if (
      event.target instanceof Element &&
      event.target.closest('[role="dialog"]') &&
      event.key !== 'Escape'
    )
      return
    const mod = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    if (key === ' ' && !(event.target instanceof Element && event.target.closest('button'))) {
      event.preventDefault()
      this.space = true
      return
    }
    // Preserve keyboard traversal outside the canvas; Tab hides panels only from the canvas.
    if (key === 'tab' && event.target !== this.element) return
    if (!plainKeys.has(key) && !(mod && modifiedKeys.has(key))) return
    event.preventDefault()
    if (mod && key === 's') this.emit(Messages.Action({ action: 'export-json' }))
    else this.emit(Messages.Key({ key: event.key, shift: event.shiftKey, mod, alt: event.altKey }))
  }
  private readonly keyUp = (event: KeyboardEvent): void => {
    if (event.key === ' ') this.space = false
  }
  private readonly resize = (): void => {
    const rect = this.element.getBoundingClientRect()
    this.emit(Messages.Resized({ width: rect.width, height: rect.height }))
  }
  destroy(): void {
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.element.removeEventListener('pointerdown', this.pointerDown)
    this.element.removeEventListener('pointermove', this.pointerMove)
    this.element.removeEventListener('pointerup', this.pointerUp)
    this.element.removeEventListener('pointercancel', this.cancel)
    this.element.removeEventListener('lostpointercapture', this.cancel)
    this.element.removeEventListener('wheel', this.wheel)
    this.element.removeEventListener('dblclick', this.doubleClick)
    window.removeEventListener('keydown', this.keyDown)
    window.removeEventListener('keyup', this.keyUp)
    window.removeEventListener('blur', this.cancel)
  }
}

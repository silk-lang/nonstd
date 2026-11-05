/**
 * harfrust shaping compiled from Silk to WebAssembly.
 *
 * The module keeps no state between calls: every call copies the font and
 * inputs into wasm memory, shapes, and copies the results back out.
 */

export type Direction = 'ltr' | 'rtl' | 'ttb' | 'btt'

export interface ShapeOptions {
  /** HarfBuzz feature strings, such as `-liga`, `ss01` or `kern[3:5]=0`. */
  readonly features?: ReadonlyArray<string>
  /** User-space axis values by tag, such as `{ wght: 650 }`. */
  readonly variations?: Readonly<Record<string, number>>
  /** Guessed from the text when omitted. */
  readonly direction?: Direction
  /** ISO 15924 tag, such as `Arab`. Guessed from the text when omitted. */
  readonly script?: string
  /** BCP 47 tag, such as `ur`. */
  readonly language?: string
  /** Also return each glyph's outline as SVG path data. */
  readonly outlines?: boolean
  /** Also return glyph names. */
  readonly glyphNames?: boolean
}

export interface ShapedGlyph {
  readonly glyphId: number
  /** UTF-8 byte offset of the cluster in the input text. */
  readonly cluster: number
  readonly xAdvance: number
  readonly yAdvance: number
  readonly xOffset: number
  readonly yOffset: number
  /** Present when `glyphNames` was requested and the font names the glyph. */
  readonly name?: string
}

export interface ShapeResult {
  readonly direction: Direction
  /** The resolved ISO 15924 script tag. */
  readonly script: string
  /** Glyphs in visual order, in font units. */
  readonly glyphs: ReadonlyArray<ShapedGlyph>
  /**
   * SVG path data for each glyph id, in font units with y pointing up.
   * Empty when `outlines` was not requested.
   */
  readonly outlines: ReadonlyMap<number, string>
  /** Normalized variation coordinates, one per fvar axis, in [-1, 1]. */
  readonly coordinates: ReadonlyArray<number>
}

export interface Axis {
  readonly tag: string
  readonly min: number
  readonly default: number
  readonly max: number
}

export interface FontInfo {
  readonly unitsPerEm: number
  readonly ascender: number
  readonly descender: number
  readonly lineGap: number
  readonly glyphCount: number
  readonly axes: ReadonlyArray<Axis>
}

export type ErrorCode =
  | 'InvalidFont'
  | 'InvalidText'
  | 'InvalidOption'
  | 'ShapeFailed'
  | 'OutOfMemory'
  | 'Unknown'

export class HarfrustError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode) {
    super(`harfrust: ${code}`)
    this.name = 'HarfrustError'
    this.code = code
  }
}

const errorCodes: ReadonlyArray<ErrorCode> = [
  'Unknown',
  'InvalidFont',
  'InvalidText',
  'InvalidOption',
  'ShapeFailed',
  'OutOfMemory',
]

/** Output kinds the module reports through `host.output`. */
const Output = { Glyphs: 0, Paths: 1, Info: 2, Names: 3, Coordinates: 4 } as const
type Output = (typeof Output)[keyof typeof Output]

const WANT_PATHS = 1
const WANT_NAMES = 2

const directions: ReadonlyArray<Direction> = ['ltr', 'ltr', 'rtl', 'ttb', 'btt']

interface Exports {
  readonly memory: WebAssembly.Memory
  readonly hr_shape: (...args: Array<number>) => number
  readonly hr_font_info: (fontLength: number, faceIndex: number) => number
}

export type WasmSource =
  | BufferSource
  | WebAssembly.Module
  | Response
  | PromiseLike<Response>
  | URL
  | string

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const empty = new Uint8Array(0)

const tagToString = (tag: number): string =>
  String.fromCharCode((tag >>> 24) & 255, (tag >>> 16) & 255, (tag >>> 8) & 255, tag & 255)

const tagToNumber = (tag: string): number => {
  const padded = (tag + '    ').slice(0, 4)
  return (
    ((padded.charCodeAt(0) << 24) |
      (padded.charCodeAt(1) << 16) |
      (padded.charCodeAt(2) << 8) |
      padded.charCodeAt(3)) >>>
    0
  )
}

const round = (value: number): string => {
  const rounded = Math.round(value * 10) / 10
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** Converts the module's path commands to SVG path data. */
const pathData = (commands: Float32Array): string => {
  const parts: Array<string> = []
  let at = 1
  while (at < commands.length) {
    const op = commands[at++]!
    if (op === 0 || op === 1) {
      parts.push(`${op === 0 ? 'M' : 'L'}${round(commands[at]!)} ${round(commands[at + 1]!)}`)
      at += 2
    } else if (op === 2) {
      parts.push(
        `Q${round(commands[at]!)} ${round(commands[at + 1]!)} ${round(commands[at + 2]!)} ${round(commands[at + 3]!)}`,
      )
      at += 4
    } else if (op === 3) {
      parts.push(
        `C${round(commands[at]!)} ${round(commands[at + 1]!)} ${round(commands[at + 2]!)} ${round(commands[at + 3]!)} ${round(commands[at + 4]!)} ${round(commands[at + 5]!)}`,
      )
      at += 6
    } else {
      parts.push('Z')
    }
  }
  return parts.join('')
}

export class Harfrust {
  private inputs: ReadonlyArray<Uint8Array> = []
  private outputs: Array<[Output, Uint8Array]> = []

  private readonly exports: Exports

  private constructor(exports: Exports) {
    this.exports = exports
  }

  /** Instantiates the module from its bytes, a compiled module, a fetch response, or a URL. */
  static async instantiate(source: WasmSource): Promise<Harfrust> {
    let instance: Harfrust | undefined
    const imports = {
      host: {
        input: (slot: number, pointer: number, length: number) => {
          new Uint8Array(instance!.exports.memory.buffer, pointer, length).set(
            instance!.inputs[slot]!.subarray(0, length),
          )
        },
        output: (kind: number, pointer: number, length: number) => {
          instance!.outputs.push([
            kind as Output,
            new Uint8Array(instance!.exports.memory.buffer, pointer, length).slice(),
          ])
        },
      },
      math: { sin: Math.sin, cos: Math.cos, tan: Math.tan, hypot: Math.hypot },
    }
    let module: WebAssembly.Instance
    if (source instanceof WebAssembly.Module) {
      module = await WebAssembly.instantiate(source, imports)
    } else if (ArrayBuffer.isView(source) || source instanceof ArrayBuffer) {
      module = (await WebAssembly.instantiate(source, imports)).instance
    } else {
      const response = await (typeof source === 'string' || source instanceof URL
        ? fetch(source)
        : source)
      module = (await WebAssembly.instantiate(await response.arrayBuffer(), imports)).instance
    }
    instance = new Harfrust(module.exports as unknown as Exports)
    return instance
  }

  /** Reads a font, or one face of a collection. Throws `HarfrustError` for unreadable fonts. */
  font(bytes: Uint8Array, faceIndex = 0): Font {
    const values = this.int32(this.call(Output.Info, [bytes], () =>
      this.exports.hr_font_info(bytes.length, faceIndex),
    ))
    const axes: Array<Axis> = []
    const axisCount = values[5] ?? 0
    for (let i = 0; i < axisCount; i++) {
      const base = 6 + i * 4
      axes.push({
        tag: tagToString(values[base]!),
        min: values[base + 1]! / 65536,
        default: values[base + 2]! / 65536,
        max: values[base + 3]! / 65536,
      })
    }
    const info: FontInfo = {
      unitsPerEm: values[0]!,
      ascender: values[1]!,
      descender: values[2]!,
      lineGap: values[3]!,
      glyphCount: values[4]!,
      axes,
    }
    return new Font(this, bytes, faceIndex, info)
  }

  /** @internal */
  shapeFont(font: Font, text: string, options: ShapeOptions): ShapeResult {
    const variations = Object.entries(options.variations ?? {})
    const variationBytes = new Uint8Array(variations.length * 8)
    const view = new DataView(variationBytes.buffer)
    variations.forEach(([tag, value], index) => {
      view.setUint32(index * 8, tagToNumber(tag), true)
      view.setFloat32(index * 8 + 4, value, true)
    })
    const inputs = [
      font.bytes,
      encoder.encode(text),
      encoder.encode((options.features ?? []).join(',')),
      variationBytes,
      options.direction ? encoder.encode(options.direction) : empty,
      options.script ? encoder.encode(options.script) : empty,
      options.language ? encoder.encode(options.language) : empty,
    ]
    const flags = (options.outlines ? WANT_PATHS : 0) | (options.glyphNames ? WANT_NAMES : 0)
    this.run(inputs, () =>
      this.exports.hr_shape(
        inputs[0]!.length,
        font.faceIndex,
        inputs[1]!.length,
        inputs[2]!.length,
        inputs[3]!.length,
        inputs[4]!.length,
        inputs[5]!.length,
        inputs[6]!.length,
        flags,
      ),
    )
    let records: Int32Array = new Int32Array(0)
    let names: Array<string> = []
    let coordinates: Array<number> = []
    const outlines = new Map<number, string>()
    for (const [kind, bytes] of this.outputs) {
      if (kind === Output.Glyphs) {
        records = this.int32(bytes)
      } else if (kind === Output.Paths) {
        const commands = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
        outlines.set(commands[0]!, pathData(commands))
      } else if (kind === Output.Names) {
        names = decoder.decode(bytes).split('\n')
      } else if (kind === Output.Coordinates) {
        coordinates = Array.from(this.int32(bytes), value => value / 16384)
      }
    }
    this.outputs = []
    const glyphs: Array<ShapedGlyph> = []
    for (let at = 2, index = 0; at + 6 <= records.length; at += 6, index++) {
      const name = names[index]
      glyphs.push({
        glyphId: records[at]!,
        cluster: records[at + 1]!,
        xAdvance: records[at + 2]!,
        yAdvance: records[at + 3]!,
        xOffset: records[at + 4]!,
        yOffset: records[at + 5]!,
        ...(name ? { name } : {}),
      })
    }
    return {
      direction: directions[records[0] ?? 0] ?? 'ltr',
      script: tagToString(records[1] ?? 0),
      glyphs,
      outlines,
      coordinates,
    }
  }

  private int32(bytes: Uint8Array): Int32Array {
    return new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  }

  private run(inputs: ReadonlyArray<Uint8Array>, body: () => number): void {
    this.inputs = inputs
    this.outputs = []
    try {
      const status = body()
      if (status !== 0) {
        this.outputs = []
        throw new HarfrustError(errorCodes[status] ?? 'Unknown')
      }
    } finally {
      this.inputs = []
    }
  }

  private call(kind: Output, inputs: ReadonlyArray<Uint8Array>, body: () => number): Uint8Array {
    this.run(inputs, body)
    const found = this.outputs.find(([outputKind]) => outputKind === kind)
    this.outputs = []
    return found ? found[1] : empty
  }
}

/** A font read by `Harfrust.font`. It keeps a reference to the bytes it was given. */
export class Font {
  private readonly harfrust: Harfrust
  readonly bytes: Uint8Array
  readonly faceIndex: number
  readonly info: FontInfo

  /** @internal */
  constructor(harfrust: Harfrust, bytes: Uint8Array, faceIndex: number, info: FontInfo) {
    this.harfrust = harfrust
    this.bytes = bytes
    this.faceIndex = faceIndex
    this.info = info
  }

  /** Shapes `text`. Throws `HarfrustError` when the options are invalid. */
  shape(text: string, options: ShapeOptions = {}): ShapeResult {
    return this.harfrust.shapeFont(this, text, options)
  }
}

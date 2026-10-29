/** Effect bindings: a `Shaper` service and typed errors around `Harfrust`. */
import { Context, Data, Effect, Layer } from 'effect'

import {
  type ErrorCode,
  type Font,
  Harfrust,
  HarfrustError,
  type ShapeOptions,
  type ShapeResult,
  type WasmSource,
} from './harfrust.ts'

export class ShaperLoadError extends Data.TaggedError('ShaperLoadError')<{
  readonly cause: unknown
}> {}

export class ShapingError extends Data.TaggedError('ShapingError')<{
  readonly code: ErrorCode
}> {}

const toShapingError = (cause: unknown): ShapingError =>
  new ShapingError({ code: cause instanceof HarfrustError ? cause.code : 'Unknown' })

export interface ShaperApi {
  readonly loadFont: (bytes: Uint8Array, faceIndex?: number) => Effect.Effect<Font, ShapingError>
  readonly shape: (
    font: Font,
    text: string,
    options?: ShapeOptions,
  ) => Effect.Effect<ShapeResult, ShapingError>
}

/** Instantiates the module once and wraps its calls as Effects. */
export const makeShaper = (source: WasmSource): Effect.Effect<ShaperApi, ShaperLoadError> =>
  Effect.map(
    Effect.tryPromise({
      try: () => Harfrust.instantiate(source),
      catch: cause => new ShaperLoadError({ cause }),
    }),
    harfrust => ({
      loadFont: (bytes, faceIndex = 0) =>
        Effect.try({ try: () => harfrust.font(bytes, faceIndex), catch: toShapingError }),
      shape: (font, text, options = {}) =>
        Effect.try({ try: () => font.shape(text, options), catch: toShapingError }),
    }),
  )

export class Shaper extends Context.Service<Shaper, ShaperApi>()('harfrust-wasm/Shaper') {
  static readonly layer = (source: WasmSource): Layer.Layer<Shaper, ShaperLoadError> =>
    Layer.effect(Shaper, makeShaper(source))
}

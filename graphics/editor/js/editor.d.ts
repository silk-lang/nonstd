export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';
export const blendModes: readonly BlendMode[];
export type ElementId = number;
export type HexColor = `#${string}`;
export type ElementType = 'rect' | 'ellipse' | 'text';
export interface ElementProperties {
  /** Registered image name for a rectangle. Assets must be registered before load(). */
  image?: string | null;
  /** Normalized source crop; geometry and hit bounds remain unchanged. */
  imageCrop?: Readonly<{ x: number; y: number; width: number; height: number }> | null;
  type?: ElementType; name?: string; x?: number; y?: number; width?: number; height?: number;
  fill?: HexColor; radius?: number; border?: HexColor; borderWidth?: number;
  shadow?: HexColor; blur?: number; shadowX?: number; shadowY?: number;
  /** Opacity of the complete element, 0–1; default 1. */
  opacity?: number;
  /** Gaussian standard deviation in world units; zero disables blur. */
  layerBlur?: number; backdropBlur?: number;
  /** Straight-sRGB multipliers, 0–4; default 1. Applied saturation, brightness, then contrast. */
  brightness?: number; contrast?: number; saturation?: number;
  blendMode?: BlendMode;
  /** Rectangle-only inset shadow; blur is twice the Gaussian standard deviation. */
  innerShadow?: HexColor; innerBlur?: number; innerShadowX?: number; innerShadowY?: number;
  gradient?: Readonly<{ to: HexColor; angle: number }> | null;
  hidden?: boolean; locked?: boolean;
  text?: string; fontSize?: number; fontFamily?: string; fontWeight?: 100|200|300|400|500|600|700|800|900;
}
export type ElementSnapshot = Readonly<Required<ElementProperties> & { id: ElementId }>;
export interface Camera { x: number; y: number; zoom: number }
export interface Viewport extends Camera { width: number; height: number; pixelRatio: number }
export interface RenderStats { buildMs: number; drawMs: number; textMs: number; visible: number; visited: number; batches: number; frames: number }
/** Resource counters and quality limits of text styles and active visible windows. */
export interface EditorDiagnostics {
  gpuHandles: number; wasmBytes: number; destroyed: boolean;
  textRuns: number;
  imageSources: number;
  /** Successful uploads of whole-run and visible-window rasters. */
  textRasterizations: number;
  /** Live native atlas allocations; replacing a raster releases its old allocation. */
  textAtlasTiles: number;
  /** Sum of cached raster areas; GPU textures can retain a larger high-water allocation. */
  textPixels: number;
  /** Fallback styles and active windows whose requested density was capped or could not be allocated. */
  limitedTextRuns: number;
}
export interface EditorDocument { version: 1; elements: ElementProperties[]; viewport?: Camera }
export interface EditorOptions {
  canvas: HTMLCanvasElement; wasm?: string | URL | WebAssembly.Module;
  autoRender?: boolean; pixelRatio?: number; background?: HexColor;
}
export interface EditorEvents {
  change: { ids: ElementId[]; source: 'api'|'transaction'|'undo'|'redo'|'cancel' };
  selectionchange: { ids: ElementId[] };
  viewportchange: Viewport;
  render: Readonly<RenderStats>;
  error: { error: Error };
  destroy: Record<string, never>;
  pointerdown: { point: { x: number; y: number }; originalEvent: PointerEvent };
  pointermove: { point: { x: number; y: number }; originalEvent: PointerEvent };
  transformstart: { ids: ElementId[]; mode: 'drag'|'resize' };
  transform: { ids: ElementId[]; mode: 'drag'|'resize'; dx: number; dy: number };
  transformend: { ids: ElementId[]; mode: 'drag'|'resize'; canceled: boolean };
}
export function rgba(value: HexColor): number;
/** Retained Silk document and WebGPU canvas. Use create(), then destroy() at unmount. */
export class Editor extends EventTarget {
  private constructor();
  static create(options: EditorOptions): Promise<Editor>;
  readonly canvas: HTMLCanvasElement;
  background: HexColor;
  culling: boolean;
  /** Cache image-only scene buffers; disable for rendering comparisons. Default true. */
  retainedImages: boolean;
  readonly stats: Readonly<RenderStats>;
  readonly diagnostics: Readonly<EditorDiagnostics>;
  readonly size: number;
  readonly viewport: Viewport;
  readonly selection: ElementId[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  on<K extends keyof EditorEvents>(type: K, listener: (event: CustomEvent<EditorEvents[K]>) => void): () => void;
  emit<K extends keyof EditorEvents>(type: K, detail: EditorEvents[K]): boolean;
  addCleanup(cleanup: () => void): void;
  get(id: ElementId): ElementSnapshot | undefined;
  elements(): IterableIterator<ElementSnapshot>;
  registerImage(name: string, source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas): void;
  add(properties?: ElementProperties): ElementId;
  rect(properties?: ElementProperties): ElementId;
  ellipse(properties?: ElementProperties): ElementId;
  text(content: string, properties?: ElementProperties): ElementId;
  update(id: ElementId, patch: ElementProperties): void;
  remove(id: ElementId): boolean;
  beginTransaction(): void;
  commitTransaction(): void;
  cancelTransaction(): void;
  batch<T>(fn: (editor: Editor) => T): T;
  undo(): boolean;
  redo(): boolean;
  clearHistory(): void;
  select(ids: ElementId[]): void;
  hitTest(x: number, y: number): ElementId | null;
  screenToWorld(x: number, y: number): { x: number; y: number };
  worldToScreen(x: number, y: number): { x: number; y: number };
  setViewport(patch: Partial<Camera>): void;
  zoomAt(zoom: number, x: number, y: number): void;
  resize(width: number, height: number, pixelRatio?: number): void;
  invalidate(): void;
  render(): Readonly<RenderStats>;
  flush(): Promise<void>;
  toJSON(): EditorDocument;
  load(document: EditorDocument): void;
  destroy(): void;
}

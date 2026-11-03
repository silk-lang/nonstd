import type { Editor } from './editor.js';
/** Installs pointer, keyboard and optional selection overlay behavior. Returns idempotent cleanup. */
export function attachInteractions(editor: Editor, options?: { overlay?: HTMLElement }): () => void;

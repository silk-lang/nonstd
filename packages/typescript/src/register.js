// `node --import silk-typescript/register app.ts` lets Node import .silk files directly.
import { register } from 'node:module'

register('./loader.js', import.meta.url)

// Vite (and Rollup) plugin: `import { add } from './math.silk'` builds the file for wasm32.
import { compileSilkModule } from './build.js'

export default function silk() {
  return {
    name: 'silk',
    async load(id) {
      if (!id.endsWith('.silk')) return null
      this.addWatchFile?.(id)
      return compileSilkModule(id)
    },
  }
}

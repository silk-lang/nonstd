import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss()],
  // Studio restores documents from IndexedDB. Dependency HMR must not serialize
  // the whole canvas and undo history over Vite's socket after each idle period.
  // Application source still receives Vite's normal reloads.
  optimizeDeps: { rolldownOptions: { transform: { define: { 'import.meta.hot': 'undefined' } } } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'esnext' },
})

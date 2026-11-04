import { defineConfig } from 'vite'
import silk from 'silk-typescript/vite'

export default defineConfig({
  plugins: [silk()],
  build: {
    target: 'esnext',
    lib: { entry: 'src/app.ts', formats: ['es'], fileName: 'app' },
  },
})

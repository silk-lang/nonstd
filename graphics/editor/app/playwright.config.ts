import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  testIgnore: '**/performance.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: 'chrome',
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
    launchOptions: { args: ['--enable-unsafe-webgpu'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
  },
})

import { defineConfig } from '@playwright/test'

const externalURL = process.env.SILK_STUDIO_URL

export default defineConfig({
  testDir: './tests/browser',
  testIgnore: '**/*performance.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: externalURL ?? 'http://127.0.0.1:5173',
    channel: 'chrome',
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
    launchOptions: { args: ['--enable-unsafe-webgpu'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer:
    externalURL === undefined
      ? {
          command: 'bun run dev',
          url: 'http://127.0.0.1:5173',
          reuseExistingServer: true,
        }
      : [],
})

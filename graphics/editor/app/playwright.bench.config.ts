import { defineConfig } from '@playwright/test'
import base from './playwright.config'
export default defineConfig({ ...base, testIgnore: [], testMatch: '**/performance.spec.ts' })

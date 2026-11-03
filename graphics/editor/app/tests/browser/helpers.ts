import { expect, type Page } from '@playwright/test'
import { Schema } from 'effect'
import { DesignDocumentSchema, type DesignDocument } from '../../src/document'

export const openStudio = async (page: Page): Promise<void> => {
  await page.goto('/')
  await expect(page.locator('.app-header')).toBeVisible()
  await expect(page.locator('.canvas-loading')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
}
export const savedDocument = async (page: Page): Promise<DesignDocument> => {
  const stored: unknown = await page.evaluate(async () => {
    const reader: unknown = await import(
      new URL('/tests/browser/storage-access.ts', location.href).href
    )
    // This guard must live inside the callback serialized into the browser.
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const isReader = (value: unknown): value is { readonly readCurrentDocument: () => unknown } =>
      typeof value === 'object' &&
      value !== null &&
      'readCurrentDocument' in value &&
      typeof value.readCurrentDocument === 'function'
    if (!isReader(reader)) throw new Error('Storage helper is unavailable')
    return reader.readCurrentDocument()
  })
  return Schema.decodeUnknownSync(DesignDocumentSchema)(stored)
}

export const newDocument = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'File menu', exact: true }).click()
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Document name', exact: true })).toHaveValue(
    'Untitled',
  )
}
export const drawRect = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Rectangle tool', exact: true }).click()
  const box = await page.locator('#canvas-host').boundingBox()
  if (!box) throw new Error('Canvas is missing')
  await page.mouse.move(box.x + 200, box.y + 200)
  await page.mouse.down()
  await page.mouse.move(box.x + 440, box.y + 350, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByRole('spinbutton', { name: 'W', exact: true })).toHaveValue('240')
}
export const setField = async (page: Page, name: string, value: string): Promise<void> => {
  const field = page.getByLabel(name, { exact: true })
  await field.fill(value)
  await field.press('Enter')
}

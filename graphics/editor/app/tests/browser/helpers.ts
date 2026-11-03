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
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('silk-studio', 1)
      request.addEventListener(
        'success',
        () => {
          resolve(request.result)
        },
        { once: true },
      )
      request.addEventListener(
        'error',
        () => {
          reject(new Error('Could not open local documents'))
        },
        {
          once: true,
        },
      )
    })
    const read = (store: string, key: string): Promise<unknown> =>
      new Promise((resolve) => {
        const request = db.transaction(store, 'readonly').objectStore(store).get(key)
        request.addEventListener(
          'success',
          () => {
            resolve(request.result)
          },
          { once: true },
        )
      })
    const id = await read('metadata', 'current')
    const value = typeof id === 'string' ? await read('documents', id) : null
    db.close()
    return value
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

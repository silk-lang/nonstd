import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { Schema } from 'effect'
import { DesignDocumentSchema } from '../../src/document'
import { drawRect, newDocument, openStudio, savedDocument, setField } from './helpers'

const download = async (page: Page, label: string): Promise<Buffer> => {
  await page.getByRole('button', { name: 'File menu', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page
    .getByRole('menu', { name: 'File actions' })
    .getByRole('button', { name: label })
    .click()
  const result = await pending
  if (label === 'Download .silkdesign file') {
    expect(result.suggestedFilename()).toMatch(/\.silkdesign$/u)
  }
  const path = await result.path()
  if (!path) throw new Error('Download did not complete')
  return readFile(path)
}
const importFile = async (page: Page, buffer: Buffer): Promise<void> => {
  await page.getByRole('button', { name: 'File menu', exact: true }).click()
  const pending = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import .silkdesign file…' }).click()
  const chooser = await pending
  await chooser.setFiles({ name: 'roundtrip.silkdesign', mimeType: 'application/json', buffer })
}

test('JSON round-trip preserves the design and imports as an independent local copy', async ({
  page,
}: Readonly<{ page: Page }>) => {
  await openStudio(page)
  await newDocument(page)
  await drawRect(page)
  await setField(page, 'Document name', 'Round trip')
  const bytes = await download(page, 'Download .silkdesign file')
  const exported = Schema.decodeUnknownSync(DesignDocumentSchema)(JSON.parse(bytes.toString()))
  expect(exported.pages[0]?.nodes).toHaveLength(1)
  await newDocument(page)
  await importFile(page, bytes)
  await expect(page.getByLabel('Document name', { exact: true })).toHaveValue('Round trip')
  const imported = await savedDocument(page)
  expect(imported.id).not.toBe(exported.id)
  expect(imported.pages).toEqual(exported.pages)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('SVG and PNG exports include styled geometry and valid image data', async ({
  page,
}: Readonly<{ page: Page }>) => {
  await openStudio(page)
  await newDocument(page)
  await drawRect(page)
  await setField(page, 'Shadow hex', '00000055')
  const svg = (await download(page, 'Export SVG')).toString()
  expect(svg).toContain('<rect ')
  expect(svg).toContain('feDropShadow')
  const png = await download(page, 'Export PNG')
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(png.readUInt32BE(16)).toBeGreaterThan(480)
  expect(png.readUInt32BE(20)).toBeGreaterThan(300)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('invalid imports leave the current document intact', async ({
  page,
}: Readonly<{ page: Page }>) => {
  await openStudio(page)
  const before = await savedDocument(page)
  await importFile(page, Buffer.from('{"version":999}'))
  await expect(page.getByRole('alert')).toContainText('not a supported')
  expect(await savedDocument(page)).toEqual(before)
})

test('storage failures surface an export recovery path', async ({
  page,
}: Readonly<{ page: Page }>) => {
  await openStudio(page)
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('Full', 'QuotaExceededError')
    }
  })
  await setField(page, 'Document name', 'Keep my work')
  await expect(page.getByRole('alert')).toContainText('Download a .silkdesign file')
  const exported = await download(page, 'Download .silkdesign file')
  expect(exported.toString()).toContain('Keep my work')
})

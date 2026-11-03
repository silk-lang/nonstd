import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { openStudio, setField } from './helpers'

test('effects edit, undo, persist and export through the GPU', async ({
  page,
}: Readonly<{ page: Page }>, info) => {
  await openStudio(page)
  await page.getByRole('button', { name: 'Commands · ⌘K', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Add effects playground', exact: true })
    .click()
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Select Frosted glass · edit me', exact: true }).click()
  await setField(page, 'Backdrop blur', '18')
  await expect(page.getByLabel('Backdrop blur', { exact: true })).toHaveValue('18')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Undo · ⌘Z', exact: true }).click()
  await expect(page.getByLabel('Backdrop blur', { exact: true })).toHaveValue('12')
  await page.reload()
  await expect(page.locator('.canvas-loading')).toHaveCount(0)
  await page.getByRole('button', { name: 'Select Frosted glass · edit me', exact: true }).click()
  await expect(page.getByLabel('Backdrop blur', { exact: true })).toHaveValue('12')
  await page.locator('#canvas-host').focus()
  await page.keyboard.press('Escape')
  await page.screenshot({ path: info.outputPath('effects-playground.png') })
  await page.getByRole('button', { name: 'File menu', exact: true }).click()
  const download = page.waitForEvent('download')
  await page
    .getByRole('menu', { name: 'File actions' })
    .getByRole('button', { name: 'Export PNG' })
    .click()
  const result = await download
  await result.saveAs(info.outputPath('effects-export.png'))
  const path = await result.path()
  if (!path) throw new Error('PNG download did not complete')
  const bytes = await readFile(path)
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(bytes.length).toBeGreaterThan(10000)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

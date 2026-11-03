import { expect, test, type Page } from '@playwright/test'
import { currentPage } from '../../src/document'
import { openStudio, savedDocument } from './helpers'

test('@performance align and undo 100k rectangles without hanging the tab', async ({
  page,
}: Readonly<{ page: Page }>, info) => {
  test.setTimeout(90_000)
  await openStudio(page)
  await page.getByRole('button', { name: 'Commands · ⌘K', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Add 100k rectangles', exact: true })
    .click()
  await expect(page.locator('.count-badge')).toHaveText('100002')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  const before = currentPage(await savedDocument(page)).nodes
  await page.locator('#canvas-host').focus()
  await page.keyboard.press('ControlOrMeta+a')
  await expect(page.locator('.statusbar')).toContainText('100002 selected')
  const started = performance.now()
  await page.getByRole('button', { name: 'Align left', exact: true }).click()
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  const alignMs = performance.now() - started
  const aligned = currentPage(await savedDocument(page)).nodes
  const left = Math.min(...before.map((node) => node.x))
  expect(aligned).toHaveLength(100002)
  expect(aligned.every((node) => node.x === left)).toBe(true)
  const undoStarted = performance.now()
  await page.getByRole('button', { name: 'Undo · ⌘Z', exact: true }).click()
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  const undoMs = performance.now() - undoStarted
  expect(currentPage(await savedDocument(page)).nodes).toEqual(before)
  await expect(page.getByRole('alert')).toHaveCount(0)
  const report = {
    count: 100002,
    alignMs,
    undoMs,
    browser: page.context().browser()?.version(),
    dpr: 2,
  }
  await info.attach('edit-benchmark', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  })
  console.log(JSON.stringify(report))
  expect(alignMs).toBeLessThan(5000)
  expect(undoMs).toBeLessThan(5000)
})

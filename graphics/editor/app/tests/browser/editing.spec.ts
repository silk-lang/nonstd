import { expect, test, type Page } from '@playwright/test'
import { drawRect, newDocument, openStudio, savedDocument, setField } from './helpers'

test('draw, style, move, resize, undo and reopen a local document', async ({
  page,
}: Readonly<{ page: Page }>) => {
  await openStudio(page)
  await newDocument(page)
  await drawRect(page)
  await setField(page, 'Layer name', 'Card')
  await setField(page, 'Fill hex', 'E6B84E')
  await setField(page, 'Shadow hex', '00000033')
  await setField(page, 'Radius', '16')
  await setField(page, 'Document name', 'Interaction study')
  const before = await savedDocument(page)
  await page.locator('#canvas-host').focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect
    .poll(async () => (await savedDocument(page)).pages[0]?.nodes[0]?.x)
    .toBe((before.pages[0]?.nodes[0]?.x ?? 0) + 10)
  await page.getByRole('button', { name: 'Undo · ⌘Z', exact: true }).click()
  await expect
    .poll(async () => (await savedDocument(page)).pages[0]?.nodes[0]?.x)
    .toBe(before.pages[0]?.nodes[0]?.x)
  await expect(page.getByLabel('X', { exact: true })).toHaveValue(
    String(before.pages[0]?.nodes[0]?.x),
  )
  const handle = await page.locator('#resize-se').boundingBox()
  if (!handle) throw new Error('Resize handle is missing')
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2 + 30, {
    steps: 5,
  })
  await page.mouse.up()
  await expect(page.getByLabel('W', { exact: true })).toHaveValue('280')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel('Document name', { exact: true })).toHaveValue('Interaction study')
  await page.getByRole('button', { name: 'Select Card', exact: true }).click()
  await expect(page.getByLabel('W', { exact: true })).toHaveValue('280')
  await expect(page.getByLabel('Shadow hex', { exact: true })).toHaveValue('00000033')
})

test('text edits use natural dimensions and commands return focus to the canvas', async ({
  page,
}: Readonly<{ page: Page }>) => {
  await openStudio(page)
  await newDocument(page)
  await page.getByRole('button', { name: 'Text tool', exact: true }).click()
  await page.locator('#canvas-host').click({ position: { x: 200, y: 200 } })
  const input = page.getByLabel('Edit text on canvas')
  await expect(input).toBeFocused()
  await input.fill('A thoughtful tool')
  await input.press('Enter')
  await expect(input).toHaveCount(0)
  await expect(page.getByLabel('Text content', { exact: true })).toHaveValue('A thoughtful tool')
  const before = Number(await page.getByLabel('W', { exact: true }).inputValue())
  await setField(page, 'Size', '64')
  await expect
    .poll(async () => Number(await page.getByLabel('W', { exact: true }).inputValue()))
    .toBeGreaterThan(before * 1.8)
  await page.getByRole('button', { name: 'Commands · ⌘K', exact: true }).click()
  await expect(page.getByLabel('Search commands')).toBeFocused()
  await page.getByLabel('Search commands').fill('duplicate')
  await page.getByRole('button', { name: 'Duplicate selection ⌘D' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(async () => (await savedDocument(page)).pages[0]?.nodes.length).toBe(2)
  await page.locator('#canvas-host').focus()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+g')
  await expect
    .poll(
      async () =>
        (await savedDocument(page)).pages[0]?.nodes.filter((n) => n.kind === 'group').length,
    )
    .toBe(1)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await savedDocument(page)).pages[0]?.nodes.length).toBe(2)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

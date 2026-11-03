import { expect, test, type Page } from '@playwright/test'
import { emptyDocument, makeNode, replaceNodes } from '../../src/document'

const runContract = async (page: Page, module: string): Promise<unknown> => {
  await page.route('**/contract-host', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Isolated contract test</title>',
    }),
  )
  await page.goto('/contract-host')
  return page.evaluate(async (path) => {
    const contract: unknown = await import(new URL(path, location.href).href)
    // The browser serializes this callback, so the guard must remain inside it.
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const isContract = (value: unknown): value is { readonly run: () => unknown } =>
      typeof value === 'object' &&
      value !== null &&
      'run' in value &&
      typeof value.run === 'function'
    if (!isContract(contract)) throw new Error('Contract module is unavailable')
    return contract.run()
  }, `/tests/browser/${module}-contract.ts`)
}

test('storage migrates v1, restores journals, rolls back failed writes and checkpoints deletions', async ({
  page,
}: Readonly<{ page: Page }>) => {
  const a = makeNode('a', 'rect')
  const b = makeNode('b', 'rect')
  const base = replaceNodes(emptyDocument('journal'), [a, b])
  const edited = replaceNodes(base, [{ ...a, x: 10 }, b])
  expect(await runContract(page, 'storage')).toEqual({
    migrated: base,
    journal: edited,
    rejected: true,
    afterFailure: edited,
    retried: replaceNodes(base, [{ ...a, x: 50 }, b]),
    undone: base,
    deleted: replaceNodes(base, [b]),
    restored: base,
  })
})

test('renderer skips unchanged nodes but applies inherited flags, opacity, undo and structural edits', async ({
  page,
}: Readonly<{ page: Page }>) => {
  expect(await runContract(page, 'canvas')).toMatchObject({
    unchangedUpdates: 0,
    singleUpdates: 1,
    inherited: { name: 'Child', fill: '#ff000080', hidden: true, locked: true },
    undone: { name: 'Child', fill: '#ff0000ff', hidden: false, locked: false },
    reordered: ['Other', 'Child'],
    remaining: 1,
  })
})

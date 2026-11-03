import { expect, test, type Page } from '@playwright/test'
import { emptyDocument, makeNode, type DesignDocument } from '../../src/document'
import { openStudio } from './helpers'

const seed = (page: Page, document: DesignDocument): Promise<void> =>
  page.evaluate(async (doc) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('silk-studio')
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
          reject(new Error('Could not seed benchmark'))
        },
        { once: true },
      )
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['documents', 'metadata'], 'readwrite')
      transaction.objectStore('documents').put(doc, doc.id)
      transaction.objectStore('metadata').put(doc.id, 'current')
      transaction.addEventListener(
        'complete',
        () => {
          resolve()
        },
        { once: true },
      )
      transaction.addEventListener(
        'error',
        () => {
          reject(new Error('Could not seed benchmark'))
        },
        { once: true },
      )
    })
    db.close()
  }, document)
const zoomFrames = (page: Page, animate: boolean) =>
  page.evaluate(
    (enabled) =>
      new Promise<readonly number[]>((resolve) => {
        const host = document.querySelector('#canvas-host')
        if (!host) throw new Error('Canvas is missing')
        const box = host.getBoundingClientRect()
        const intervals: number[] = []
        let previous = performance.now()
        let frame = 0
        const tick = (now: number): void => {
          intervals.push(now - previous)
          previous = now
          if (enabled)
            host.dispatchEvent(
              new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                clientX: box.x + box.width / 2,
                clientY: box.y + box.height / 2,
                deltaY: frame < 60 ? 4 : -4,
                ctrlKey: true,
              }),
            )
          frame++
          if (frame < 120) requestAnimationFrame(tick)
          else resolve(intervals)
        }
        requestAnimationFrame(tick)
      }),
    animate,
  )

const textNodes = (count: number) => {
  const nodes = Array.from({ length: count }, (_, i) =>
    makeNode(`n${i + 2}`, 'text', {
      x: (i % 320) * 60,
      y: Math.floor(i / 320) * 24,
      width: 54,
      height: 22,
      fontSize: 12,
      text: `Label ${i % 40}`,
      fill: '#25352b',
    }),
  )
  return nodes
}

for (const count of [10_000, 100_000])
  test(`@performance ${count} text layers at overview`, async ({
    page,
  }: Readonly<{ page: Page }>, info) => {
    test.setTimeout(90_000)
    await openStudio(page)
    const nodes = textNodes(count)
    await seed(page, {
      ...emptyDocument('benchmark'),
      name: `${count} text layers`,
      nextId: count + 2,
      pages: [{ id: 'page-1', name: 'Overview', nodes }],
    })
    const started = Date.now()
    await page.reload()
    await expect(page.locator('.count-badge')).toHaveText(String(count))
    await expect(page.locator('.canvas-loading')).toHaveCount(0)
    await page.getByRole('button', { name: 'Fit all · ⇧1', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await zoomFrames(page, false)
    const settledMs = Date.now() - started
    const intervals = await zoomFrames(page, true)
    const sorted = intervals.toSorted((a, b) => a - b)
    const report = {
      count,
      settledMs,
      medianMs: sorted[Math.floor(sorted.length * 0.5)],
      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
      maxMs: Math.max(...sorted),
      domElements: await page.locator('*').count(),
      browser: page.context().browser()?.version(),
      dpr: 2,
      viewport: '1440×960',
      workload:
        '120 rAF wheel updates, 40 repeated labels; 120 idle warm-up frames; all nodes visible at overview',
    }
    await info.attach('benchmark', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    })
    console.log(JSON.stringify(report))
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

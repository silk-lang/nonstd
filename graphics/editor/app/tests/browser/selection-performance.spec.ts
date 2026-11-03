import { expect, test, type Page } from '@playwright/test'
import { fit } from '../../src/geometry'
import { openStudio } from './helpers'

interface Sweep {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly active: boolean
}
const frameSweep = (page: Page, sweep: Sweep) =>
  page.evaluate(
    (s) =>
      new Promise<
        Readonly<{
          intervals: readonly number[]
          initialIntervals: readonly number[]
          peakSelected: number
          selectionChanges: number
        }>
      >((resolve) => {
        const host = document.querySelector('#canvas-host')
        if (!host) throw new Error('Canvas is missing')
        const intervals: number[] = []
        const counts = new Set<number>()
        let previous = performance.now()
        let frame = 0
        const tick = (now: number): void => {
          intervals.push(now - previous)
          previous = now
          const status = document.querySelector('.statusbar')?.textContent ?? ''
          counts.add(Number(/^([0-9]+) selected/u.exec(status)?.[1] ?? 0))
          const fraction = 0.15 + 0.8 * (0.5 - 0.5 * Math.cos((frame / 119) * Math.PI * 4))
          if (s.active)
            host.dispatchEvent(
              new PointerEvent('pointermove', {
                bubbles: true,
                pointerId: 1,
                buttons: 1,
                clientX: s.left + s.width * fraction,
                clientY: s.top + s.height * fraction,
              }),
            )
          frame++
          if (frame < 120) requestAnimationFrame(tick)
          else
            resolve({
              intervals: intervals.slice(10),
              initialIntervals: intervals.slice(0, 10),
              peakSelected: Math.max(...counts),
              selectionChanges: counts.size,
            })
        }
        requestAnimationFrame(tick)
      }),
    sweep,
  )
const summary = (intervals: readonly number[]) => {
  const sorted = intervals.toSorted((a, b) => a - b)
  return {
    medianMs: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    maxMs: Math.max(...sorted),
    framesOver25Ms: intervals.filter((ms) => ms > 25).length,
  }
}
const coordinates = async (page: Page): Promise<Sweep> => {
  const box = await page.locator('#canvas-host').boundingBox()
  if (!box) throw new Error('Canvas is missing')
  const camera = fit({ x: 0, y: 0, width: 19984, height: 25584 }, box.width, box.height)
  return {
    left: box.x + (-100 - camera.x) * camera.zoom,
    top: box.y + (-100 - camera.y) * camera.zoom,
    width: 20084 * camera.zoom,
    height: 25684 * camera.zoom,
    active: false,
  }
}

const openSelectionPage = async (page: Page): Promise<void> => {
  await openStudio(page)
  await page.getByRole('button', { name: 'Commands · ⌘K', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Add 100k rectangles', exact: true })
    .click()
  await expect(page.locator('.count-badge')).toHaveText('100000')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
}

test('@performance 100k rectangles with live marquee selection', async ({
  page,
}: Readonly<{ page: Page }>, info) => {
  test.setTimeout(90_000)
  await openSelectionPage(page)
  const sweep = await coordinates(page)
  const idle = await frameSweep(page, sweep)
  await page.mouse.move(sweep.left, sweep.top)
  await page.mouse.down()
  const selected = await frameSweep(page, { ...sweep, active: true })
  await expect(page.locator('.marquee')).toBeVisible()
  await expect(page.locator('.selection-box')).toBeVisible()
  // Hold a large gesture idle long enough to exercise development preservation.
  const held = await frameSweep(page, sweep)
  // The final coalesced pointer move may render on the first idle frame.
  expect(held.selectionChanges).toBeLessThanOrEqual(2)
  await expect(page.locator('.marquee')).toBeVisible()
  await expect(page.locator('.statusbar')).toContainText('selected')
  await page.mouse.up()
  await expect(page.locator('.marquee')).toHaveCount(0)
  const timing = summary(selected.intervals)
  const report = {
    count: 100_000,
    idle: summary(idle.intervals),
    selection: timing,
    initialSelection: summary(selected.initialIntervals),
    peakSelected: selected.peakSelected,
    selectionChanges: selected.selectionChanges,
    browser: page.context().browser()?.version(),
    dpr: 2,
    viewport: '1440×960',
    workload:
      '120 idle frames, then 120 pointer moves over two expanding/contracting marquee sweeps; first 10 intervals discarded; all 100k rectangles visible',
  }
  await info.attach('selection-benchmark', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  })
  console.log(JSON.stringify(report))
  expect(selected.peakSelected).toBeGreaterThan(85_000)
  expect(selected.selectionChanges).toBeGreaterThan(40)
  expect(timing.p95Ms).toBeLessThan(Math.max(25, summary(idle.intervals).p95Ms * 1.5))
  await expect(page.getByRole('alert')).toHaveCount(0)
})

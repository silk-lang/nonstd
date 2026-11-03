import { expect, test, type Page } from '@playwright/test'
import { openStudio } from './helpers'

const frames = (page: Page, zoom: boolean) =>
  page.evaluate(
    (active) =>
      new Promise<{ readonly intervals: readonly number[]; readonly zoomValues: number }>(
        (resolve) => {
          const host = document.querySelector('#canvas-host')
          if (!host) throw new Error('Canvas is missing')
          const bounds = host.getBoundingClientRect()
          const intervals: number[] = []
          const zoomValues = new Set<string>()
          let previous = performance.now()
          const tick = (now: number): void => {
            zoomValues.add(
              document.querySelector<HTMLInputElement>('input[aria-label="Zoom percentage"]')
                ?.value ?? '',
            )
            intervals.push(now - previous)
            previous = now
            if (active)
              host.dispatchEvent(
                new WheelEvent('wheel', {
                  bubbles: true,
                  cancelable: true,
                  ctrlKey: true,
                  clientX: bounds.x + bounds.width / 2,
                  clientY: bounds.y + bounds.height / 2,
                  deltaY: intervals.length <= 60 ? -1 : 1,
                }),
              )
            if (intervals.length < 120) requestAnimationFrame(tick)
            else resolve({ intervals: intervals.slice(10), zoomValues: zoomValues.size })
          }
          requestAnimationFrame(tick)
        },
      ),
    zoom,
  )
const summary = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b)
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    maxMs: Math.max(...sorted),
  }
}
test('@performance effects playground zoom', async ({ page }: Readonly<{ page: Page }>, info) => {
  await openStudio(page)
  await page.getByRole('button', { name: 'Commands · ⌘K', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Add effects playground', exact: true })
    .click()
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  const idle = summary((await frames(page, false)).intervals)
  const active = await frames(page, true)
  const zoom = summary(active.intervals)
  expect(active.zoomValues).toBeGreaterThan(5)
  const result = {
    idle,
    zoom,
    browser: page.context().browser()?.version(),
    dpr: 2,
    workload:
      '27-layer effects composition, 120 idle frames then 120 zoom updates; first 10 intervals omitted',
  }
  console.log(JSON.stringify(result))
  await info.attach('effects-benchmark', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  expect(zoom.p95Ms).toBeLessThan(Math.max(35, idle.p95Ms * 1.75))
  await expect(page.getByRole('alert')).toHaveCount(0)
})

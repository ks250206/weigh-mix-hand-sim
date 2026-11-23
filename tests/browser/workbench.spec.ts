import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'

async function ready(page: Page) {
  await page.goto('./')
  await expect(page.getByTestId('workbench')).toHaveAttribute('data-render-status', 'ready', { timeout: 30_000 })
  await expect(page.getByTestId('start-practice')).toBeEnabled()
}

async function pointAtStation(page: Page, id: string) {
  const station = page.locator(`.gb-station[data-station="${id}"]`)
  // Labels appear on hover to keep the bench readable. Aim at the rendered
  // station anchor before using its visible caption; do not change game state.
  const point = await station.evaluate(element => {
    const anchor = new DOMMatrix(getComputedStyle(element).transform)
    const surface = element.closest('.gb-window')!.getBoundingClientRect()
    return { x: surface.x + anchor.m41, y: surface.y + anchor.m42 }
  })
  await page.mouse.move(point.x, point.y)
  await expect(station.locator('span')).toBeVisible()
  await station.locator('span').hover()
  return station
}

test('the production build renders actual equipment, not a blank WebGL canvas', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await ready(page)
  const canvas = page.getByTestId('workbench').locator(':scope > canvas')
  const png = PNG.sync.read(await canvas.screenshot())
  const buckets = new Map<string, number>()
  let pixels = 0
  for (let y = 0; y < png.height; y += 5) {
    for (let x = 0; x < png.width; x += 5) {
      const i = (y * png.width + x) * 4
      const key = `${png.data[i] >> 4}:${png.data[i + 1] >> 4}:${png.data[i + 2] >> 4}`
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
      pixels++
    }
  }
  expect(buckets.size, 'a background with HTML labels is not a rendered experiment').toBeGreaterThan(25)
  expect(Math.max(...buckets.values()) / pixels, 'the entire canvas must not be the clear color').toBeLessThan(0.88)
  expect(errors).toEqual([])
  await page.screenshot({ path: info.outputPath('workbench.png'), fullPage: true })
})

test('practice, pause and resume use the real user controls', async ({ page }) => {
  await ready(page)
  await page.getByTestId('start-practice').click()
  await expect(page.getByTestId('time-readout')).toContainText(/練習|∞|制限なし/)
  await expect(page.getByTestId('hygiene-readout')).toContainText(/清潔|清拭済/)
  await page.getByTestId('pause').click()
  await expect(page.getByTestId('resume')).toBeVisible()
  await page.getByTestId('resume').click()
  await expect(page.getByTestId('resume')).not.toBeVisible()
  await expect(page.getByTestId('action-control')).toBeEnabled()
})

test('timed mode stops while the player is paused', async ({ page }) => {
  await ready(page)
  await page.getByTestId('start-standard').click()
  await page.getByTestId('pause').click()
  const before = await page.getByTestId('time-readout').textContent()
  await page.waitForTimeout(1250)
  expect(await page.getByTestId('time-readout').textContent()).toBe(before)
  await page.getByTestId('resume').click()
  await expect.poll(async () => page.getByTestId('time-readout').textContent(), { timeout: 4000 }).not.toBe(before)
})

test('critical measurements and controls stay visible on a touch screen', async ({ page }, info) => {
  test.skip(info.project.name !== 'touch', 'touch layout only')
  await ready(page)
  await page.getByTestId('start-practice').tap()
  for (const id of ['time-readout', 'anger-readout', 'mass-readout', 'action-control', 'grip-control']) {
    await expect(page.getByTestId(id), id).toBeInViewport()
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  expect(overflow, 'the mobile page must not scroll sideways').toBe(false)
})

test('keyboard holding a focused tilt button remains pressed until keyup', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'keyboard path only')
  await ready(page)
  await page.getByTestId('start-practice').click()
  const right = page.getByTestId('tilt-right')
  await right.focus()
  await page.keyboard.down('Space')
  await expect(right).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.up('Space')
  await expect(right).toHaveAttribute('aria-pressed', 'false')
})

test('a player can pick up, crease twice and reopen a foil through the visible workbench', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'pointer and keyboard workflow')
  await ready(page)
  await page.getByTestId('start-practice').click()
  const sheet = page.locator('.gb-station[data-station="foil"]')
  await sheet.locator('span').click()
  await expect(page.getByTestId('hand-readout')).toContainText('Li₂S 用ホイル')
  await page.locator('.gb-station[data-station="work"] span').click()
  await expect(page.getByTestId('hand-readout')).toContainText('手ぶら')
  for (let count = 1; count <= 2; count++) {
    const start = page.locator('.gb-fold-guide [data-fold-point="start"]')
    const end = page.locator('.gb-fold-guide [data-fold-point="end"]')
    await expect(start).toBeVisible()
    const a = await start.boundingBox()
    const b = await end.boundingBox()
    if (!a || !b) throw new Error('The current crease must have visible endpoints')
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    // The glove deliberately trails the pointer. Wait for the visible glove cursor,
    // rather than moving the simulation directly or replacing the input handlers.
    await expect.poll(async () => {
      const cursor = await page.locator('.gb-cursor').boundingBox()
      return cursor ? Math.hypot(cursor.x + cursor.width / 2 - a.x - a.width / 2,
        cursor.y + cursor.height / 2 - a.y - a.height / 2) : Infinity
    }).toBeLessThan(7)
    await page.keyboard.down('Space')
    await page.waitForTimeout(100)
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
    await expect(sheet).toHaveAttribute('data-fold-count', String(count))
    await page.keyboard.up('Space')
  }
  await expect(sheet).toHaveAttribute('data-unfolded', 'false')
  await expect(page.getByTestId('action-control')).toContainText(/開く|開いて/)
  // Hovering the sheet is movement only; clicking would pick it up.
  await sheet.locator('span').hover()
  await page.waitForTimeout(500)
  await page.keyboard.down('Space')
  await expect(sheet).toHaveAttribute('data-unfolded', 'true')
  await page.keyboard.up('Space')
  await page.screenshot({ path: info.outputPath('opened-foil.png'), fullPage: true })
})

test('a used spatula is wiped with a fresh wipe and must dry before reuse', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'pointer and keyboard workflow')
  await ready(page)
  await page.getByTestId('start-practice').click()
  await pointAtStation(page, 'jarA')
  await expect(page.getByTestId('action-control')).toContainText('開栓')
  await page.keyboard.down('Space')
  await expect(page.getByTestId('action-control')).toContainText('蓋を閉める')
  await page.keyboard.up('Space')
  const spoon = await pointAtStation(page, 'spatula')
  await spoon.locator('span').click()
  await expect(page.getByTestId('hand-readout').locator('strong').first()).toHaveText('スパチュラ')
  await pointAtStation(page, 'jarA')
  await expect(page.getByTestId('action-control')).toContainText('すくう')
  await page.keyboard.down('Space')
  await page.waitForTimeout(300)
  await page.keyboard.down('ArrowDown')
  await page.waitForTimeout(100)
  await page.keyboard.up('ArrowDown')
  await expect(page.getByTestId('hygiene-readout')).toHaveAttribute('data-hygiene', 'dirty')
  await page.keyboard.up('Space')
  await pointAtStation(page, 'cleaner')
  await expect(page.getByTestId('action-control')).toContainText('新しいワイプで清拭')
  await page.keyboard.down('Space')
  await expect(page.getByTestId('hygiene-readout')).toHaveAttribute('data-hygiene', 'wet')
  await page.keyboard.up('Space')
  await expect(page.getByTestId('action-control')).toContainText('乾燥を待つ')
  await expect(page.getByTestId('hygiene-readout')).toHaveAttribute('data-hygiene', 'clean')
  await page.screenshot({ path: info.outputPath('cleaned-spatula.png'), fullPage: true })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultGraphics, loadGraphics, saveGraphics } from './graphics.ts'

test('graphics defaults fit desktop, high-density displays and touch devices', t => {
  const browser = { innerWidth: 1366, devicePixelRatio: 1, matchMedia: () => ({ matches: false }) }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser })
  t.after(() => Reflect.deleteProperty(globalThis, 'window'))
  assert.deepEqual(defaultGraphics(), { resolution: 1, fps: 60, shadows: true, particles: 'normal', antialiasing: 'off', showFps: false })
  browser.devicePixelRatio = 3
  assert.equal(defaultGraphics().resolution, 1.5)
  browser.matchMedia = () => ({ matches: true })
  assert.deepEqual(defaultGraphics(), { resolution: 1, fps: 30, shadows: false, particles: 'low', antialiasing: 'off', showFps: false })
  browser.matchMedia = () => ({ matches: false })
  browser.innerWidth = 390
  assert.equal(defaultGraphics().fps, 30)
})

test('graphics settings persist, validate individual fields, reset and tolerate unavailable storage', t => {
  const data = new Map<string, string>()
  const browser = {
    innerWidth: 1200,
    localStorage: { getItem: (key: string) => data.get(key), setItem: (key: string, raw: string) => data.set(key, raw) },
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser })
  t.after(() => Reflect.deleteProperty(globalThis, 'window'))
  const settings = { resolution: 2, fps: 30, particles: 'high', shadows: false, antialiasing: 'fxaa', showFps: true } as const
  saveGraphics(settings)
  assert.deepEqual(loadGraphics(), settings)
  const key = [...data.keys()][0]
  assert.match(key, /\.v1$/)
  // v1 records written before the overlay and FXAA options remain usable.
  const older = { resolution: 0.75, fps: 30, particles: 'high', shadows: false }
  data.set(key, JSON.stringify(older))
  assert.deepEqual(loadGraphics(), { ...older, antialiasing: 'off', showFps: false })
  data.set(key, JSON.stringify({ ...older, antialiasing: 'broken', showFps: 'yes' }))
  assert.deepEqual(loadGraphics(), { ...older, antialiasing: 'off', showFps: false })
  data.set(key, JSON.stringify({ ...settings, resolution: '2', fps: 24 }))
  assert.deepEqual(loadGraphics(), { ...settings, resolution: 1, fps: 60 })
  for (const raw of ['{', 'null', '[]']) {
    data.set(key, raw)
    assert.deepEqual(loadGraphics(), defaultGraphics())
  }
  saveGraphics(settings)
  saveGraphics(defaultGraphics())
  assert.deepEqual(loadGraphics(), defaultGraphics())
  Object.defineProperty(browser, 'localStorage', { get() { throw new Error('blocked') } })
  assert.doesNotThrow(() => saveGraphics(settings))
  assert.deepEqual(loadGraphics(), defaultGraphics())
})

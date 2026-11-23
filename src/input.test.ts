import assert from 'node:assert/strict'
import test from 'node:test'
import { Controls, defaultBindings, validBindings } from './input.ts'

test('a held keyboard button remains active across frames until its key is released', () => {
  const controls = new Controls()
  controls.press('action', 'key:Space')
  for (let frame = 0; frame < 60; frame++) assert.equal(controls.sample(new Set()).action, true)
  controls.release('key:Space')
  assert.equal(controls.sample(new Set()).action, false)
})

test('one pour button combines flow and a gentle tilt without a third touch', () => {
  const controls = new Controls()
  controls.press('pour', 'pointer:4')
  assert.deepEqual(controls.sample(new Set()), { action: true, tilt: 0.55, support: false, discard: false })
  controls.press('support', 'pointer:8')
  controls.release('pointer:4')
  assert.deepEqual(controls.sample(new Set()), { action: false, tilt: 0, support: true, discard: false })
})

test('releasing one input does not release another and pause clears every latch', () => {
  const controls = new Controls()
  controls.press('action', 'pointer:1')
  controls.press('action', 'key:Enter')
  controls.release('pointer:1')
  assert.equal(controls.sample(new Set()).action, true)
  controls.toggle('left')
  controls.toggle('right')
  assert.equal(controls.sample(new Set()).tilt, 1)
  controls.clear()
  assert.deepEqual(controls.sample(new Set()), { action: false, tilt: 0, support: false, discard: false })
})

test('custom keys survive validation while conflicting and reserved bindings are rejected', () => {
  const custom = { ...defaultBindings, action: 'KeyJ', grip: 'KeyK' }
  assert.deepEqual(validBindings(custom), custom)
  assert.deepEqual(validBindings({ ...custom, action: 'Escape' }), { ...custom, action: 'Space' })
  assert.deepEqual(validBindings({ ...defaultBindings, action: 'KeyF', grip: 'KeyF' }), defaultBindings)
  const controls = new Controls()
  assert.equal(controls.sample(new Set(['KeyJ']), custom).action, true)
  assert.equal(controls.sample(new Set(['Space']), custom).action, false)
})

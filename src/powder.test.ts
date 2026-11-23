import assert from 'node:assert/strict'
import test from 'node:test'
import { caughtFraction, MAX_MOVING_GRAINS, MAX_SPILL_DOTS, PowderPhysics } from './powder.ts'
import type { PowderTransfer } from './contract.ts'

const event = (id: number, to: PowderTransfer['to'] = null): PowderTransfer => ({
  id, from: 'spatula', to, kind: 'a', grams: 0.35, x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5,
})

test('centered streams land, the rim splits their mass, and sideways momentum can carry them past the receiver', () => {
  assert.equal(caughtFraction(0, 0, 0, 0, 0.4, 0.5), 1)
  const partial = caughtFraction(0.4, 0, 0, 0, 0.4, 0.5)
  assert.ok(partial > 0 && partial < 1)
  assert.equal(caughtFraction(0.4, 0, 3, 0, 0.4, 0.5), 0)
})

test('spilled grains fall under gravity, collide with the bench, and settle into a bounded static residue', () => {
  const world = new PowderPhysics()
  const drops = Array.from({ length: 24 }, (_, i) => event(i + 1))
  world.advance(drops, drops.length, 0)
  assert.equal(world.moving.length, MAX_MOVING_GRAINS)
  const original = world.moving.at(-1)!
  const height = original.y
  for (let i = 0; i < 12; i++) world.advance(drops, drops.length, 1 / 60)
  assert.ok(original.y < height)
  let minHeight = original.y
  for (let i = 0; i < 140; i++) {
    world.advance(drops, drops.length, 1 / 60)
    for (const grain of world.moving) minHeight = Math.min(minHeight, grain.y)
  }
  assert.ok(minHeight > -0.01)
  assert.equal(world.moving.length, 0)
  assert.equal(world.residue.length, MAX_SPILL_DOTS)
  world.advance([], 0, 1 / 60)
  assert.equal(world.residue.length, 0)
})

test('a caught stream collides above the bench, then joins the vessel powder without leaving spill residue', () => {
  const world = new PowderPhysics()
  const pour = event(1, 'foil')
  let low = Infinity
  for (let i = 0; i < 100; i++) {
    world.advance([pour], 1, 1 / 60)
    for (const grain of world.moving) low = Math.min(low, grain.y)
  }
  assert.ok(low > 0.60 && low < 0.67, 'grains rest on the opened foil above the pan')
  assert.equal(world.moving.length, 0)
  assert.equal(world.residue.length, 0)
})

test('particle velocity follows the recorded pouring motion rather than seeking its receiver', () => {
  for (const targetX of [0.25, 0.75]) {
    const world = new PowderPhysics()
    const transfer: PowderTransfer = {
      ...event(1, 'mortar'), targetX,
      trajectory: { height: 1.2, vx: 0.8, vz: -0.3, targetHeight: 0.36 },
    }
    world.advance([transfer], 1, 0)
    assert.ok(world.moving.length > 0)
    for (const grain of world.moving) {
      assert.ok(Math.abs(grain.body.velocity.x - 0.8 * 100 / 60) < 1e-6)
      assert.equal(grain.dz, -0.3)
    }
  }
})

test('a full particle budget does not erase grains that are already in flight', () => {
  const world = new PowderPhysics()
  const transfers = Array.from({ length: 20 }, (_, i) => event(i + 1))
  world.advance(transfers, 20, 0)
  const first = world.moving[0]
  assert.equal(world.moving.length, MAX_MOVING_GRAINS)
  world.advance([...transfers, event(21)], 21, 0)
  assert.equal(world.moving[0], first)
})

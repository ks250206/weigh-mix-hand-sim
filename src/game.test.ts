import assert from 'node:assert/strict'
import test from 'node:test'
import { createGame, startGame, stepGame } from './game.ts'
import type { GameInput, ObjectId, Station } from './contract.ts'

// The driver sends the same inputs as the UI. All positions, masses and stage changes come from the simulation.
function bench() {
  const s = startGame()
  let aim = { x: s.hand.x, y: s.hand.y }
  function frame(seconds: number, buttons: Partial<GameInput> = {}) {
    stepGame(s, { targetX: aim.x, targetY: aim.y, gripPressed: false, action: false, tilt: 0, ...buttons }, seconds)
    const inventory = Object.values(s.objects).reduce((n, o) => n + o.a + o.b, s.spilled)
    assert.ok(Math.abs(inventory - 20) < 1e-7, `powder ledger: ${inventory}`)
  }
  function to(target: ObjectId | Station) {
    const dest = typeof target === 'string' ? s.objects[target] : target
    const from = aim
    const n = Math.max(1, Math.ceil(Math.hypot(dest.x - from.x, dest.y - from.y) / 0.035))
    const end = { x: dest.x, y: dest.y }
    for (let i = 1; i <= n; i++) {
      aim = { x: from.x + (end.x - from.x) * i / n, y: from.y + (end.y - from.y) * i / n }
      frame(0.05)
    }
    frame(0.55)
  }
  function grip() { frame(1 / 60, { gripPressed: true }) }
  function take(id: ObjectId) { to(id); grip(); assert.equal(s.hand.held, id) }
  function act(seconds = 1.1) { frame(seconds, { action: true }) }
  function pour(seconds = 2.3) { frame(seconds, { action: true, tilt: 1 }) }
  function weigh(jar: 'jarA' | 'jarB') {
    const stage = s.stage
    take('spatula')
    for (let i = 0; i < 4 && s.stage === stage; i++) {
      to(jar); act(); to('scale'); pour()
    }
    assert.equal(s.stage, stage + 1, 'weighing should finish')
    take('foil'); to('mortar'); pour()
  }
  function loadMortar() {
    to('foil'); act(); take('foil'); to('scale'); grip()
    to('jarA'); act(); weigh('jarA')
    to('jarB'); act(); weigh('jarB')
    assert.equal(s.stage, 8)
  }
  function grind() {
    take('pestle'); to('mortar'); act(2)
    const before = s.mixed
    act(2)
    assert.ok(s.mixed < before + 0.001, 'a stationary hand cannot grind')
    const m = s.objects.mortar
    for (let i = 0; i < 360 && s.stage === 8; i++) {
      aim = { x: m.x + 0.066 * Math.cos(i / 10), y: m.y + 0.066 * Math.sin(i / 10) }
      act(1 / 40)
    }
    assert.equal(s.mixed, 100)
  }
  function rollup() { take('mortar'); to('foil2'); pour() }
  function bottle() { take('foil2'); to('vial'); pour() }
  function cap() { take('cap'); to('vial'); act() }
  return { s, frame, to, take, grip, act, pour, weigh, loadMortar, grind, rollup, bottle, cap }
}

test('normal inputs complete every stage with the correct recipe and a sealed sample', () => {
  const b = bench()
  assert.equal(createGame().status, 'title')
  b.loadMortar()
  assert.ok(Math.abs(b.s.objects.mortar.a - 1.2) < 1e-7)
  assert.ok(Math.abs(b.s.objects.mortar.b - 0.8) < 1e-7)
  b.cap()
  assert.equal(b.s.objects.vial.open, true)
  assert.equal(b.s.stage, 8)
  b.grip(); b.grind(); b.to('foil2'); b.act(); b.rollup(); b.bottle(); b.cap()
  assert.equal(b.s.status, 'won')
  assert.equal(b.s.objects.vial.open, false)
  assert.ok(b.s.recovery > 99.99)
  assert.equal(b.s.spilled, 0)
  assert.ok(b.s.score > 0)
})

test('a loss during final bottling requires replacing both missing components and mixing before sealing', () => {
  const b = bench()
  b.loadMortar(); b.grind(); b.to('foil2'); b.act(); b.rollup()
  b.take('foil2'); b.to({ x: 0.52, y: 0.87 }); b.pour(1.4)
  assert.ok(b.s.spilled > 0.3)
  b.to('vial'); b.pour()
  assert.equal(b.s.stage, 3)
  const saved = b.s.vialMass
  assert.ok(saved > 0 && saved < 1.8)
  b.cap(); assert.equal(b.s.status, 'playing'); b.grip()
  b.weigh('jarA'); b.weigh('jarB'); assert.equal(b.s.vialMass, saved)
  b.grind(); b.rollup(); b.bottle(); b.cap()
  assert.equal(b.s.status, 'won')
  assert.ok(Math.abs(b.s.vialMass - 2) < 1e-7)
})

test('an impact topples a jar, debounces anger and lets the player stand it back up', () => {
  const b = bench()
  b.to({ x: 0.01, y: 0.25 })
  b.frame(0.6, { targetX: 0.96, targetY: 0.25 })
  assert.equal(b.s.objects.jarA.toppled, true)
  assert.equal(b.s.anger, 6)
  b.to('jarA'); b.grip()
  assert.equal(b.s.objects.jarA.toppled, false)
  assert.equal(b.s.hand.held, null)
})

test('the six-minute timeout freezes the game and restart creates a clean bench', () => {
  const b = bench()
  b.frame(360)
  assert.equal(b.s.status, 'lost')
  assert.equal(b.s.remaining, 0)
  const final = structuredClone(b.s)
  b.frame(1, { action: true, gripPressed: true })
  assert.deepEqual(b.s, final)
  assert.equal(startGame().remaining, 360)
})

test('fast tilted transport spills exposed powder without a pour action', () => {
  const b = bench()
  b.to('foil'); b.act(); b.take('foil'); b.to('scale'); b.grip()
  b.to('jarA'); b.act(); b.take('spatula'); b.to('jarA'); b.act()
  b.frame(0.5, { tilt: -1 })
  const before = b.s.objects.spatula.a
  b.frame(0.5, { targetX: 0.48, targetY: 0.95, tilt: -1 })
  assert.ok(b.s.spilled > 0)
  assert.ok(b.s.objects.spatula.a < before)
  assert.ok(b.s.anger > 0)
})

test('grinding requires a pestle moving inside the mortar', () => {
  const b = bench()
  b.loadMortar()
  const m = b.s.objects.mortar
  for (let i = 0; i < 10; i++) {
    b.frame(0.2, { action: true, targetX: m.x + (i % 2 ? 0.06 : -0.06), targetY: m.y })
  }
  assert.equal(b.s.mixed, 0)
  b.take('pestle')
  for (let i = 0; i < 10; i++) {
    b.frame(0.2, { action: true, targetX: 0.45 + (i % 2 ? 0.06 : -0.06), targetY: 0.8 })
  }
  assert.equal(b.s.mixed, 0)
})

test('repeated collisions can exhaust the professor’s patience without expiring the timer', () => {
  const b = bench()
  for (let i = 0; i < 17; i++) {
    b.to({ x: 0.01, y: 0.25 })
    b.frame(0.6, { targetX: 0.96, targetY: 0.25 })
    if (b.s.status === 'lost') break
    b.to('jarA'); b.grip()
  }
  assert.equal(b.s.anger, 100)
  assert.equal(b.s.status, 'lost')
  assert.ok(b.s.remaining > 0)
})

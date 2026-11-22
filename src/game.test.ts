import assert from 'node:assert/strict'
import test from 'node:test'
import { createGame, startGame, stepGame } from './game.ts'
import {
  bottles,
  foilWeight,
  foldStroke,
  weighFoils,
  toolHandle,
  MIX,
  type FoilId,
  HOME,
  mass,
  powders,
  recipe,
  workPositions,
  type GameInput,
  type ObjectId,
  type Powder,
  type Station,
} from './contract.ts'

function bench() {
  const s = startGame()
  let aim = { x: s.hand.x, y: s.hand.y }
  function frame(seconds: number, buttons: Partial<GameInput> = {}) {
    stepGame(
      s,
      { targetX: aim.x, targetY: aim.y, action: false, gripPressed: false, tilt: 0, ...buttons },
      seconds,
    )
    for (const p of powders) {
      const inventory = Object.values(s.objects).reduce((sum, o) => sum + o[p], s.spilledMass[p])
      assert.ok(Math.abs(inventory - 5) < 1e-7, p + ' inventory = ' + inventory)
    }
  }
  function to(target: ObjectId | Station) {
    const dest = typeof target === 'string' ? s.objects[target] : target
    const a = { ...aim },
      b = { x: dest.x, y: dest.y }
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.035))
    for (let i = 1; i <= steps; i++) {
      aim = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }
      frame(0.045)
    }
    frame(0.43)
  }
  function grip() {
    frame(0.02, { gripPressed: true })
  }
  function take(id: ObjectId) {
    assert.equal(s.hand.held, null)
    to(id)
    grip()
    assert.equal(s.hand.held, id, 'grab ' + id)
  }
  function setDown(at: Station | ObjectId) {
    to(at)
    grip()
    assert.equal(s.hand.held, null)
  }
  function door(open: boolean) {
    to('scale')
    if (s.objects.scale.open !== open) frame(0.02, { doorPressed: true })
    assert.equal(s.objects.scale.open, open)
  }
  function act(seconds = 1) {
    frame(seconds, { action: true })
  }
  function pour(seconds = 2) {
    frame(seconds, { action: true, tilt: 1 })
  }
  function foldSheet(id: FoilId, cornerToCorner = false) {
    const sheet = s.objects[id]
    const stage = s.stage
    to(id)
    act()
    assert.equal(sheet.foldCount, 0, 'holding action still cannot crease the sheet')
    for (const count of [0, 1]) {
      const ends = foldStroke(sheet, cornerToCorner)
      const [start, finish] = count === 0 ? ends : ends.reverse()
      to(start)
      act(0.1)
      aim = finish
      act(0.6)
      assert.equal(sheet.foldCount, count + 1, id + ' crease ' + (count + 1))
      assert.equal(sheet.folded, count === 1)
      assert.equal(s.stage, stage + count)
    }
  }
  function prepareFoil(p: Powder) {
    const id = weighFoils[p]
    if (s.hand.held) {
      assert.ok(s.objects[s.hand.held].spent)
      grip()
      assert.equal(s.hand.held, null)
    }
    const stage = s.stage
    take(id)
    setDown(workPositions[id])
    foldSheet(id)
    assert.equal(s.stage, stage + 1)
    take(id)
    door(false)
    grip()
    assert.equal(s.hand.held, id, 'closed sash prevents putting foil in')
    door(true)
    setDown('scale')
    assert.equal(s.stage, stage + 2)
    assert.ok(Math.abs(s.scaleMass - foilWeight) < 1e-8)
    act()
    assert.equal(s.tared, false)
    door(false)
    grip()
    assert.equal(s.hand.held, null, 'closed sash prevents picking foil up')
    act()
    assert.equal(s.tared, true)
    assert.equal(s.scaleMass, 0)
  }
  function setup() {
    prepareFoil('a')
    take('mortar')
    setDown(workPositions.mortar)
  }
  function scoop(p: Powder) {
    const jar = s.objects[bottles[p]]
    to({ x: jar.x, y: jar.y - 0.03 })
    act(0.75)
    const before = mass(s.objects.spatula)
    act(0.4)
    assert.ok(Math.abs(mass(s.objects.spatula) - before) < 0.0001, 'stationary blade')
    aim = { x: jar.x, y: jar.y + 0.051 }
    act(0.55)
    assert.ok(mass(s.objects.spatula) > before, 'physical scoop stroke')
    frame(0.18)
  }
  function weigh(p: Powder) {
    const id = weighFoils[p]
    if (s.stage % 7 === 0) prepareFoil(p)
    const jar = bottles[p]
    if (!s.objects[jar].open) {
      take(jar)
      setDown(workPositions[jar])
      act()
    }
    const stage = s.stage
    door(true)
    take('spatula')
    for (let i = 0; i < 4 && s.stage === stage; i++) {
      scoop(p)
      to(id)
      pour(1.2)
    }
    assert.equal(s.stage, stage + 1, 'dose ' + p)
    to('scale')
    act()
    assert.equal(s.stage, stage + 1, 'open shield cannot record')
    door(false)
    act()
    assert.equal(s.stage, stage + 2, 'record ' + p)
    setDown(HOME.spatula)
    door(true)
    take(id)
    to('mortar')
    pour()
  }
  function load() {
    setup()
    for (const p of powders) weigh(p)
    assert.equal(s.stage, MIX)
    setDown('scale')
  }
  function grind() {
    take('pestle')
    to('mortar')
    act(0.7)
    const before = s.mixed
    act(1)
    assert.ok(s.mixed - before < 0.001)
    const m = s.objects.mortar
    for (let i = 0; i < 420 && s.stage === MIX; i++) {
      aim = { x: m.x + 0.062 * Math.cos(i / 9), y: m.y + 0.048 * Math.sin(i / 9) }
      act(0.025)
    }
    assert.equal(s.mixed, 100)
    setDown(HOME.pestle)
  }
  function collect() {
    if (!s.objects.foil2.folded) {
      take('foil2')
      setDown(workPositions.foil2)
      foldSheet('foil2')
    }
    take('mortar')
    to('foil2')
    pour()
    setDown(workPositions.mortar)
    if (s.objects.vial.y < 0.8) {
      take('vial')
      setDown(workPositions.vial)
    }
    take('foil2')
  }
  function fill() {
    to('vial')
    pour()
    setDown(workPositions.foil2)
  }
  function seal() {
    take('cap')
    to('vial')
    act()
  }
  return {
    s,
    frame,
    to,
    grip,
    take,
    setDown,
    door,
    act,
    pour,
    scoop,
    setup,
    foldSheet,
    weigh,
    load,
    grind,
    collect,
    fill,
    seal,
  }
}

test('LGPS full run uses three mass-conserving doses, closed-door net readings, hand mixing and a sealed vial', () => {
  const b = bench()
  assert.equal(createGame().status, 'title')
  b.load()
  for (const p of powders) {
    assert.ok(Math.abs(b.s.readings[p] - recipe[p]) < 0.00001)
    assert.ok(Math.abs(b.s.objects.mortar[p] - recipe[p]) < 0.00001)
  }
  b.seal()
  assert.equal(b.s.objects.vial.open, true)
  b.setDown(HOME.cap)
  b.grind()
  b.collect()
  b.fill()
  b.seal()
  assert.equal(b.s.status, 'won')
  assert.equal(b.s.objects.vial.open, false)
  assert.ok(Math.abs(b.s.vialMass - 2) < 0.00001)
  assert.ok(b.s.recovery > 99.99)
  assert.equal(b.s.spilled, 0)
})
test('spilling mixed powder requires three top-ups and fresh grinding; filled material survives', () => {
  const b = bench()
  b.load()
  b.grind()
  b.collect()
  b.to({ x: 0.5, y: 0.47 })
  b.pour(1.2)
  b.fill()
  const saved = b.s.vialMass
  assert.ok(saved > 0 && saved < 1.9)
  assert.equal(b.s.stage, 0)
  b.seal()
  assert.equal(b.s.status, 'playing')
  b.setDown(HOME.cap)
  // Each supplemental weighing requires a new flat sheet and a fresh tare.
  for (const p of powders) b.weigh(p)
  assert.equal(b.s.vialMass, saved)
  assert.equal(b.s.stage, MIX)
  b.setDown('scale')
  b.grind()
  b.collect()
  b.fill()
  b.seal()
  assert.equal(b.s.status, 'won')
  assert.ok(b.s.recovery < 100)
})
test('tools stay where released; foil folding and bottle opening require a front work surface', () => {
  const b = bench()
  b.to('foil')
  b.act()
  assert.equal(b.s.objects.foil.folded, false)
  b.take('foil')
  b.setDown({ x: 0.44, y: 0.86 })
  b.foldSheet('foil')
  assert.equal(b.s.stage, 1)
  assert.ok(Math.abs(b.s.objects.foil.x - 0.44) < 0.01)
  b.take('foil')
  b.door(true)
  b.setDown('scale')
  b.door(false)
  b.act()
  b.to('jarA')
  b.act()
  assert.equal(b.s.objects.jarA.open, false)
  b.frame(0.1, { doorPressed: true })
  assert.equal(b.s.objects.scale.open, false, 'cannot operate door remotely')
})
test('an impact topples a bottle once, the hand can stand it up, repeated impacts can lose the round', () => {
  const b = bench()
  for (let i = 0; i < 17 && b.s.status === 'playing'; i++) {
    b.take('jarA')
    const center = { x: 0.46, y: 0.69 }
    b.setDown(center)
    b.to({ x: 0.23, y: center.y })
    b.frame(0.48, { targetX: 0.78, targetY: center.y })
    assert.equal(b.s.objects.jarA.toppled, true)
    if (i === 0) assert.ok(b.s.objects.jarA.x > center.x + 0.08)
    const anger = b.s.anger
    if (i === 0) assert.equal(anger, 6)
    if (b.s.status === 'playing') {
      b.to('jarA')
      b.frame(0.5)
      assert.equal(b.s.anger, anger, 'resting contact incurs no additional penalty')
      b.grip()
      assert.equal(b.s.hand.held, null)
      assert.equal(b.s.objects.jarA.toppled, false)
    }
  }
  assert.equal(b.s.status, 'lost')
  assert.equal(b.s.anger, 100)
})
test('tilting and accelerating a loaded spatula sheds powder without the action key', () => {
  const b = bench()
  b.setup()
  b.take('jarA')
  b.setDown(workPositions.jarA)
  b.act()
  b.door(true)
  b.take('spatula')
  b.scoop('a')
  b.frame(0.4, { tilt: -1 })
  b.frame(0.55, { tilt: -1, targetX: 0.98, targetY: 0.85 })
  assert.ok(b.s.spilledMass.a > 0)
  assert.ok(b.s.anger > 0)
})
test('grinding requires a moving pestle inside the mortar', () => {
  const b = bench()
  b.load()
  const m = b.s.objects.mortar
  for (let i = 0; i < 12; i++)
    b.frame(0.15, { action: true, targetX: m.x + (i % 2 ? 0.06 : -0.06), targetY: m.y })
  assert.equal(b.s.mixed, 0)
  b.take('pestle')
  for (let i = 0; i < 12; i++)
    b.frame(0.15, { action: true, targetX: 0.31 + (i % 2 ? 0.06 : -0.06), targetY: 0.26 })
  assert.equal(b.s.mixed, 0)
})
test('timeout freezes a round and restart restores closed shield, fresh foil and shelf positions', () => {
  const b = bench()
  b.frame(360)
  assert.equal(b.s.status, 'lost')
  const end = structuredClone(b.s)
  b.frame(2, { action: true, gripPressed: true, doorPressed: true })
  assert.deepEqual(b.s, end)
  const next = startGame()
  assert.equal(next.remaining, 360)
  assert.equal(next.tared, false)
  assert.equal(next.objects.scale.open, false)
})

test('a collision spills a loaded mortar, then the player can recover, reweigh and finish', () => {
  const b = bench()
  b.load()
  const m = b.s.objects.mortar
  const startX = m.x
  b.to({ x: m.x - 0.31, y: m.y })
  b.frame(0.50, { targetX: 0.98, targetY: m.y })
  assert.equal(m.toppled, true)
  assert.ok(m.x > startX + 0.04)
  for (const p of powders) assert.ok(b.s.spilledMass[p] > 0)
  b.to('mortar')
  b.grip()
  assert.equal(m.toppled, false)
  b.take('mortar')
  b.setDown(workPositions.mortar)
  b.grind()
  assert.equal(b.s.stage, 0)
  for (const p of powders) b.weigh(p)
  b.setDown('scale')
  b.grind()
  b.collect()
  b.fill()
  b.seal()
  assert.equal(b.s.status, 'won')
  assert.ok(b.s.recovery < 100)
  assert.ok(b.s.score > 0)
  for (const p of powders) assert.ok(Math.abs(b.s.objects.vial[p] - recipe[p]) < 0.00001)
})

test('a stream straddling the mortar rim divides the same dose between mortar and bench', () => {
  const s = startGame()
  const offset = (0.61 + 0.18) / 12
  s.stage = 6
  Object.assign(s.objects.mortar, workPositions.mortar)
  Object.assign(s.hand, { x: s.objects.mortar.x + offset, y: s.objects.mortar.y, held: 'foil', tilt: 1 })
  Object.assign(s.objects.foil, { x: s.hand.x, y: s.hand.y, a: 0.2, foldCount: 2, folded: true })
  s.objects.jarA.a -= 0.2
  stepGame(s, { targetX: s.hand.x, targetY: s.hand.y, action: true, gripPressed: false, tilt: 1 }, 0.09)
  assert.ok(s.objects.mortar.a > 0 && s.spilledMass.a > 0)
  assert.ok(Math.abs(s.objects.mortar.a + s.spilledMass.a + s.objects.foil.a - 0.2) < 1e-8)
  assert.ok(s.anger > 0)
  assert.ok(s.powderTransfers.some(event => event.from === 'foil' && event.to === 'mortar'))
  assert.ok(s.powderTransfers.some(event => event.from === 'foil' && event.to === null))
})

test('one foil cannot stand in for another material or be tared on top of another sheet', () => {
  const b = bench()
  b.setup()
  b.weigh('a')
  assert.equal(b.s.stage, 7)
  assert.equal(b.s.tared, false)
  assert.equal(b.s.objects.foil.spent, true)
  b.grip()
  assert.equal(b.s.objects.foil.foldCount, 0)
  b.take('foil')
  b.setDown(workPositions.foil)
  b.to('foil')
  b.act()
  assert.equal(b.s.stage, 7)
  assert.equal(b.s.target, 'foilB')
  b.take('foil')
  b.door(true)
  b.setDown('scale')
  b.take('foilB')
  b.setDown(workPositions.foilB)
  b.foldSheet('foilB')
  b.take('foilB')
  b.to('scale')
  b.grip()
  assert.equal(b.s.hand.held, 'foilB', 'occupied pan refuses a second sheet')
  assert.equal(b.s.tared, false)
})

test('a player can fold by carrying the free corner across the sheet for each successive fold', () => {
  const b = bench()
  b.take('foil')
  b.setDown(workPositions.foil)
  b.foldSheet('foil', true)
  assert.equal(b.s.objects.foil.foldCount, 2)
  assert.equal(b.s.stage, 1)
})

test('the glove grips each rotated handle among nearby objects and then aims with the working tip', () => {
  for (const id of ['spatula', 'pestle'] as const) {
    const s = startGame()
    const start = { x: 0.44, y: 0.66, yaw: 1.1 }
    Object.assign(s.objects[id], start)
    const grip = toolHandle(id, s.objects[id])
    // A neighboring cap is closer to the glove than the middle of the long tool.
    Object.assign(s.objects.cap, { x: grip.x + 0.012, y: grip.y })
    Object.assign(s.hand, grip)
    const input = { targetX: grip.x, targetY: grip.y, gripPressed: true, tilt: 0, action: false }
    stepGame(s, input, 1 / 120)
    assert.equal(s.hand.held, id)
    assert.deepEqual(s.hand.toolPickup, { ...start, progress: 0 })
    stepGame(s, { ...input, gripPressed: false, targetX: 0.59 }, 0.10)
    assert.ok(s.hand.toolPickup && s.hand.toolPickup.progress > 0.4 && s.hand.toolPickup.progress < 0.6)
    stepGame(s, { ...input, gripPressed: false, targetX: 0.59 }, 0.5)
    assert.equal(s.hand.toolPickup, undefined)
    assert.equal(s.objects[id].x, s.hand.x, 'working end follows the player aim')
    assert.equal(s.objects[id].y, s.hand.y)
  }
})

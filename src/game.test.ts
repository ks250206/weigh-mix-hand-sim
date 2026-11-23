import assert from 'node:assert/strict'
import test from 'node:test'
import { createGame, startGame, stepGame, MASS_TOLERANCE } from './game.ts'
import { bottles, foilWeight, foldStroke, weighFoils, toolHandle, MIX, HOME, mass, powders, recipe, workPositions, isTool, type FoilId, type GameInput, type ObjectId, type Powder, type Station } from './contract.ts'
import { heldObjectHeight, pourMouth } from './geometry.ts'

function bench(mode: 'standard' | 'practice' = 'practice') {
  const s = startGame(mode)
  let aim = { x: s.hand.x, y: s.hand.y }
  function frame(seconds: number, buttons: Partial<GameInput> = {}) {
    stepGame(s, { targetX: aim.x, targetY: aim.y, action: false, gripPressed: false, tilt: 0, ...buttons }, seconds)
    for (const p of powders) {
      const total = Object.values(s.objects).reduce((sum, o) => sum + o[p], s.spilledMass[p] + s.discardedMass[p])
      assert.ok(Math.abs(total - 5) < 1e-7, `${p} inventory=${total}`)
    }
  }
  function to(target: ObjectId | Station, buttons: Partial<GameInput> = {}) {
    const dest = typeof target === 'string' ? s.objects[target] : target
    const from = { ...aim }, end = { x: dest.x, y: dest.y }
    const count = Math.max(1, Math.ceil(Math.hypot(end.x - from.x, end.y - from.y) / 0.022))
    for (let i = 1; i <= count; i++) {
      aim = { x: from.x + (end.x - from.x) * i / count, y: from.y + (end.y - from.y) * i / count }
      frame(0.075, buttons)
    }
    frame(0.5, buttons)
  }
  function grip() { frame(0.02, { gripPressed: true }) }
  function take(id: ObjectId) {
    assert.equal(s.hand.held, null, `hand before ${id}`)
    to(isTool(id) ? toolHandle(id, s.objects[id]) : id)
    grip()
    if (s.hand.held === null && !s.objects[id].toppled) grip()
    assert.equal(s.hand.held, id, `take ${id} at ${s.hand.x},${s.hand.y}; ${s.message}`)
  }
  function down(target: ObjectId | Station) { to(target); grip(); assert.equal(s.hand.held, null, s.message) }
  function action(seconds = 0.72) { frame(seconds, { action: true }); frame(0.05) }
  function door(open: boolean) { to('scale'); if (s.objects.scale.open !== open) frame(0.02, { doorPressed: true }); if (!open) frame(0.55); assert.equal(s.objects.scale.open, open) }
  function fold(id: FoilId) {
    for (let count = 0; count < 2; count++) {
      const [a, b] = foldStroke(s.objects[id])
      to(a); frame(0.08, { action: true }); aim = b; frame(0.8, { action: true }); frame(0.1)
      assert.equal(s.objects[id].foldCount, count + 1, `crease ${id} ${count}: ${s.actionReason}`)
    }
    assert.equal(s.objects[id].unfolded, false)
    to(id); action(0.6)
    assert.equal(s.objects[id].unfolded, true, 'crease then reopen')
  }
  function prepareFoil(p: Powder) {
    if (s.hand.held) { assert.ok(s.objects[s.hand.held].spent); grip() }
    const id = weighFoils[p]
    take(id); down(workPositions[id]); fold(id)
    take(id); door(true); down('scale'); door(false); action()
    assert.equal(s.tared, true, s.actionReason)
    assert.ok(Math.abs(s.scaleMass) < 1e-6)
  }
  function open(p: Powder) {
    if (s.objects[bottles[p]].open) return
    take(bottles[p]); down(workPositions[bottles[p]]); action()
    assert.equal(s.objects[bottles[p]].open, true)
  }
  function scoop(id: ObjectId) {
    const src = s.objects[id]
    to({ x: src.x, y: src.y - 0.022 })
    frame(0.45, { action: true })
    aim = { x: src.x, y: src.y + 0.022 }
    frame(0.65, { action: true })
    frame(0.12)
  }
  function pourTo(id: ObjectId, limit?: number) {
    const from = s.hand.held!
    assert.ok(from)
    frame(0.85, { tilt: 1 })
    const mouth = pourMouth(from, s.objects[from], heldObjectHeight(s))
    const dx = mouth.x - s.objects[from].x, dy = mouth.y - s.objects[from].y
    to({ x: s.objects[id].x - dx, y: s.objects[id].y - dy }, { tilt: 1 })
    for (let i = 0; i < 1000 && mass(s.objects[from]) > 1e-7 && s.status === 'playing'; i++) {
      const need = limit === undefined ? Infinity : limit - mass(s.objects[id])
      if (need <= 1e-8) break
      frame(Math.min(0.02, need / (Math.abs(s.hand.tilt) * 0.70)), { action: true, tilt: 1 })
      if (!s.actionReady && mass(s.objects[from]) > 1e-7) assert.fail(`pour ${from}->${id}: ${s.actionReason}; hand=${s.hand.x},${s.hand.y}`)
    }
    frame(0.4)
  }
  function clean() {
    if (!s.hand.held) take('spatula')
    assert.equal(s.hand.held, 'spatula')
    to('cleaner'); action(1.35)
    assert.equal(s.toolHygiene.state, 'wet')
    frame(2.5)
    assert.equal(s.toolHygiene.state, 'clean')
    down(HOME.spatula)
  }
  function weigh(p: Powder) {
    prepareFoil(p); open(p); door(true); take('spatula')
    const goal = recipe[p] - s.objects.mortar[p] - s.objects.foil2[p] - s.objects.vial[p]
    for (let pass = 0; pass < 12 && s.objects[weighFoils[p]][p] < goal - 1e-7; pass++) {
      scoop(bottles[p]); assert.ok(mass(s.objects.spatula) > 0, s.actionReason)
      pourTo(weighFoils[p], goal)
      if (mass(s.objects.spatula) > 1e-7) pourTo(bottles[p])
    }
    assert.ok(Math.abs(s.objects[weighFoils[p]][p] - goal) < 0.00001, `weigh ${p}`)
    down(HOME.spatula); door(false); action(); door(true); take(weighFoils[p]); pourTo('mortar')
    assert.equal(s.objects[weighFoils[p]].spent, true)
    grip()
  }
  function load() {
    take('mortar'); down(workPositions.mortar)
    for (const p of powders) { weigh(p); clean() }
    assert.equal(s.stage, MIX)
  }
  function grind() {
    take('pestle'); to('mortar')
    for (let i = 0; i < 1600 && s.mixed < 100; i++) {
      const m = s.objects.mortar
      aim = { x: m.x + 0.035 * Math.cos(i / 12), y: m.y + 0.064 * Math.sin(i / 12) }
      frame(0.025, { action: true })
    }
    assert.equal(s.mixed, 100, JSON.stringify(s.mixCoverage))
    down(HOME.pestle)
  }
  function collect() {
    if (!s.objects.foil2.unfolded) { take('foil2'); down(workPositions.foil2); fold('foil2') }
    take('mortar'); pourTo('foil2'); down(workPositions.mortar)
  }
  function fill() {
    take('vial'); down(workPositions.vial)
    take('foil2'); pourTo('vial'); down(workPositions.foil2)
  }
  function seal() { take('cap'); to('vial'); action() }
  return { s, frame, to, grip, take, down, action, door, fold, prepareFoil, open, scoop, pourTo, clean, weigh, load, grind, collect, fill, seal }
}

function put(s: ReturnType<typeof startGame>, id: ObjectId, p: Powder, grams: number) {
  s.objects[bottles[p]][p] -= grams
  s.objects[id][p] += grams
}

function fixture(stage: number, held: ObjectId | null) {
  const s = startGame('practice')
  s.stage = stage
  s.hand.held = held
  return s
}

function tick(s: ReturnType<typeof startGame>, seconds: number, input: Partial<GameInput> = {}) {
  stepGame(s, { targetX: s.hand.x, targetY: s.hand.y, action: false, gripPressed: false, tilt: 0, ...input }, seconds)
}

test('standard mode finishes all raw materials, reopened foil, clean/dry tools and mixing within six minutes', () => {
  const b = bench('standard')
  b.load(); b.grind(); b.collect(); b.fill(); b.seal()
  assert.equal(b.s.status, 'won', b.s.message)
  assert.ok(b.s.elapsed < 360, `standard elapsed=${b.s.elapsed}`)
  assert.equal(b.s.objects.vial.open, false)
  for (const p of powders) assert.ok(Math.abs(b.s.objects.vial[p] - recipe[p]) <= MASS_TOLERANCE)
  assert.equal(b.s.toolHygiene.wipesUsed, 3)
  assert.equal(b.s.mixCoverage.filter(v => v === 1).length, 8)
  assert.ok(b.s.score > 0)
})

test('two folds alone are insufficient; the sheet must be reopened before it fits on the balance', () => {
  const s = fixture(0, 'foil')
  Object.assign(s.objects.foil, { folded: true, foldCount: 2, x: HOME.scale.x, y: HOME.scale.y })
  Object.assign(s.hand, HOME.scale)
  s.objects.scale.open = true
  tick(s, 0.02, { gripPressed: true })
  assert.equal(s.hand.held, 'foil')
  assert.match(s.message, /開き/)
  assert.equal(s.stage, 0)
})

test('bottles and another material foil can be prepared ahead of the recommended stage', () => {
  const b = bench()
  b.open('b')
  assert.equal(b.s.stage, 0)
  b.take('foilC'); b.down(workPositions.foilC); b.fold('foilC')
  assert.equal(b.s.objects.foilC.unfolded, true)
  assert.equal(b.s.stage, 0)
})

test('dirty tools reject another material, fresh wipes consume residue into discard ledger and drying is mandatory', () => {
  const b = bench()
  b.open('b'); b.take('spatula')
  b.s.toolHygiene.state = 'dirty'; b.s.toolHygiene.residue = ['a']
  put(b.s, 'spatula', 'a', 0.03)
  b.scoop('jarB')
  assert.equal(b.s.objects.spatula.b, 0)
  b.to('cleaner'); b.action(1.35)
  assert.equal(b.s.toolHygiene.state, 'wet')
  assert.ok(Math.abs(b.s.discardedMass.a - 0.03) < 1e-8)
  assert.equal(b.s.spilled, 0)
  assert.equal(b.s.toolHygiene.wipesUsed, 1)
  const dry = b.s.toolHygiene.dryRemaining
  assert.ok(dry > 2)
  tick(b.s, 0.1, { action: true, targetX: b.s.objects.jarB.x, targetY: b.s.objects.jarB.y })
  assert.equal(b.s.objects.spatula.b, 0)
  b.frame(2.6); b.scoop('jarB')
  assert.ok(b.s.objects.spatula.b > 0, JSON.stringify({reason:b.s.actionReason, hint:b.s.hint, hand:b.s.hand, jar:b.s.objects.jarB, hygiene:b.s.toolHygiene}))
})

test('free scooping can exceed the remaining target and a pure surplus can return to its original bottle', () => {
  const b = bench()
  b.prepareFoil('a'); b.open('a'); b.door(true)
  put(b.s, 'foil', 'a', 0.760)
  b.take('spatula'); b.scoop('jarA')
  assert.ok(b.s.objects.spatula.a > 0.020 + MASS_TOLERANCE, JSON.stringify({reason:b.s.actionReason, hand:b.s.hand, jar:b.s.objects.jarA, spoon:b.s.objects.spatula, hygiene:b.s.toolHygiene}))
  const before = b.s.objects.jarA.a
  b.pourTo('jarA')
  assert.ok(b.s.objects.jarA.a > before)
  assert.ok(mass(b.s.objects.spatula) < 1e-7)
  b.scoop('foil')
  assert.ok(b.s.objects.foil.a < 0.760, 'spatula removes powder from the pan')
})

test('discard is deliberate, requires the waste station, and preserves inventory separately from spills', () => {
  const b = bench()
  b.take('spatula'); put(b.s, 'spatula', 'a', 0.20)
  b.frame(1, { discard: true })
  assert.equal(b.s.discardedMass.a, 0)
  b.to('cleaner'); b.frame(0.5, { discard: true })
  assert.ok(b.s.discardedMass.a > 0 && b.s.discardedMass.a < 0.20)
  assert.equal(b.s.spilled, 0)
  assert.equal(b.s.anger, 0)
})

test('scooping outside the visible bottle mouth does not collect powder', () => {
  const s = fixture(4, 'spatula')
  Object.assign(s.objects.jarA, { ...workPositions.jarA, open: true })
  Object.assign(s.hand, { x: s.objects.jarA.x + 0.07, y: s.objects.jarA.y - 0.01 })
  tick(s, 0.3, { action: true, targetY: s.objects.jarA.y + 0.025 })
  assert.equal(s.objects.spatula.a, 0)
})

test('mixing outside the visible mortar or circling only its center cannot produce uniform powder', () => {
  const s = fixture(MIX, 'pestle')
  Object.assign(s.objects.mortar, workPositions.mortar)
  for (const p of powders) put(s, 'mortar', p, recipe[p])
  Object.assign(s.hand, { x: s.objects.mortar.x + 0.1, y: s.objects.mortar.y })
  tick(s, 0.3, { action: true, targetY: s.objects.mortar.y + 0.03 })
  assert.equal(s.mixed, 0)
  Object.assign(s.hand, { ...workPositions.mortar, vx: 0, vy: 0 })
  for (let i = 0; i < 200; i++) tick(s, 0.025, { action: true, targetX: s.objects.mortar.x + 0.004 * Math.cos(i), targetY: s.objects.mortar.y + 0.008 * Math.sin(i) })
  assert.equal(s.mixed, 0)
})

test('opposite tilt directions send powder from different lips and produce different capture', () => {
  const captured = [-1, 1].map(sign => {
    const s = fixture(4, 'spatula')
    Object.assign(s.objects.foil, { ...HOME.scale, folded: true, foldCount: 2, unfolded: true })
    s.objects.scale.open = true
    Object.assign(s.hand, { x: HOME.scale.x + 0.43 / 12, y: HOME.scale.y, tilt: sign * 1.15 })
    Object.assign(s.objects.spatula, { x: s.hand.x, y: s.hand.y, tilt: sign * 1.15 })
    put(s, 'spatula', 'a', 0.2)
    s.toolHygiene.state = 'dirty'; s.toolHygiene.residue = ['a']
    tick(s, 0.1, { action: true, tilt: sign })
    return s.objects.foil.a
  })
  assert.ok(captured[0] > captured[1] + 0.005, JSON.stringify(captured))
})

test('an exhausted ingredient explains why the run cannot finish instead of requesting endless scooping', () => {
  const s = startGame()
  s.stage = 4
  s.objects.jarA.a = 0; s.objects.foil.a = 0.7; s.spilledMass.a = 4.3; s.spilled = 4.3; s.anger = 86
  tick(s, 0.1)
  assert.equal(s.status, 'lost')
  assert.match(s.message, /Li₂S.*残量/)
})

test('practice has no time or anger failure, while standard retains the time limit', () => {
  const practice = startGame('practice')
  practice.anger = 100
  tick(practice, 361)
  assert.equal(practice.status, 'playing')
  assert.ok(practice.elapsed > 360)
  const standard = startGame()
  tick(standard, 360)
  assert.equal(standard.status, 'lost')
  const end = structuredClone(standard)
  tick(standard, 2, { gripPressed: true, action: true })
  assert.deepEqual(standard, end)
})

test('a partial failed run keeps progress points and per-stage elapsed times', () => {
  const b = bench('standard')
  b.take('foil'); b.down(workPositions.foil); b.fold('foil')
  b.frame(360)
  assert.equal(b.s.status, 'lost')
  assert.ok(b.s.score > 0)
  assert.ok(b.s.stageTimes[0] > 0)
  assert.equal(createGame().mode, 'standard')
})

test('a mixed-powder loss keeps material already bottled, requires top-ups and fresh mixing, and can recover', () => {
  const b = bench()
  b.load(); b.grind(); b.collect(); b.fill()
  for (const p of powders) {
    const lost = b.s.objects.vial[p] * 0.05
    b.s.objects.vial[p] -= lost
    b.s.spilledMass[p] += lost
    b.s.spilled += lost
  }
  b.frame(0.02)
  const saved = mass(b.s.objects.vial)
  assert.equal(b.s.stage, 0)
  assert.ok(saved > 1.89)
  for (const p of powders) { b.weigh(p); b.clean() }
  assert.ok(Math.abs(mass(b.s.objects.vial) - saved) < 1e-7)
  assert.equal(b.s.mixed, 0)
  b.grind(); b.collect(); b.fill(); b.seal()
  assert.equal(b.s.status, 'won', b.s.message)
  assert.ok(b.s.stats.reweighs >= 3)
  assert.ok(b.s.recovery < 100)
})

test('a dirty spoon cannot return one ingredient into a different stock bottle', () => {
  const s = fixture(4, 'spatula')
  Object.assign(s.objects.jarB, { ...workPositions.jarB, open: true })
  Object.assign(s.hand, { ...workPositions.jarB, tilt: 1.15 })
  put(s, 'spatula', 'a', 0.2)
  s.toolHygiene.state = 'dirty'; s.toolHygiene.residue = ['a']
  tick(s, 0.5, { action: true, tilt: 1 })
  assert.equal(s.objects.jarB.a, 0)
  assert.equal(s.objects.spatula.a, 0.2)
  assert.match(s.actionReason, /戻せない/)
})

test('uncapped held bottles spill when tilted or jerked, while capped bottles retain powder', () => {
  for (const motion of ['tilt', 'jerk'] as const) {
    for (const open of [false, true]) {
      const s = fixture(0, 'jarA')
      Object.assign(s.hand, { x: 0.31, y: 0.62, tilt: motion === 'tilt' ? 1.15 : 0 })
      Object.assign(s.objects.jarA, { x: s.hand.x, y: s.hand.y, open, tilt: s.hand.tilt })
      tick(s, 0.45, motion === 'tilt' ? { tilt: 1 } : { targetX: 0.90 })
      if (open) {
        assert.ok(s.spilledMass.a > 0.005, `${motion}: ${s.spilledMass.a}`)
        assert.ok(s.objects.jarA.a < 5)
      } else {
        assert.equal(s.spilledMass.a, 0, motion)
        assert.equal(s.objects.jarA.a, 5)
      }
      const inventory = Object.values(s.objects).reduce((sum, o) => sum + o.a, s.spilledMass.a + s.discardedMass.a)
      assert.ok(Math.abs(inventory - 5) < 1e-7)
    }
  }
})

test('toppled open vessels keep leaking until righted; closed bottles do not leak', () => {
  for (const open of [false, true]) {
    const s = fixture(0, null)
    Object.assign(s.objects.jarA, { ...workPositions.jarA, open, toppled: true, tilt: 0.98 })
    tick(s, 0.5)
    const first = s.spilledMass.a
    tick(s, 0.5)
    if (open) {
      assert.ok(first > 0.1)
      assert.ok(s.spilledMass.a > first + 0.1)
      assert.equal(s.stats.accidents, 1, 'one continuous spill episode')
      s.objects.jarA.toppled = false
      s.objects.jarA.tilt = 0
      const stopped = s.spilledMass.a
      tick(s, 0.5)
      assert.equal(s.spilledMass.a, stopped)
    } else assert.equal(s.spilledMass.a, 0)
    const inventory = Object.values(s.objects).reduce((sum, o) => sum + o.a, s.spilledMass.a + s.discardedMass.a)
    assert.ok(Math.abs(inventory - 5) < 1e-7)
  }
})

test('balance recording waits for a closed shield, a settled mass and a stationary hand', () => {
  const b = bench()
  b.prepareFoil('a'); b.open('a'); b.door(true)
  put(b.s, 'foil', 'a', recipe.a)
  b.action()
  assert.equal(b.s.readings.a, 0, 'open shield cannot record')
  assert.equal(b.s.scaleStable, false)
  b.frame(0.02, { doorPressed: true })
  b.frame(0.12, { action: true })
  assert.equal(b.s.readings.a, 0, 'closing does not stabilize immediately')
  assert.equal(b.s.scaleStable, false)
  assert.match(b.s.actionReason, /安定/)
  b.frame(0.55)
  assert.equal(b.s.scaleStable, true)
  b.frame(0.25, { action: true, targetX: b.s.hand.x + 0.02 })
  assert.equal(b.s.readings.a, 0, 'moving the hand prevents a reading')
  assert.equal(b.s.scaleStable, false)
  b.to('scale'); b.frame(0.55); b.action()
  assert.ok(Math.abs(b.s.readings.a - recipe.a) < 1e-8)
})

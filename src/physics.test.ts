import assert from 'node:assert/strict'
import test from 'node:test'
import { Container3D } from '@pixi/3d'
import { startGame, stepGame } from './game.ts'
import { HOME } from './contract.ts'
import { TablePhysics } from './physics.ts'
import { heldObjectHeight, pointOnFoil, pourMouth, receiverSpec, sceneDistance, vesselGeometry, vesselPose, WORLD_WIDTH, WORLD_DEPTH } from './geometry.ts'

const dt = 1 / 120

test('a released pestle knocks a loose spatula sideways and spins it while the glove stays away', () => {
  const s = startGame()
  Object.assign(s.objects.spatula, { x: 0.50, y: 0.70 })
  const table = new TablePhysics(s)
  const release = { x: 0.36, y: 0.68 }
  table.lift('pestle')
  table.release('pestle', release, { x: 1.6, y: 0 }, false)
  const step = () => table.step(s, s.hand, dt)
  step()
  assert.ok(s.objects.pestle.x > release.x)
  assert.equal(s.objects.spatula.x, 0.50, 'separated bodies do not transfer momentum')
  for (let i = 0; i < 120; i++) step()
  const rest = { ...s.objects.spatula }
  assert.ok(rest.x > 0.53, 'impact transfers horizontal momentum between two loose bodies')
  assert.ok(Math.abs(rest.yaw!) > 0.08, 'off-center contact rotates the real footprint')
  for (let i = 0; i < 120; i++) step()
  assert.ok(Math.hypot(rest.x - s.objects.spatula.x, rest.y - s.objects.spatula.y) < 0.001)
  table.lift('spatula')
  table.release('spatula', { x: 0.32, y: 0.44 }, { x: 0, y: 0 }, false)
  step()
  assert.equal(s.objects.spatula.yaw, 0, 'gently placing the utensil restores its resting orientation')
})

test('the rails confine a thrown cap and the anchored balance protects foil docked on its pan', () => {
  const s = startGame()
  const table = new TablePhysics(s)
  const step = () => table.step(s, s.hand, dt)
  table.lift('foil')
  Object.assign(s.objects.foil, HOME.scale)
  table.release('foil', HOME.scale, { x: 1.5, y: 0 }, true)
  table.lift('cap')
  table.release('cap', { x: 0.29, y: HOME.scale.y }, { x: -2, y: 0 }, false)
  let nearest = 1
  for (let i = 0; i < 180; i++) {
    step()
    nearest = Math.min(nearest, s.objects.cap.x)
  }
  assert.ok(nearest < 0.24 && nearest > 0.22, 'cap reaches the balance housing and stays outside it')
  assert.equal(s.objects.scale.x, HOME.scale.x)
  assert.equal(s.objects.foil.x, HOME.scale.x)
  assert.equal(s.objects.foil.y, HOME.scale.y)
  for (const direction of [-1, 1]) {
    table.lift('cap')
    const start = direction > 0 ? 0.93 : 0.07
    table.release('cap', { x: start, y: start }, { x: 3 * direction, y: 3 * direction }, false)
    let edgeX = 0, edgeY = 0
    for (let i = 0; i < 180; i++) {
      step()
      const cap = s.objects.cap
      edgeX = Math.max(edgeX, (cap.x - 0.5) * direction)
      edgeY = Math.max(edgeY, (cap.y - 0.5) * direction)
      assert.ok(cap.x >= 0.013 && cap.x <= 0.987)
      assert.ok(cap.y >= 0.025 && cap.y <= 0.975)
    }
    assert.ok(edgeX > 0.5 - (vesselGeometry.cap.radius + 0.025) / WORLD_WIDTH &&
      edgeY > 0.5 - (vesselGeometry.cap.radius + 0.025) / WORLD_DEPTH,
      'the real-sized cap contacts both rails')
  }
})

test('a moving grip release carries momentum through the game loop, with an independent world on restart', () => {
  const s = startGame()
  const input = { targetX: HOME.cap.x, targetY: HOME.cap.y, gripPressed: false, action: false, tilt: 0 }
  stepGame(s, input, 1)
  stepGame(s, { ...input, gripPressed: true }, dt)
  assert.equal(s.hand.held, 'cap')
  const aim = { ...input, targetX: 0.48 }
  stepGame(s, aim, 0.13)
  stepGame(s, { ...aim, gripPressed: true }, dt)
  assert.equal(s.hand.held, null)
  const x = s.objects.cap.x
  stepGame(s, aim, 0.07)
  assert.ok(s.objects.cap.x < x - 0.045)
  const next = startGame()
  stepGame(next, { ...input, targetX: next.hand.x, targetY: next.hand.y }, 1)
  assert.equal(next.objects.cap.x, HOME.cap.x)
  assert.equal(next.objects.cap.y, HOME.cap.y)
  assert.equal(next.anger, 0)
})

test('folding removes the unused corners from the physical collision footprint', () => {
  function cornerContact(count: 0 | 1 | 2, x: number, y: number) {
    const s = startGame()
    const sheet = s.objects.foilB
    Object.assign(sheet, { x: 0.46, y: 0.7, foldCount: count, folded: count === 2 })
    Object.assign(s.objects.cap, { x: sheet.x + x / 1200, y: sheet.y + y / 650 })
    const table = new TablePhysics(s)
    table.step(s, s.hand, dt)
    return Math.hypot((sheet.x - 0.46) * 1200, (sheet.y - 0.7) * 650)
  }
  assert.ok(cornerContact(0, 38, -38) > 1, 'flat square contacts a cap at its right rear corner')
  assert.ok(cornerContact(1, 38, -38) < 0.01, 'first crease clears the folded half')
  assert.ok(cornerContact(1, -42, 40) > 1, 'first triangle retains its outer corner')
  assert.ok(cornerContact(2, -42, 40) < 0.01, 'four-layer packet has the smallest footprint')
})

test('bottle contact uses the rendered radius and a supported vessel stays fixed', () => {
  const overlap = startGame()
  Object.assign(overlap.objects.jarA, { x: 0.40, y: 0.29 })
  Object.assign(overlap.objects.jarB, { x: 0.47, y: 0.29 })
  const contact = new TablePhysics(overlap)
  for (let i = 0; i < 30; i++) contact.step(overlap, overlap.hand, dt)
  assert.ok(sceneDistance(overlap.objects.jarA, overlap.objects.jarB) > 0.965,
    'visible bottle walls separate before they overlap')

  function carry(supported: boolean) {
    const s = startGame()
    Object.assign(s.hand, { held: 'jarA', x: 0.31, y: 0.30 })
    Object.assign(s.objects.jarA, { x: 0.31, y: 0.30 })
    Object.assign(s.objects.jarB, { x: 0.54, y: 0.30 })
    if (supported) s.supportTarget = 'jarB'
    const table = new TablePhysics(s)
    for (let i = 0; i < 120; i++) {
      s.hand.x = 0.31 + i / 119 * 0.23
      s.objects.jarA.x = s.hand.x
      table.step(s, { x: 0.9, y: 0.3 }, dt)
    }
    return s.objects.jarB.x
  }
  assert.ok(carry(false) > 0.57, 'a carried bottle can push other tall equipment')
  assert.ok(Math.abs(carry(true) - 0.54) < 1e-6, 'the explicit left-hand brace prevents movement')
})

test('placement preserves yaw and opened foil has the same selectable footprint as the sheet', () => {
  const s = startGame(), table = new TablePhysics(s)
  const at = { x: 0.45, y: 0.65, yaw: 0.63 }
  table.lift('spatula')
  table.release('spatula', at, { x: 0, y: 0 }, false)
  table.step(s, { x: 0.8, y: 0.8 }, dt)
  assert.ok(Math.abs(s.objects.spatula.yaw! - 0.63) < 1e-6)
  const foil = s.objects.foil
  foil.foldCount = 2
  foil.folded = true
  foil.unfolded = false
  assert.equal(pointOnFoil(foil, -0.43, -0.43), false)
  foil.unfolded = true
  assert.equal(pointOnFoil(foil, -0.43, -0.43), true)
})

test('a tilted collection foil clears the vial rim and the pour edge changes with tilt direction', () => {
  const s = startGame()
  Object.assign(s.hand, { held: 'foil2', x: 0.7, y: 0.8, tilt: 1.15 })
  Object.assign(s.objects.foil2, { x: 0.7, y: 0.8, tilt: 1.15, unfolded: true })
  Object.assign(s.objects.vial, { x: 0.72, y: 0.8, open: true })
  const height = heldObjectHeight(s)
  const right = pourMouth('foil2', s.objects.foil2, height)
  assert.ok(right.height > receiverSpec('vial', s.objects.vial)!.height + 0.15)
  s.objects.foil2.tilt *= -1
  const left = pourMouth('foil2', s.objects.foil2, height)
  assert.ok(left.x < s.objects.foil2.x && right.x > s.objects.foil2.x)
  assert.ok(Math.abs(left.height - right.height) < 1e-6)
})

test('a falling vessel stays on the bench and its rendered mouth matches the powder origin', () => {
  for (const sign of [-1, 1]) for (const angle of [0.2, 0.8, 1.36]) {
    const object = { ...startGame().objects.jarA, x: 0.5, y: 0.5, yaw: 0.7,
      toppled: true, tilt: sign * 0.98, toppleAngle: sign * angle }
    const pose = vesselPose('jarA', object)
    const node = new Container3D()
    node.origin.set(0, pose.originY, 0)
    node.position.y = pose.offsetY
    node.rotation.set(0, object.yaw, -pose.tilt)
    const lowest = node.toGlobal({ x: sign * vesselGeometry.jarA.radius, y: 0, z: 0 })
    assert.ok(Math.abs(lowest.y) < 1e-6, `lowest edge floated at ${lowest.y}`)
    const rendered = node.toGlobal({ x: sign * vesselGeometry.jarA.mouth, y: 1.25, z: 0 })
    const mouth = pourMouth('jarA', object, 0)
    assert.ok(Math.abs(rendered.x - (mouth.x - 0.5) * WORLD_WIDTH) < 1e-6)
    assert.ok(Math.abs(rendered.z - (mouth.y - 0.5) * WORLD_DEPTH) < 1e-6)
    assert.ok(Math.abs(rendered.y - mouth.height) < 1e-6)
  }

  const s = startGame(), jar = s.objects.jarA
  Object.assign(jar, { x: 0.45, y: 0.65, toppled: true, tilt: 0.98 })
  const table = new TablePhysics(s)
  for (let i = 0; i < 80; i++) table.step(s, s.hand, dt)
  assert.ok(jar.toppleAngle! > 1.3)
  Object.assign(jar, { toppled: false, tilt: 0, toppleAngle: 0 })
  Object.assign(s.hand, { x: jar.x, y: jar.y, held: 'jarA' })
  table.lift('jarA')
  const neighbor = { x: jar.x + 1.14 / WORLD_WIDTH, y: jar.y }
  Object.assign(s.objects.jarB, neighbor)
  table.release('jarB', neighbor, { x: 0, y: 0 }, false)
  for (let i = 0; i < 10; i++) table.step(s, { x: 0.9, y: 0.9 }, dt)
  assert.ok(sceneDistance(s.objects.jarB, neighbor) < 0.001,
    'immediate pickup must restore the upright footprint before carrying past a neighbor')
})

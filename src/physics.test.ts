import assert from 'node:assert/strict'
import test from 'node:test'
import { startGame, stepGame } from './game.ts'
import { HOME } from './contract.ts'
import { TablePhysics } from './physics.ts'

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
    assert.ok(edgeX > 0.48 && edgeY > 0.467, 'the moving cap contacts both rails')
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

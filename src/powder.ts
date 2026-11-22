import Matter from 'matter-js'
import type { ObjectId, Powder, PowderTransfer } from './contract.ts'

const { Bodies, Body, Composite, Engine } = Matter
const GRAVITY = 14.5           // scene units / s²
const PX = 100                 // Matter units per scene unit
const STEP = 1 / 60
export const MAX_MOVING_GRAINS = 48
export const MAX_SPILL_DOTS = 32

// Sample the footprint of a stream at receiver height. The center and two rings
// represent equal shares of its mass, including at low frame rates.
const stream = Array.from({ length: 19 }, (_, i) => {
  const r = i === 0 ? 0 : i < 7 ? 0.085 : 0.17
  const a = i < 7 ? i * Math.PI / 3 : (i - 6.5) * Math.PI / 6
  return { x: Math.cos(a) * r, z: Math.sin(a) * r }
})
export function caughtFraction(dx: number, dz: number, vx: number, vz: number, receiverRadius: number, dropHeight: number) {
  const flight = Math.sqrt(2 * Math.max(0, dropHeight) / GRAVITY)
  const x = dx + vx * flight, z = dz + vz * flight
  const distance = Math.hypot(x, z)
  if (distance + 0.17 <= receiverRadius) return 1
  if (distance - 0.17 > receiverRadius) return 0
  return stream.filter(p => Math.hypot(x + p.x, z + p.z) <= receiverRadius).length / stream.length
}

export interface PowderDot {
  x: number
  y: number
  z: number
  radius: number
  kind: Powder
}
interface MovingGrain extends PowderDot {
  body: Matter.Body
  receiver: ObjectId | null
  dz: number
  age: number
}

const surfaces = {
  spatula: { category: 2, height: 1.12, width: 0.24 },
  foil: { category: 4, height: 0.53, width: 0.60 },
  foilB: { category: 8, height: 0.53, width: 0.60 },
  foilC: { category: 16, height: 0.53, width: 0.60 },
  mortar: { category: 32, height: 0.36, width: 1.08 },
  foil2: { category: 64, height: 0.055, width: 0.66 },
  vial: { category: 128, height: 0.18, width: 0.40 },
} as const
type Receiver = keyof typeof surfaces
const isReceiver = (id: ObjectId | null): id is Receiver => id !== null && Object.hasOwn(surfaces, id)
const worldX = (x: number) => (x - 0.5) * 12
const worldZ = (y: number) => (y - 0.5) * 6.5

// Side-view gravity and contact are solved by Matter. Depth carries the lateral
// release velocity. Each receiving vessel has its own collision layer.
export class PowderPhysics {
  readonly moving: MovingGrain[] = []
  readonly residue: PowderDot[] = []
  private engine = Engine.create({ gravity: { x: 0, y: 1, scale: GRAVITY * PX / 1e6 }, positionIterations: 3, velocityIterations: 2 })
  private catchers = new Map<Receiver, Matter.Body>()
  private budget = MAX_MOVING_GRAINS
  private density = 1
  setDetail(detail: 'low' | 'normal' | 'high') {
    this.budget = { low: 12, normal: 30, high: MAX_MOVING_GRAINS }[detail]
    this.density = this.budget / MAX_MOVING_GRAINS
    while (this.moving.length > this.budget) this.remove(0)
    const marks = Math.round(MAX_SPILL_DOTS * this.density)
    if (this.residue.length > marks) this.residue.splice(0, this.residue.length - marks)
  }

  private debt = 0
  private seen = 0

  constructor() {
    Composite.add(this.engine.world, Bodies.rectangle(0, 20, 1600, 40, { isStatic: true, friction: 0.72 }))
  }

  private remove(index: number) {
    Composite.remove(this.engine.world, this.moving[index].body)
    this.moving.splice(index, 1)
  }

  private emit(event: PowderTransfer) {
    const receiver = isReceiver(event.to) ? event.to : null
    const spec = receiver && surfaces[receiver]
    const tx = worldX(event.targetX), tz = worldZ(event.targetY)
    const category = spec ? spec.category : 256
    if (receiver && spec) {
      let catcher = this.catchers.get(receiver)
      if (!catcher) {
        catcher = Bodies.rectangle(0, 0, spec.width * PX, 8, {
          isStatic: true, friction: 0.78, restitution: 0.06,
          collisionFilter: { category, mask: category },
        })
        this.catchers.set(receiver, catcher)
        Composite.add(this.engine.world, catcher)
      }
      Body.setPosition(catcher, { x: tx * PX, y: -spec.height * PX + 4 })
    }
    const height = spec ? spec.height : 0
    const lip = event.from.startsWith('jar') ? 1.22 : event.from === 'spatula' ? 0.99
      : event.from === 'mortar' ? 1.08 : event.from === 'vial' ? 0.78 : 0.69
    const x = worldX(event.x), z = worldZ(event.y)
    const travelTime = Math.sqrt(2 * Math.max(0.10, lip - height) / GRAVITY)
    const count = Math.min(7, Math.max(1, Math.ceil(event.grams * 68 * this.density)))
    for (let i = 0; i < count; i++) {
      if (this.moving.length >= this.budget) this.remove(0)
      const seed = event.id * 5 + i
      const scatter = stream[seed % stream.length]
      const radius = 0.024 + (seed % 6) * 0.0028
      const releaseX = x + scatter.x * 0.23
      const releaseZ = z + scatter.z * 0.23
      const body = Bodies.circle(releaseX * PX, -(lip + i * 0.014) * PX, radius * PX, {
        restitution: 0.23, friction: 0.65, frictionAir: 0.009, slop: 0.02,
        collisionFilter: { category, mask: category | 1 },
      }, 8)
      // Successful streams converge on the receiver. Misses fan out across the bench.
      const spread = receiver === 'spatula' ? 0.43 : receiver ? 0.84 : 1.9
      Body.setVelocity(body, {
        x: ((tx - releaseX + scatter.x * spread) / travelTime) * PX * STEP,
        y: -0.31 * ((seed % 3) + 1),
      })
      Composite.add(this.engine.world, body)
      this.moving.push({ body, x: releaseX, y: lip, z: releaseZ, kind: event.kind, radius,
        receiver, dz: (tz - releaseZ + scatter.z * spread) / travelTime, age: 0 })
    }
  }

  advance(transfers: readonly PowderTransfer[], sequence: number, elapsed: number) {
    if (sequence < this.seen) this.reset()
    if (sequence !== this.seen) {
      for (const event of transfers) if (event.id > this.seen) this.emit(event)
      this.seen = sequence
    }
    if (!this.moving.length) { this.debt = 0; return }
    this.debt += Math.min(Math.max(0, elapsed), 4 * STEP)
    while (this.debt + 1e-10 >= STEP) {
      Engine.update(this.engine, STEP * 1000)
      this.debt -= STEP
      for (let i = this.moving.length - 1; i >= 0; i--) {
        const grain = this.moving[i], body = grain.body
        grain.age += STEP
        grain.x = body.position.x / PX
        grain.y = -body.position.y / PX
        grain.z += grain.dz * STEP
        const restingHeight = grain.receiver && isReceiver(grain.receiver) ? surfaces[grain.receiver].height : 0
        grain.dz *= grain.y < restingHeight + grain.radius * 2 ? 0.70 : 0.99
        const settled = grain.age > 0.18 && body.speed < 0.28
        if (!settled && grain.age < 1.5) continue
        if (!grain.receiver) {
          if (this.residue.length >= Math.round(MAX_SPILL_DOTS * this.density)) this.residue.shift()
          this.residue.push({ x: grain.x, y: grain.radius * 0.60, z: grain.z, kind: grain.kind, radius: grain.radius })
        }
        this.remove(i)
      }
    }
  }

  reset() {
    for (let i = this.moving.length - 1; i >= 0; i--) this.remove(i)
    this.residue.length = 0
    this.seen = 0
    this.debt = 0
    Engine.clear(this.engine)
  }
}

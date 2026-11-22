import Matter from 'matter-js'
import type { GameState, ObjectId, Station } from './contract.ts'

const { Bodies, Body, Composite, Engine, Events } = Matter
// The rendered bench is 12 by 6.5 scene units. Preserve that aspect ratio for contact normals.
const WIDTH = 1200
const DEPTH = 650
const EQUIPMENT = 1
const FIXTURE = 2
const GLOVE = 4
const GLOVE_RADIUS = 22
const world = (p: Station) => ({ x: p.x * WIDTH, y: p.y * DEPTH })
const zero = { x: 0, y: 0 }

const footprints = {
  jarA: { radius: 36, mass: 1.4 },
  jarB: { radius: 36, mass: 1.4 },
  jarC: { radius: 36, mass: 1.4 },
  mortar: { radius: 54, mass: 3.6 },
  vial: { radius: 22, mass: 0.42 },
  cap: { radius: 18, mass: 0.12 },
  foil: { width: 72, depth: 47, angle: 0.13, mass: 0.16 },
  foil2: { width: 72, depth: 47, angle: -0.19, mass: 0.16 },
  spatula: { width: 98, depth: 13, angle: -0.72, mass: 0.38 },
  pestle: { width: 94, depth: 25, angle: 0.7, mass: 1.3 },
} as const

type LooseId = keyof typeof footprints
const looseIds = Object.keys(footprints) as LooseId[]
const initialAngle = (id: LooseId) => {
  const f = footprints[id]
  return 'angle' in f ? f.angle : 0
}
export type Impact = { id: LooseId; direction: number }

export class TablePhysics {
  private engine = Engine.create({ gravity: { x: 0, y: 0, scale: 0 } })
  private glove: Matter.Body
  private bodies = new Map<LooseId, Matter.Body>()
  private ids = new Map<Matter.Body, LooseId>()
  private impacts: Impact[] = []
  private gloveVelocity = { x: 0, y: 0 }

  constructor(s: GameState) {
    const fixture = { isStatic: true, collisionFilter: { category: FIXTURE, mask: EQUIPMENT } }
    const scale = world(s.objects.scale)
    const fixtures = [
      Bodies.rectangle(scale.x, scale.y, 148, 88, { ...fixture, chamfer: { radius: 12 } }),
      Bodies.rectangle(-50, DEPTH / 2, 100, DEPTH + 200, fixture),
      Bodies.rectangle(WIDTH + 50, DEPTH / 2, 100, DEPTH + 200, fixture),
      Bodies.rectangle(WIDTH / 2, -50, WIDTH + 200, 100, fixture),
      Bodies.rectangle(WIDTH / 2, DEPTH + 50, WIDTH + 200, 100, fixture),
    ]
    const hand = world(s.hand)
    this.glove = Bodies.circle(hand.x, hand.y, GLOVE_RADIUS, {
      isStatic: true, collisionFilter: { category: GLOVE, mask: EQUIPMENT },
    })
    Composite.add(this.engine.world, [...fixtures, this.glove])
    for (const id of looseIds) {
      const f = footprints[id]
      const { x, y } = world(s.objects[id])
      const options = {
        frictionAir: 0.13, friction: 0.35, restitution: 0.13,
        collisionFilter: { category: EQUIPMENT, mask: EQUIPMENT | FIXTURE },
      }
      const body = 'radius' in f
        ? Bodies.circle(x, y, f.radius, options)
        : Bodies.rectangle(x, y, f.width, f.depth, { ...options, angle: f.angle, chamfer: { radius: 4 } })
      Body.setAngle(body, initialAngle(id) - (s.objects[id].yaw ?? 0))
      Body.setMass(body, f.mass)
      this.bodies.set(id, body)
      this.ids.set(body, id)
      Composite.add(this.engine.world, body)
      if (id === s.hand.held || (id === 'foil' && x === scale.x && y === scale.y)) this.lift(id)
    }
    Events.on(this.engine, 'collisionStart', ({ pairs }) => {
      for (const { collision: { bodyA, bodyB, normal } } of pairs) {
        const a = bodyA === this.glove ? this.gloveVelocity : Body.getVelocity(bodyA)
        const b = bodyB === this.glove ? this.gloveVelocity : Body.getVelocity(bodyB)
        // Matter velocities are displacement per nominal 60 Hz frame. The normal points B -> A.
        const closing = (b.x - a.x) * normal.x + (b.y - a.y) * normal.y
        const speed = closing * 60 * Math.hypot(normal.x / WIDTH, normal.y / DEPTH)
        this.recordImpact(bodyA, bodyB, speed, normal.x)
        this.recordImpact(bodyB, bodyA, speed, -normal.x)
      }
    })
  }

  private recordImpact(body: Matter.Body, other: Matter.Body, speed: number, direction: number) {
    const id = this.ids.get(body)
    if (!id || body.isStatic) return
    // A light loose cap transfers much less momentum to a jar than the driven glove does.
    const share = other.isStatic ? 1 : other.mass / (other.mass + body.mass)
    if (speed * share > (id === 'mortar' ? 2.3 : 1.45))
      this.impacts.push({ id, direction: direction >= 0 ? 1 : -1 })
  }

  lift(id: ObjectId) {
    const body = this.bodies.get(id as LooseId)
    if (!body) return
    body.collisionFilter.mask = 0
    Body.setStatic(body, true)
    Body.setVelocity(body, zero)
  }

  release(id: ObjectId, at: Station, velocity: Station, onPan: boolean) {
    const body = this.bodies.get(id as LooseId)
    if (!body) return
    Body.setAngle(body, initialAngle(id as LooseId))
    Body.setPosition(body, world(at))
    if (onPan) return
    Body.setStatic(body, false)
    Body.setAngularVelocity(body, 0)
    body.collisionFilter.mask = EQUIPMENT | FIXTURE
    // When the hand is at rest, set the object down. A moving release retains horizontal momentum.
    const v = world(velocity)
    Body.setVelocity(body, { x: v.x / 60, y: v.y / 60 })
    this.confine(body)
  }

  private confine(body: Matter.Body) {
    // A kinematic glove can pin a body against the rail; keep even a corner release on the table.
    let dx = 0, dy = 0
    for (const v of body.vertices) {
      if (v.x < 0) dx = Math.max(dx, -v.x)
      if (v.x > WIDTH) dx = Math.min(dx, WIDTH - v.x)
      if (v.y < 0) dy = Math.max(dy, -v.y)
      if (v.y > DEPTH) dy = Math.min(dy, DEPTH - v.y)
    }
    if (dx || dy) {
      Body.translate(body, { x: dx, y: dy })
      const v = Body.getVelocity(body)
      Body.setVelocity(body, { x: dx * v.x < 0 ? 0 : v.x, y: dy * v.y < 0 ? 0 : v.y })
    }
  }

  step(s: GameState, aim: Station, dt: number) {
    const h = s.hand
    const previous = { ...this.glove.position }
    Body.setPosition(this.glove, world(h))
    // The static glove does not integrate. Give the solver its actual displacement for this tick.
    Body.setVelocity(this.glove, {
      x: this.glove.position.x - previous.x, y: this.glove.position.y - previous.y,
    })
    this.gloveVelocity.x = (this.glove.position.x - previous.x) / (dt * 60)
    this.gloveVelocity.y = (this.glove.position.y - previous.y) / (dt * 60)
    for (const [id, body] of this.bodies) {
      if (body.isStatic) continue
      const o = s.objects[id]
      // Aim over an item to reach above it. Keep the glove raised until it clears that item,
      // so leaving a bottle mouth or a mortar after stirring cannot drag it along.
      if (Math.hypot(aim.x - o.x, aim.y - o.y) < 0.145) {
        body.collisionFilter.mask = EQUIPMENT | FIXTURE
      } else if (!(body.collisionFilter.mask! & GLOVE)) {
        const pad = GLOVE_RADIUS + 1
        if (previous.x < body.bounds.min.x - pad || previous.x > body.bounds.max.x + pad ||
            previous.y < body.bounds.min.y - pad || previous.y > body.bounds.max.y + pad)
          body.collisionFilter.mask = EQUIPMENT | FIXTURE | GLOVE
      }
    }
    this.impacts.length = 0
    Engine.update(this.engine, dt * 1000)
    for (const [id, body] of this.bodies) {
      if (body.isStatic) continue
      this.confine(body)
      s.objects[id].x = body.position.x / WIDTH
      s.objects[id].y = body.position.y / DEPTH
      s.objects[id].yaw = initialAngle(id) - body.angle
    }
    return this.impacts
  }
}

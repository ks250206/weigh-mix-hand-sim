import Matter from 'matter-js'
import { isFoil, isTool, isWeighFoil } from './contract.ts'
import type { GameState, ObjectId, Station } from './contract.ts'
import { cleanerGeometry, foilOutline, heldObjectHeight, scaleGeometry, sceneDistance, TOPPLE_ANGLE, vesselGeometry, WORLD_DEPTH, WORLD_WIDTH } from './geometry.ts'

const { Bodies, Body, Composite, Engine, Events } = Matter
// The rendered bench is 12 by 6.5 scene units. Preserve that aspect ratio for contact normals.
const WIDTH = WORLD_WIDTH * 100
const DEPTH = WORLD_DEPTH * 100
const EQUIPMENT = 1
const FIXTURE = 2
const GLOVE = 4
const CARRIED = 8
const GLOVE_RADIUS = 22
const world = (p: Station) => ({ x: p.x * WIDTH, y: p.y * DEPTH })
const zero = { x: 0, y: 0 }

const flatSheet = { width: 96, depth: 96, angle: 0, mass: 0.16 }
const footprints = {
  jarA: { radius: vesselGeometry.jarA.radius * 100, mass: 1.4 },
  jarB: { radius: vesselGeometry.jarB.radius * 100, mass: 1.4 },
  jarC: { radius: vesselGeometry.jarC.radius * 100, mass: 1.4 },
  mortar: { radius: vesselGeometry.mortar.radius * 100, mass: 3.6 },
  vial: { radius: vesselGeometry.vial.radius * 100, mass: 0.42 },
  cap: { radius: vesselGeometry.cap.radius * 100, mass: 0.12 },
  foil: flatSheet,
  foilB: flatSheet,
  foilC: flatSheet,
  foil2: flatSheet,
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
  private creaseCounts = new Map<LooseId, number>()
  private impacts: Impact[] = []
  private gloveVelocity = { x: 0, y: 0 }
  private carriedVelocity = { x: 0, y: 0 }
  private carried: Matter.Body | undefined
  private supported: LooseId | null = null
  private shapeVersions = new Map<LooseId, string>()

  constructor(s: GameState) {
    const fixture = { isStatic: true, collisionFilter: { category: FIXTURE, mask: EQUIPMENT } }
    const scale = world(s.objects.scale)
    const fixtures = [
      Bodies.rectangle(scale.x, scale.y, scaleGeometry.width * 100, scaleGeometry.depth * 100, { ...fixture, chamfer: { radius: 8 } }),
      Bodies.rectangle(-50, DEPTH / 2, 100, DEPTH + 200, fixture),
      Bodies.rectangle(WIDTH + 50, DEPTH / 2, 100, DEPTH + 200, fixture),
      Bodies.rectangle(WIDTH / 2, -50, WIDTH + 200, 100, fixture),
      Bodies.rectangle(WIDTH / 2, DEPTH + 50, WIDTH + 200, 100, fixture),
    ]
    const cleaner = s.objects.cleaner
    if (cleaner) fixtures.push(Bodies.rectangle(cleaner.x * WIDTH, cleaner.y * DEPTH,
      cleanerGeometry.width * 100, cleanerGeometry.depth * 100, { ...fixture, chamfer: { radius: 7 } }))
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
      if (id === s.hand.held || (isWeighFoil(id) && x === scale.x && y === scale.y)) this.lift(id)
    }
    Events.on(this.engine, 'collisionStart', ({ pairs }) => {
      for (const { collision: { bodyA, bodyB, normal } } of pairs) {
        const a = bodyA === this.glove ? this.gloveVelocity : bodyA === this.carried ? this.carriedVelocity : Body.getVelocity(bodyA)
        const b = bodyB === this.glove ? this.gloveVelocity : bodyB === this.carried ? this.carriedVelocity : Body.getVelocity(bodyB)
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
    if (!id || body.isStatic || id === this.supported) return
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
    Body.setAngle(body, initialAngle(id as LooseId) - ('yaw' in at && typeof at.yaw === 'number' ? at.yaw : 0))
    Body.setPosition(body, world(at))
    if (onPan) {
      body.collisionFilter.category = EQUIPMENT
      body.collisionFilter.mask = 0
      Body.setStatic(body, true)
      return
    }
    Body.setStatic(body, false)
    Body.setAngularVelocity(body, 0)
    body.collisionFilter.category = EQUIPMENT
    body.collisionFilter.mask = EQUIPMENT | FIXTURE
    // When the hand is at rest, set the object down. A moving release retains horizontal momentum.
    const v = world(velocity)
    Body.setVelocity(body, { x: v.x / 60, y: v.y / 60 })
    this.confine(body)
  }

  private updateSheet(id: LooseId, body: Matter.Body, object: GameState['objects'][ObjectId]) {
    const count = object.unfolded ? 3 : object.foldCount
    if ((this.creaseCounts.get(id) ?? 0) === count) return
    this.creaseCounts.set(id, count)
    const angle = body.angle
    const position = { ...body.position }
    Body.setAngle(body, 0)
    Body.setVertices(body, foilOutline(object).map(p => ({ x: p.x * 100, y: p.z * 100 })))
    Body.setMass(body, flatSheet.mass)
    // Until the second fold, the hand and the printed crease both refer to the
    // original square's center. Matter normally centers every new outline.
    if (count === 1) {
      const h = 48
      Body.translate(body, { x: -h / 3, y: h / 3 })
      Body.setCentre(body, { x: h / 3, y: -h / 3 }, true)
    }
    Body.setAngle(body, angle)
    Body.setPosition(body, position)
  }

  private updateVessel(id: LooseId, body: Matter.Body, s: GameState, dt: number) {
    if (!(id in vesselGeometry) || id === 'cap') return
    const spec = vesselGeometry[id as keyof typeof vesselGeometry]
    const object = s.objects[id]
    const target = object.toppled ? Math.sign(object.tilt || 1) * TOPPLE_ANGLE : 0
    const previous = object.toppleAngle ?? 0
    let angleNow = previous + (target - previous) * (1 - Math.exp(-dt * 12))
    if (Math.abs(target - angleNow) < 0.003) angleNow = target
    object.toppleAngle = angleNow
    const amount = Math.abs(angleNow) / TOPPLE_ANGLE
    const version = amount === 0 ? 'upright' : String(Math.round(amount * 50))
    if (this.shapeVersions.get(id) === version || (!amount && !this.shapeVersions.has(id))) return
    this.shapeVersions.set(id, version)
    const center = { ...body.position }, angle = body.angle
    Body.setAngle(body, 0)
    if (!amount) {
      const circle = Bodies.circle(0, 0, spec.radius * 100)
      Body.setVertices(body, circle.vertices)
    } else {
      const tilt = Math.abs(angleNow)
      const length = (2 * spec.radius * Math.cos(tilt) + spec.height * Math.sin(tilt)) * 100
      const depth = spec.radius * 200
      Body.setVertices(body, [
        { x: -length / 2, y: -depth / 2 }, { x: length / 2, y: -depth / 2 },
        { x: length / 2, y: depth / 2 }, { x: -length / 2, y: depth / 2 },
      ])
    }
    if (!body.isStatic) Body.setMass(body, footprints[id].mass)
    Body.setAngle(body, angle)
    Body.setPosition(body, center)
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
    const support = s.supportTarget && this.bodies.has(s.supportTarget as LooseId) &&
      !s.objects[s.supportTarget].toppled && s.supportTarget !== h.held ? s.supportTarget as LooseId : null
    if (this.supported !== support) {
      if (this.supported && this.supported !== h.held) {
        const body = this.bodies.get(this.supported)!
        Body.setStatic(body, false)
        Body.setVelocity(body, zero)
      }
      this.supported = support
      if (support) {
        const body = this.bodies.get(support)!
        Body.setStatic(body, true)
        Body.setVelocity(body, zero)
      }
    }
    this.carried = h.held ? this.bodies.get(h.held as LooseId) : undefined
    if (this.carried && h.held) {
      const before = { ...this.carried.position }
      Body.setPosition(this.carried, world(h))
      Body.setAngle(this.carried, initialAngle(h.held as LooseId) - (s.objects[h.held].yaw ?? 0))
      this.carriedVelocity = { x: (this.carried.position.x - before.x) / (dt * 60), y: (this.carried.position.y - before.y) / (dt * 60) }
      Body.setVelocity(this.carried, this.carriedVelocity)
      this.carried.collisionFilter.category = CARRIED
      this.carried.collisionFilter.mask = EQUIPMENT
    }
    const previous = { ...this.glove.position }
    Body.setPosition(this.glove, world(h))
    // The static glove does not integrate. Give the solver its actual displacement for this tick.
    Body.setVelocity(this.glove, {
      x: this.glove.position.x - previous.x, y: this.glove.position.y - previous.y,
    })
    this.gloveVelocity.x = (this.glove.position.x - previous.x) / (dt * 60)
    this.gloveVelocity.y = (this.glove.position.y - previous.y) / (dt * 60)
    for (const [id, body] of this.bodies) {
      const o = s.objects[id]
      this.updateVessel(id, body, s, dt)
      if (body.isStatic) continue
      if (isFoil(id)) this.updateSheet(id, body, o)
      // Aim over an item to reach above it. Keep the glove raised until it clears that item,
      // so leaving a bottle mouth or a mortar after stirring cannot drag it along.
      const radius = id in vesselGeometry ? vesselGeometry[id as keyof typeof vesselGeometry].radius : isFoil(id) ? 0.6 : 0.5
      if (sceneDistance(aim, o) < radius + 0.38) {
        body.collisionFilter.mask = EQUIPMENT | FIXTURE
      } else if (!(body.collisionFilter.mask! & GLOVE)) {
        const pad = GLOVE_RADIUS + 1
        if (previous.x < body.bounds.min.x - pad || previous.x > body.bounds.max.x + pad ||
            previous.y < body.bounds.min.y - pad || previous.y > body.bounds.max.y + pad)
          body.collisionFilter.mask = EQUIPMENT | FIXTURE | GLOVE
      }
      // The working tip may enter its receiver. A carried object still strikes other
      // tall equipment along its route; short tools and foil pass underneath it.
      const tall = id in vesselGeometry && vesselGeometry[id as keyof typeof vesselGeometry].height > heldObjectHeight(s) + 0.03
      const nearbyWork = (h.held === 'spatula' && ['jarA', 'jarB', 'jarC'].includes(id) && o.open && sceneDistance(aim, o) < 1.0)
        || (h.held === 'pestle' && id === 'mortar' && sceneDistance(aim, o) < 1.05)
      const workingReceiver = nearbyWork || ((id === s.interactionTarget || id === s.target) && h.held &&
        (isTool(h.held) || isFoil(h.held) || h.held === 'mortar'))
      if (this.carried && tall && !workingReceiver) body.collisionFilter.mask! |= CARRIED
      else body.collisionFilter.mask! &= ~CARRIED
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

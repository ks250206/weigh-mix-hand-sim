import { HOME, foilHalfSide, isFoil, isWeighFoil, mass } from './contract.ts'
import type { GameState, ObjectId, Station, TableObject } from './contract.ts'

/** Scene units, shared by contact, interaction, pouring and drawing. */
export const WORLD_WIDTH = 12
export const WORLD_DEPTH = 6.5
export const TOPPLE_ANGLE = 1.36
export const sceneDistance = (a: Station, b: Station) =>
  Math.hypot((a.x - b.x) * WORLD_WIDTH, (a.y - b.y) * WORLD_DEPTH)
export const toWorld = (p: Station) => ({ x: (p.x - 0.5) * WORLD_WIDTH, z: (p.y - 0.5) * WORLD_DEPTH })
export const vesselGeometry = {
  jarA: { radius: 0.49, height: 1.41, mouth: 0.29 },
  jarB: { radius: 0.49, height: 1.41, mouth: 0.29 },
  jarC: { radius: 0.49, height: 1.41, mouth: 0.29 },
  mortar: { radius: 0.70, height: 0.75, mouth: 0.59 },
  vial: { radius: 0.26, height: 0.80, mouth: 0.184 },
  cap: { radius: 0.248, height: 0.16, mouth: 0 },
} as const
export const scaleGeometry = { width: 1.59, depth: 1.40, panHeight: 0.515, panRadius: 0.61 }
export const cleanerGeometry = { width: 1.42, depth: 1.0, height: 0.9 }
export const isJar = (id: ObjectId): id is 'jarA' | 'jarB' | 'jarC' => id === 'jarA' || id === 'jarB' || id === 'jarC'
export const jarPowderHeight = (o: TableObject) => 0.19 + 0.917 * Math.sqrt(Math.min(1, mass(o) / 5))

/** Container3D.origin rotates about position + origin, unlike a conventional pivot. */
export function vesselPose(id: ObjectId, o: TableObject) {
  const spec = id in vesselGeometry && id !== 'cap' ? vesselGeometry[id as keyof typeof vesselGeometry] : null
  const angle = spec ? o.toppleAngle ?? (o.toppled ? Math.sign(o.tilt || 1) * TOPPLE_ANGLE : 0) : 0
  if (!spec || (!o.toppled && angle === 0)) return { tilt: o.tilt, originY: 0, offsetY: 0 }
  const originY = spec.height * 0.5 * Math.min(1, Math.abs(angle) / TOPPLE_ANGLE)
  return {
    tilt: angle,
    originY,
    offsetY: originY * (Math.cos(angle) - 1) + spec.radius * Math.abs(Math.sin(angle)),
  }
}

/** The same outline is used by Matter and mouse picking; no invisible square after a fold. */
export function foilOutline(o: Pick<TableObject, 'foldCount' | 'unfolded'>): { x: number; z: number }[] {
  const h = foilHalfSide
  if (o.unfolded || o.foldCount === 0)
    return [{ x: -h, z: -h }, { x: h, z: -h }, { x: h, z: h }, { x: -h, z: h }]
  if (o.foldCount === 1) return [{ x: -h, z: -h }, { x: h, z: h }, { x: -h, z: h }]
  return [{ x: -h / 3, z: -h }, { x: 2 * h / 3, z: 0 }, { x: -h / 3, z: h }]
}
export function pointOnFoil(o: TableObject, x: number, z: number, padding = 0.025) {
  const a = o.yaw ?? 0, c = Math.cos(a), sn = Math.sin(a)
  const lx = x * c - z * sn, lz = z * c + x * sn
  const points = foilOutline(o)
  let sign = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length]
    const cross = (q.x - p.x) * (lz - p.z) - (q.z - p.z) * (lx - p.x)
    if (Math.abs(cross) <= padding * Math.hypot(q.x - p.x, q.z - p.z)) continue
    if (sign && Math.sign(cross) !== sign) return false
    sign = Math.sign(cross)
  }
  return true
}

export function receiverSpec(id: ObjectId, o: TableObject): { radius: number; height: number; floorHeight: number } | null {
  if (o.toppled) return null
  if (isJar(id)) return o.open ? { radius: vesselGeometry[id].mouth, height: 1.25, floorHeight: jarPowderHeight(o) } : null
  if (id === 'mortar') return { radius: vesselGeometry.mortar.mouth, height: 0.72, floorHeight: 0.36 }
  if (id === 'vial') return o.open ? { radius: vesselGeometry.vial.mouth, height: 0.75, floorHeight: 0.18 } : null
  if (isFoil(id)) {
    if (!o.unfolded) return null
    const base = isWeighFoil(id) && sceneDistance(o, HOME.scale) < 0.18 ? scaleGeometry.panHeight : 0
    return { radius: 0.41, height: base + 0.13, floorHeight: base + 0.095 }
  }
  return null
}

/** Tool working tips coincide with the pointer; their height follows the surface they approach. */
export function heldObjectHeight(s: GameState) {
  const { held } = s.hand
  if (held === 'spatula') {
    let height = 0.75
    for (const id of ['jarA', 'jarB', 'jarC'] as const) {
      const jar = s.objects[id]
      const reach = Math.max(0, Math.min(1, (1.1 - sceneDistance(s.hand, jar)) / 0.65))
      const workingHeight = 1.4 - s.scoopDepth * (1.4 - jarPowderHeight(jar))
      height = Math.max(height, 0.75 + reach * (workingHeight - 0.75))
    }
    const scale = s.objects.scale
    const overScale = Math.max(0, 1 - sceneDistance(s.hand, scale) / 0.95)
    height = Math.max(height, 0.75 + 0.29 * overScale)
    if (s.interactionTarget === 'cleaner' && sceneDistance(s.hand, s.objects.cleaner) < 0.9) height = 0.21
    return Math.abs(s.hand.tilt) > 0.2 ? clearReceiverRims(s, height) : height
  }
  if (held === 'pestle') {
    const bowl = s.objects.mortar, r = sceneDistance(s.hand, bowl)
    const contact = bowl.toppled ? 0 : Math.max(0, Math.min(1, (0.64 - r) / 0.18))
    return 0.90 * (1 - contact) + (0.30 + 0.87 * r * r) * contact
  }
  return clearReceiverRims(s, 0.5)
}

function lipOffset(id: ObjectId, o: TableObject) {
  const pose = vesselPose(id, o), tilt = pose.tilt, sign = tilt < 0 ? -1 : 1
  const lip = isJar(id) ? 1.25 : id === 'mortar' ? 0.72 : id === 'vial' ? 0.75 : isFoil(id) ? 0.12 : 0
  const edge = isJar(id) ? 0.29 : id === 'mortar' ? 0.59 : id === 'vial' ? 0.184 : isFoil(id) ? 0.40 : 0.10
  return {
    dx: sign * edge * Math.cos(tilt) + (lip - pose.originY) * Math.sin(tilt),
    dy: pose.offsetY + pose.originY + (lip - pose.originY) * Math.cos(tilt) - sign * edge * Math.sin(tilt),
  }
}
function clearReceiverRims(s: GameState, base: number) {
  const held = s.hand.held
  if (!held) return base
  const mouth = lipOffset(held, s.objects[held])
  let height = base
  for (const id of Object.keys(s.objects) as ObjectId[]) {
    if (id === held || id === 'cap') continue
    const spec = receiverSpec(id, s.objects[id])
    if (!spec) continue
    const reach = Math.max(0, Math.min(1, (1.6 - sceneDistance(s.hand, s.objects[id])) / 0.7))
    if (!reach) continue
    // There is no manual vertical axis: lift the lowest pouring edge above a nearby
    // receiver's rim. This exact height is also used to draw the hand and the stream.
    height = Math.max(height, base + Math.max(0, spec.height + 0.22 - mouth.dy - base) * reach)
  }
  return height
}

/** Lowest pour edge after rotating the vessel. Positive tilt really pours to the right. */
export function pourMouth(id: ObjectId, o: TableObject, rootHeight = 0.5): { x: number; y: number; height: number } {
  const { dx, dy } = lipOffset(id, o)
  // Tools rotate around their working point; vessel roots sit on their bottoms.
  const yaw = o.yaw ?? 0
  return {
    x: o.x + dx * Math.cos(yaw) / WORLD_WIDTH,
    y: o.y - dx * Math.sin(yaw) / WORLD_DEPTH,
    height: Math.max(0.025, rootHeight + dy),
  }
}

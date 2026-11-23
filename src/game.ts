import { DRY_SECONDS, HOME, LABELS, MIX, STEPS_PER_MATERIAL, activePowder, bottles, foilWeight, foldingFoil, foldStroke, inWork, isFoil, isTool, isWeighFoil, mass, powders, recipe, toolHandle, weighFoils, workPositions } from './contract.ts'
import type { GameInput, GameState, ObjectId, Powder, PowderTransfer, Station, TableObject } from './contract.ts'

import { TablePhysics, type Impact } from './physics.ts'
import { caughtFraction } from './powder.ts'
import { heldObjectHeight, isJar, pourMouth, receiverSpec, sceneDistance, vesselGeometry, WORLD_DEPTH, WORLD_WIDTH } from './geometry.ts'

const ROUND_SECONDS = 360
const REACH = 0.67
const POUR_REACH = 1.5
export const MASS_TOLERANCE = 0.002
const EPS = 1e-7

const SCOOP_SIZE = 0.4
const STOCK = { a: 5, b: 5, c: 5 }
const ALL_IDS = Object.keys(HOME) as ObjectId[]
const VESSELS: ObjectId[] = ['jarA', 'jarB', 'jarC', 'mortar', 'vial']

type EngineState = GameState & {
  taredSheets?: Set<ObjectId>
  recordedSheets?: Set<ObjectId>
  operationKey?: string
  operationProgress?: number
  completed?: Set<number>
  lastAccidentAt?: number
  spillEpisodeMass?: number
  scaleSettling?: number
  previousPanMass?: number
  spillFeedbackCooldown?: number
  creaseStart?: 0 | 1
  cornerToCorner?: boolean
  releaseCrease?: boolean
  releaseOperation?: boolean
  pendingTransfers?: Map<string, { transfer: Omit<PowderTransfer, 'id'>; started: number; updated: number }>
}
const tables = new WeakMap<GameState, TablePhysics>()

const STAGES = [
  ...powders.flatMap((p) => [
    LABELS[weighFoils[p]] + ' を折り、開く',
    LABELS[weighFoils[p]] + ' を天秤に載せる',
    LABELS[weighFoils[p]] + ' の風袋を引く',
    LABELS[bottles[p]] + ' を開栓',
    LABELS[bottles[p]] + ' の秤量',
    LABELS[bottles[p]] + ' の秤量値を記録',
    LABELS[bottles[p]] + ' を乳鉢へ',
  ]),
  '乳棒で混合',
  '回収ホイルを折り、開く',
  '混合粉を回収',
  'サンプル瓶に充填',
  'サンプル瓶を密栓',
]
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const dist = (a: Station, b: Station) => Math.hypot(a.x - b.x, a.y - b.y)
function panSheet(s: GameState) {
  return Object.values(weighFoils).find(id => s.hand.held !== id && sceneDistance(s.objects[id], HOME.scale) < 0.18)
}

export function createGame(mode: GameState['mode'] = 'standard'): GameState {
  const objects = {} as Record<ObjectId, TableObject>
  for (const id of ALL_IDS) {
    objects[id] = { ...HOME[id], tilt: 0, toppled: false, foldCount: 0, foldProgress: 0, folded: false, unfolded: false, spent: false, open: id === 'vial', a: 0, b: 0, c: 0 }
  }
  objects.jarA.a = STOCK.a
  objects.jarB.b = STOCK.b
  objects.jarC.c = STOCK.c
  const s: EngineState = {
    mode, elapsed: 0, stageNames: [...STAGES], stageTimes: STAGES.map(() => 0),
    discardedMass: { a: 0, b: 0, c: 0 },
    toolHygiene: { state: 'clean', residue: [], wipeProgress: 0, dryRemaining: 0, wipesUsed: 0 },
    mixCoverage: Array(8).fill(0), supportTarget: null,
    actionLabel: '操作', interactionTarget: null, actionReady: false, actionReason: '', professorFeedback: 'まずは道具の位置を確認しよう。',
    needs: { ...recipe }, stats: { accidents: 0, topples: 0, reweighs: 0, maxSpill: 0, completedSteps: 0 },
    taredSheets: new Set(), recordedSheets: new Set(), completed: new Set(),
    status: 'title',
    stage: 0,
    stageCount: STAGES.length,
    stageName: STAGES[0],
    hint: '',
    target: 'foil',
    remaining: ROUND_SECONDS,
    anger: 0,
    mixed: 0,
    scaleMass: 0,
    scaleStable: false,
    vialMass: 0,
    spilled: 0,
    recovery: 0,
    tared: false,
    scoopDepth: 0,
    readings: { a: 0, b: 0, c: 0 },
    spilledMass: { a: 0, b: 0, c: 0 },
    score: 0,
    message: '落ち着いて、まずはホイルから。',
    progress: 0,
    hand: { x: 0.48, y: 0.86, vx: 0, vy: 0, tilt: 0, held: null },
    objects,
    powderTransfers: [],
    transferSeq: 0,
  }
  describe(s, plan(s))
  return s
}

export function startGame(mode: GameState['mode'] = 'standard'): GameState {
  const s = createGame(mode)
  s.status = 'playing'
  return s
}

function go(s: EngineState, stage: number, message: string) {
  if (stage > s.stage) markCompleted(s, s.stage)
  s.stage = stage
  s.stageName = STAGES[stage]
  s.progress = 0
  s.message = message
}

function markCompleted(s: EngineState, stage: number) {
  s.completed ??= new Set()
  s.completed.add(stage)
  s.stats.completedSteps = s.completed.size
}

function bank(s: GameState, p: Powder) {
  return s.objects.mortar[p] + s.objects.foil2[p] + s.objects.vial[p]
}

function enough(amount: number, p: Powder) {
  return amount + EPS >= recipe[p] - MASS_TOLERANCE
}
function nextMaterial(s: EngineState) {
  const p = powders.find((p) => !enough(bank(s, p), p))
  if (!p) return false
  const first = powders.indexOf(p) * STEPS_PER_MATERIAL
  if (s.readings[p] > 0 && s.stage !== first) s.stats.reweighs++
  s.tared = false
  go(
    s,
    first,
    LABELS[bottles[p]] + ' を準備。あと ' + (recipe[p] - bank(s, p)).toFixed(3) + ' g。',
  )
  return true
}
// All powder moves between inventories or into the cumulative spill ledger.
function move(s: EngineState, from: ObjectId, to: ObjectId | null, p: Powder, max: number) {
  const src = s.objects[from]
  const amount = Math.min(src[p], Math.max(0, max))
  if (amount <= 0) return
  src[p] -= amount
  if (to) s.objects[to][p] += amount
  else {
    s.spilled += amount
    s.spilledMass[p] += amount
    s.anger = Math.min(100, s.anger + amount * 20)
    if (s.elapsed - (s.lastAccidentAt ?? -10) > 0.6) { s.stats.accidents++; s.spillEpisodeMass = 0 }
    s.lastAccidentAt = s.elapsed
    s.spillEpisodeMass = (s.spillEpisodeMass ?? 0) + amount
    s.stats.maxSpill = Math.max(s.stats.maxSpill, s.spillEpisodeMass)
    s.professorFeedback = amount > 0.1 ? '大きくこぼれたね。足りない量を確認して、取り戻そう。' : '縁から落ちているよ。注ぎ口を中央へ合わせよう。'
  }
  if (to && isWeighFoil(to)) s.recordedSheets?.delete(to)
  if (isWeighFoil(from) && to !== 'mortar') s.recordedSheets?.delete(from)
  const dest = to ? s.objects[to] : src
  const key = from + ':' + to + ':' + p
  s.pendingTransfers ??= new Map()
  const previous = s.pendingTransfers.get(key)
  if (previous) {
    previous.transfer.grams += amount
    previous.updated = s.elapsed
  } else {
    s.pendingTransfers.set(key, {
      started: s.elapsed, updated: s.elapsed,
      transfer: { from, to, kind: p, grams: amount, x: src.x, y: src.y, targetX: dest.x, targetY: dest.y },
    })
  }
}

// A stream fills a short batch, including its final few milligrams when the user releases the control.
function publishTransfers(s: EngineState) {
  if (!s.pendingTransfers) return
  for (const [key, { transfer, started, updated }] of s.pendingTransfers) {
    if (s.status === 'playing' && updated === s.elapsed && s.elapsed - started < 0.045 &&
        transfer.grams < 1 / 24 && s.objects[transfer.from][transfer.kind] > EPS) continue
    s.powderTransfers.push({ ...transfer, id: ++s.transferSeq })
    if (s.powderTransfers.length > 40) s.powderTransfers.shift()
    s.pendingTransfers.delete(key)
  }
}

function pour(s: GameState, from: ObjectId, to: ObjectId | null, amount: number) {
  const src = s.objects[from]
  const total = mass(src)
  if (total <= 0) return
  const fraction = Math.min(1, amount / total)
  for (const p of powders) move(s, from, to, p, src[p] * fraction)
}

function pickup(s: EngineState, table: TablePhysics) {
  const held = s.hand.held
  if (held) {
    const o = s.objects[held]
    if (isWeighFoil(held) && o.spent) {
      Object.assign(o, HOME[held], { foldCount: 0, foldProgress: 0, folded: false, unfolded: false, spent: false, tilt: 0, yaw: 0 })
      s.taredSheets?.delete(held)
      s.recordedSheets?.delete(held)
      table.release(held, o, { x: 0, y: 0 }, false)
      s.hand.held = null
      s.hand.tilt = 0
      s.message = '使用済みホイルを廃棄。予備の新しい正方形は左の棚にある。'
      return
    }
    const onPan = isWeighFoil(held) && sceneDistance(s.hand, HOME.scale) < 0.72
    if (onPan) {
      if (!o.unfolded) { s.message = 'ホイルは二度折ったあと開き、折り筋のある受け皿にしよう。'; return }
      if (!s.objects.scale.open) {
        s.message = '風防が閉じている。天秤の前で R を押して開けよう。'
        return
      }
      if (panSheet(s)) {
        s.message = '皿のホイルを先に取り出そう。'
        return
      }
      Object.assign(o, HOME.scale)
    } else {
      // Put the tool down locally, leaving enough clearance to pick either object up again.
      const free = (pos: Station) =>
        ALL_IDS.every(
          (id) => id === held || id === 'work' || dist(pos, s.objects[id]) > (id === 'scale' ? 0.112 : 0.078),
        )
      let spot: Station = { x: s.hand.x, y: s.hand.y }
      if (!free(spot)) {
        outer: for (const r of [0.09, 0.14, 0.2, 0.27])
          for (let i = 0; i < 12; i++) {
            const angle = (i * Math.PI) / 6
            const p = {
              x: clamp(s.hand.x + r * Math.cos(angle), 0.025, 0.975),
              y: clamp(s.hand.y + r * Math.sin(angle), 0.04, 0.97),
            }
            if (free(p)) {
              spot = p
              break outer
            }
          }
      }
      Object.assign(o, spot)
    }
    s.hand.toolPickup = undefined
    table.release(held, o, { x: s.hand.vx, y: s.hand.vy }, onPan)
    o.tilt = 0
    o.yaw = 0
    s.hand.held = null
    s.hand.tilt = 0
    return
  }
  let id: ObjectId | undefined
  let nearest = REACH
  for (const candidate of ALL_IDS) {
    if (candidate === 'scale' || candidate === 'work' || candidate === 'cleaner') continue
    const item = s.objects[candidate]
    let reach = sceneDistance(s.hand, item)
    if (isTool(candidate)) reach = Math.min(reach, sceneDistance(s.hand, toolHandle(candidate, item)))
    if (reach <= nearest) {
      nearest = reach
      id = candidate
    }
  }
  if (id && isWeighFoil(id) && panSheet(s) === id && !s.objects.scale.open) {
    s.message = '風防が閉じている。R で開けてから取り出そう。'
    return
  }
  if (!id) return
  const o = s.objects[id]
  if (o.toppled) {
    o.toppled = false
    o.tilt = 0
    s.message = `${LABELS[id]}を起こした。もう一度つかめるぞ。`
    return
  }
  table.lift(id)
  if (isTool(id)) s.hand.toolPickup = { x: o.x, y: o.y, yaw: o.yaw ?? 0, progress: 0 }
  o.yaw = 0
  s.hand.held = id
  s.hand.tilt = o.tilt
}

function applyImpacts(s: EngineState, impacts: Impact[]) {
  for (const { id, direction } of impacts) {
    const o = s.objects[id]
    if (!VESSELS.includes(id) || o.toppled) continue
    o.toppled = true
    o.tilt = direction * 0.98
    s.anger = Math.min(100, s.anger + 6)
    s.stats.accidents++
    s.stats.topples++
    s.lastAccidentAt = s.elapsed
    s.spillEpisodeMass = 0
    s.professorFeedback = '器具が倒れたね。まず起こして、残っている粉を確認しよう。'
    if (o.open || id === 'mortar') spillFromLip(s, id, Math.min(0.26, mass(o) * 0.22))
    s.message = `${LABELS[id]}が倒れた！ 近づいて「つかむ」で起こそう。`
  }
}

function spillFromLip(s: EngineState, id: ObjectId, amount: number) {
  if (mass(s.objects[id]) <= EPS || amount <= 0) return
  const held = s.hand.held === id
  const mouth = pourMouth(id, s.objects[id], held ? heldObjectHeight(s) : 0)
  pour(s, id, null, amount)
  for (const pending of s.pendingTransfers?.values() ?? []) {
    if (pending.transfer.from !== id || pending.transfer.to !== null) continue
    Object.assign(pending.transfer, {
      x: mouth.x, y: mouth.y, targetX: mouth.x, targetY: mouth.y,
      trajectory: { height: mouth.height, vx: held ? s.hand.vx * WORLD_WIDTH * 0.2 : 0,
        vz: held ? s.hand.vy * WORLD_DEPTH * 0.2 : 0, targetHeight: 0 },
    })
  }
}

function leakingVessels(s: EngineState, dt: number) {
  for (const id of VESSELS) {
    const o = s.objects[id]
    if (!o.toppled || (!o.open && id !== 'mortar') || mass(o) <= EPS) continue
    spillFromLip(s, id, (0.10 + mass(o) * 0.16) * dt)
    if ((s.spillFeedbackCooldown ?? 0) <= 0) {
      s.message = `${LABELS[id]} から粉が流れ出ている！ 手を空け、F で起こそう。`
      s.spillFeedbackCooldown = 0.8
    }
  }
}

function jostle(s: EngineState, input: GameInput, speed: number, dt: number) {
  const { held, tilt } = s.hand
  if (!held || mass(s.objects[held]) <= EPS) return
  if (isJar(held)) {
    if (!s.objects[held].open) return
    const directed = input.action ? interaction(s, input) : null
    if (directed?.ready && directed.op === 'transfer') return
    // An uncapped stock bottle cannot be carried sideways or jerked around safely.
    const rate = Math.max(0, Math.abs(tilt) - 0.72) * 0.65 + Math.max(0, speed - 1.35) * 0.12
    if (rate <= 0) return
    spillFromLip(s, held, rate * dt)
    if ((s.spillFeedbackCooldown ?? 0) <= 0) {
      s.message = '開いた原料瓶から粉がこぼれている。水平に戻し、運ぶ前に蓋を閉めよう。'
      s.spillFeedbackCooldown = 0.8
    }
    return
  }
  if (speed < 1.15 || Math.abs(tilt) < 0.72) return
  if (held !== 'spatula' && !isFoil(held) && held !== 'mortar') return
  const p = activePowder(s.stage) ?? 'a'
  const receiver = held === 'spatula' ? weighFoils[p] : held === 'foil2' ? 'vial' : held === 'mortar' ? 'foil2' : 'mortar'
  if (sceneDistance(s.hand, s.objects[receiver]) <= 0.9) return
  spillFromLip(s, held, (speed - 1) * Math.abs(tilt) * dt * 0.32)
  if ((s.spillFeedbackCooldown ?? 0) <= 0) {
    s.message = '傾けたまま急に運ぶと粉が飛ぶ！ 移動中は Q/E を離そう。'
    s.spillFeedbackCooldown = 0.8
  }
}

function transfer(s: EngineState, input: GameInput, from: ObjectId, to: ObjectId, dt: number) {
  if (s.hand.held !== from || !input.action || Math.abs(s.hand.tilt) < 0.20) return
  const source = s.objects[from], dest = s.objects[to], spec = receiverSpec(to, dest)
  if (!spec || mass(source) <= EPS) return
  const mouth = pourMouth(from, source, heldObjectHeight(s))
  const dx = (mouth.x - dest.x) * WORLD_WIDTH, dz = (mouth.y - dest.y) * WORLD_DEPTH
  const drop = Math.max(0.10, mouth.height - spec.height)
  const vx = s.hand.vx * WORLD_WIDTH * 0.20, vz = s.hand.vy * WORLD_DEPTH * 0.20
  const caught = caughtFraction(dx, dz, vx, vz, spec.radius, drop)
  // Fine dosing leaves roughly 0.2 seconds inside the ±2 mg window at full tilt.
  const dose = Math.min(mass(source), Math.abs(s.hand.tilt) * dt * (input.support ? 0.018 : 0.70))
  const trajectory = { height: mouth.height, vx, vz, targetHeight: spec.floorHeight }
  // The rendered particles start at the same signed lip that determines capture.
  const pendingBefore = new Set(s.pendingTransfers?.keys())
  pour(s, from, to, dose * caught)
  pour(s, from, null, dose * (1 - caught))
  for (const [key, pending] of s.pendingTransfers ?? []) {
    if (pending.transfer.from !== from || (pending.transfer.to !== to && pending.transfer.to !== null)) continue
    if (!pendingBefore.has(key)) {
      pending.transfer.x = mouth.x; pending.transfer.y = mouth.y
      pending.transfer.trajectory = { ...trajectory, targetHeight: pending.transfer.to ? spec.floorHeight : 0 }
    }
  }
  if (caught < 1 && dose > EPS && (s.spillFeedbackCooldown ?? 0) <= 0) {
    s.message = '注ぎ口が受け口から外れている。傾ける側を考えて器具をずらそう。'
    s.spillFeedbackCooldown = 0.8
  }
  if (isWeighFoil(from) && to === 'mortar' && mass(source) < EPS) {
    source.spent = true
    markCompleted(s, powders.indexOf(foilPowder(from)!) * STEPS_PER_MATERIAL + 6)
  }
  if (from === 'mortar' && to === 'foil2' && mass(source) < EPS) markCompleted(s, MIX + 2)
  if (from === 'foil2' && to === 'vial' && mass(source) < EPS) markCompleted(s, MIX + 3)
}

function discard(s: EngineState, from: ObjectId, amount: number) {
  const source = s.objects[from], total = mass(source)
  if (total <= EPS) return
  const fraction = Math.min(1, amount / total)
  for (const p of powders) {
    const dose = source[p] * fraction
    source[p] -= dose
    s.discardedMass[p] += dose
  }
  if (isWeighFoil(from)) s.recordedSheets?.delete(from)
}

function resetMix(s: GameState) {
  s.mixed = 0
  s.mixCoverage.fill(0)
}

const powderIn = (o: TableObject) => powders.filter(p => o[p] > EPS)
const foilPowder = (id: ObjectId) => powders.find(p => weighFoils[p] === id)
const bottlePowder = (id: ObjectId) => powders.find(p => bottles[p] === id)
const within = (amount: number, p: Powder) => Math.abs(amount - recipe[p]) <= MASS_TOLERANCE + EPS

type Operation =
  | 'aim'
  | 'fold'
  | 'place'
  | 'tare'
  | 'open'
  | 'scoop'
  | 'dispense'
  | 'read'
  | 'transfer'
  | 'mix'
  | 'seal'
  | 'unfold'
  | 'wipe'
  | 'discard'
  | 'wait'
interface Task {
  op: Operation
  target: ObjectId
  hint: string
  source?: ObjectId
  ready?: boolean
  reason?: string
}
const task = (target: ObjectId, hint: string, op: Operation = 'aim', source?: ObjectId): Task => ({
  target,
  hint,
  op,
  source,
})

function interaction(s: EngineState, input: GameInput): Task {
  const o = s.objects, held = s.hand.held
  const ready = (target: ObjectId, op: Operation, hint: string, source?: ObjectId): Task => ({ target, op, hint, source, ready: true })
  const blocked = (target: ObjectId, op: Operation, reason: string): Task => ({ target, op, hint: reason, reason, ready: false })
  const near = (id: ObjectId, reach: number) => sceneDistance(s.hand, o[id]) <= reach
  const atCleaner = near('cleaner', 0.72)
  const operatingScale = held === 'spatula' && mass(o.spatula) < EPS && near('scale', 0.76) && !o.scale.open && !!panSheet(s)
  if (held && atCleaner && input.discard) {
    return mass(o[held]) > EPS && held !== 'cap' && held !== 'pestle'
      ? ready('cleaner', 'discard', 'X 長押しで少量ずつ廃棄。Shift 併用でさらにゆっくり。', held)
      : blocked('cleaner', 'discard', '廃棄する粉がない。')
  }
  if (held === 'spatula' && atCleaner) {
    if (s.toolHygiene.state === 'wet') return blocked('cleaner', 'wait', `乾燥中。あと ${s.toolHygiene.dryRemaining.toFixed(1)} 秒待ってから粉に触れよう。`)
    if (s.toolHygiene.state === 'dirty' || mass(o.spatula) > EPS)
      return ready('cleaner', 'wipe', 'Space 長押し。新しいワイプと無水エタノールで清拭する。残粉は廃棄される。', 'spatula')
    return blocked('cleaner', 'wipe', '清拭・乾燥済み。次の原料に使える。')
  }
  if (held === 'pestle') {
    if (o.mortar.toppled) return blocked('mortar', 'mix', '乳鉢を起こしてから混ぜよう。')
    if (!near('mortar', vesselGeometry.mortar.mouth - 0.045)) return blocked('mortar', 'mix', '乳棒の先を乳鉢の内側へ入れよう。')
    if (!powders.every(p => within(bank(s, p), p))) return blocked('mortar', 'mix', '原料が過不足している。各原料の不足量を確認しよう。許容差は ±0.002 g。')
    if (mass(o.mortar) < EPS) return blocked('mortar', 'mix', '乳鉢に粉が入っていない。')
    return ready('mortar', 'mix', 'Space を押し、中心だけでなく周囲の8区画を巡って混ぜる。', held)
  }
  if (held === 'cap') {
    if (!near('vial', 0.35)) return blocked('vial', 'seal', '蓋をサンプル瓶の口に合わせよう。')
    if (o.vial.toppled) return blocked('vial', 'seal', 'サンプル瓶を起こしてから密栓しよう。')
    if (s.mixed < 100 || !powders.every(p => within(o.vial[p], p))) return blocked('vial', 'seal', '混合と瓶詰めがまだ終わっていない。各原料は目標 ±0.002 g が必要。')
    return ready('vial', 'seal', 'Space 長押しで密栓する。', held)
  }
  if (held === 'spatula' && !operatingScale && !input.tilt && Math.abs(s.hand.tilt) < 0.24) {
    const sources = [...Object.values(bottles), ...Object.values(weighFoils)]
      .filter(id => near(id, isJar(id) ? vesselGeometry[id].mouth - 0.015 : 0.36))
      .sort((a, b) => sceneDistance(s.hand, o[a]) - sceneDistance(s.hand, o[b]))
    const id = sources[0]
    if (id) {
      const p = bottlePowder(id) ?? foilPowder(id)!
      if (s.toolHygiene.state === 'wet') return blocked(id, 'scoop', 'スパチュラが濡れている。完全に乾くまで待とう。')
      if (s.toolHygiene.residue.some(kind => kind !== p)) return blocked('cleaner', 'wipe', '別の原料が付着している。残粉を戻し、新しいワイプと無水エタノールで清拭・乾燥しよう。')
      if (o[id].toppled) return blocked(id, 'scoop', '器具が倒れている。手を空けて F で起こそう。')
      if (isJar(id) && !o[id].open) return blocked(id, 'open', '原料瓶の蓋が閉じている。スパチュラを置いて開栓しよう。')
      if (isWeighFoil(id) && !o[id].unfolded) return blocked(id, 'unfold', 'ホイルを折ったあと開き、受け皿にしてから使おう。')
      if (isWeighFoil(id) && panSheet(s) === id && !o.scale.open) return blocked('scale', 'aim', '風防を R で開けよう。')
      if (o[id][p] <= EPS) return blocked(id, 'scoop', isJar(id) ? '原料瓶が空になった。残っている粉を回収するか、やり直そう。' : 'このホイルには粉がない。')
      if (mass(o.spatula) >= SCOOP_SIZE - EPS) return blocked(id, 'scoop', 'スパチュラが一杯。先に注ぐか、元の瓶へ戻そう。')
      return ready(id, 'scoop', isWeighFoil(id)
        ? 'Space を押しながら手前へ引き、超過分をすくう。元の瓶へ戻せる。'
        : 'Space を押しながら手前へ引いてすくう。目標量で自動停止しない。Shift 併用で少量ずつ。', held)
    }
  }
  if (held && !operatingScale && (held === 'spatula' || isFoil(held) || held === 'mortar' || isJar(held))) {
    if (isFoil(held) && !o[held].unfolded) return blocked(held, 'unfold', 'ホイルを置き、二度折ってから開いて使おう。')
    if (isJar(held) && !o[held].open) return blocked(held, 'open', '原料瓶が閉じている。置いて開栓しよう。')
    if (mass(o[held]) <= EPS) return blocked(held, 'transfer', '粉が入っていない。')
    const mouth = pourMouth(held, o[held], heldObjectHeight(s))
    const receivers = [...Object.values(weighFoils), ...Object.values(bottles), 'mortar', 'foil2', 'vial'] as ObjectId[]
    const candidates = receivers.filter(id => id !== held && sceneDistance(mouth, o[id]) <= POUR_REACH)
      .sort((a, b) => sceneDistance(mouth, o[a]) - sceneDistance(mouth, o[b]))
    const id = candidates[0]
    if (!id) return blocked(held, 'transfer', '受ける器具の近くへ運び、注ぎ口を合わせよう。')
    if (!receiverSpec(id, o[id])) return blocked(id, 'transfer', isFoil(id) ? '受けるホイルを二度折り、開いておこう。' : '受ける容器が閉じているか、倒れている。')
    const kinds = powderIn(o[held]), p = kinds.length === 1 ? kinds[0] : undefined
    if (isJar(id)) {
      if (!p || bottles[p] !== id || held === 'foil2' || held === 'mortar' || (held === 'spatula' && s.toolHygiene.residue.some(k => k !== p)))
        return blocked(id, 'transfer', '混合粉や別原料は元瓶へ戻せない。清拭台の廃棄受けで X を使おう。')
    } else if (isWeighFoil(id)) {
      if ((held !== 'spatula' && !isJar(held)) || !p || weighFoils[p] !== id)
        return blocked(id, 'transfer', '原料に対応する専用ホイルへ注ごう。混入する移し替えはできない。')
      if (panSheet(s) === id && !o.scale.open) return blocked('scale', 'aim', '風防を R で開けてから注ごう。')
    } else if (id === 'mortar') {
      if (!isWeighFoil(held)) return blocked(id, 'transfer', '秤量を記録した専用ホイルから乳鉢へ移そう。')
      if (!s.recordedSheets?.has(held)) return blocked('scale', 'read', '先に天秤へ載せ、風防を閉めて秤量値を記録しよう。')
    } else if (id === 'foil2') {
      if (held !== 'mortar' || s.mixed < 100) return blocked(id, 'transfer', '乳鉢で混合を完了してから回収ホイルへ移そう。')
    } else if (id === 'vial' && (held !== 'foil2' || s.mixed < 100)) return blocked(id, 'transfer', '混合済みの粉を回収ホイルから瓶へ移そう。')
    return ready(id, 'transfer', isJar(id)
      ? 'Space ＋ Q/E で同じ原料の元瓶へ戻す。注ぎ口の向きに合わせよう。'
      : '注ぎ口を受け口に合わせ、Space ＋ Q/E。Shift 併用で少量ずつ。', held)
  }
  if (!held) {
    const nearFoil = [...Object.values(weighFoils), 'foil2' as const]
      .filter(id => near(id, 0.82) && inWork(o[id]) && !o[id].spent)
      .sort((a, b) => sceneDistance(s.hand, o[a]) - sceneDistance(s.hand, o[b]))[0]
    if (nearFoil && !o[nearFoil].unfolded) {
      return o[nearFoil].folded
        ? ready(nearFoil, 'unfold', 'Space を一度離し、長押しで開く。折り筋付きの受け皿として使う。')
        : ready(nearFoil, 'fold', o[nearFoil].foldCount === 0 ? 'Space を押して対角線をなぞる。1回ごとに離そう。' : 'Space を押して2本目の折り目をなぞる。')
    }
    const jar = Object.values(bottles).find(id => near(id, 0.56) && inWork(o[id]))
    if (jar) return o[jar].toppled ? blocked(jar, 'open', '原料瓶が倒れている。F で起こそう。')
      : ready(jar, 'open', `Space 長押しで ${LABELS[jar]} を${o[jar].open ? '閉じる' : '開ける'}。`)
  }
  const sheet = panSheet(s)
  if (near('scale', 0.76) && sheet) {
    if (o.scale.open) return blocked('scale', 'tare', '風防を R で閉めてから操作しよう。')
    if (!s.scaleStable) return blocked('scale', s.taredSheets?.has(sheet) ? 'read' : 'tare', '表示が安定するまで少し待とう。天秤の前で手を止めてから記録する。')
    const p = foilPowder(sheet)!
    if (!s.taredSheets?.has(sheet)) return mass(o[sheet]) > EPS
      ? blocked('scale', 'tare', '粉の入ったホイルは風袋引きできない。粉を元瓶へ戻し、空にしよう。')
      : ready('scale', 'tare', 'Space 長押しで空の受け皿の風袋を引く。', sheet)
    const total = bank(s, p) + o[sheet][p]
    if (!within(total, p)) return blocked('scale', 'read', total > recipe[p]
      ? `多すぎる。あと ${(total - recipe[p]).toFixed(3)} g 減らそう。風防を開け、スパチュラですくい戻せる。`
      : `あと ${(recipe[p] - total).toFixed(3)} g。許容差は ±0.002 g。`)
    return ready('scale', 'read', 'Space 長押しで安定した正味質量を記録する。', sheet)
  }
  const guide = plan(s)
  return { ...guide, ready: false, reason: held ? 'まず器具の口・先端を対象に合わせよう。F で置くこともできる。' : '対象に手を近づけよう。F でつかむ／起こす。' }
}

function present(s: EngineState, input: GameInput) {
  const current = interaction(s, input), guide = plan(s)
  s.target = guide.target
  s.interactionTarget = current.target
  s.hint = current.ready ? current.hint : guide.hint
  s.actionReady = !!current.ready
  s.actionReason = current.ready ? '' : current.reason ?? '対象に近づこう。'
  const labels: Record<Operation, string> = { aim: '操作', fold: '折る', unfold: '開いて受け皿にする', place: '置く', tare: '風袋を引く', open: s.objects[current.target].open ? '蓋を閉める' : '開栓する', scoop: 'すくう', dispense: '注ぐ', read: '秤量を記録', transfer: '注ぐ／戻す', mix: '混ぜる', seal: '密栓する', wipe: '新しいワイプで清拭', discard: '微量廃棄 (X)', wait: '乾燥を待つ' }
  s.actionLabel = labels[current.op]
  for (const p of powders) s.needs[p] = recipe[p] - bank(s, p) - s.objects[weighFoils[p]][p]
  return current
}

function plan(s: GameState): Task {
  const o = s.objects,
    held = s.hand.held,
    p = activePowder(s.stage) ?? 'a',
    foil = weighFoils[p],
    bottle = bottles[p]
  const release = () => task(held!, o[held!].spent
    ? '使用済みの' + LABELS[held!] + ' を F で廃棄。次は新しい専用ホイルを使う。'
    : LABELS[held!] + ' を空いている場所で F で置く。器具は置いた位置に残る。')
  const door = (open: boolean) =>
    task('scale', '左奥の天秤に手を合わせ、R で風防を' + (open ? '開ける。' : '閉める。'))
  function take(id: ObjectId): Task {
    if (held) return release()
    if (id && isWeighFoil(id) && panSheet(s) === id && !o.scale.open) return door(true)
    return task(id, LABELS[id] + (isTool(id) ? ' の柄に手を合わせて F で握る。' : ' に手を合わせて F でつかむ。'))
  }
  function prepare(id: keyof typeof workPositions): Task | null {
    if (inWork(o[id]) && held !== id) return null
    if (held !== id) return take(id)
    Object.assign(o.work, workPositions[id])
    return task('work', LABELS[id] + ' を両腕の間に運ぶ。枠内の空いた場所で F を押して置く。')
  }
  function placeFoil(): Task | null {
    const onPan = panSheet(s)
    if (onPan === foil) return null
    if (onPan) return take(onPan)
    if (held !== foil) return take(foil)
    if (!o.scale.open) return door(true)
    return task('scale', '折った秤量ホイルを天秤の皿の中央へ運び、F で置く。')
  }
  function emptyHands(): Task | null {
    return held ? release() : null
  }
  function pourTask(source: ObjectId, dest: ObjectId): Task {
    return held === source
      ? task(dest, LABELS[dest] + ' の上で Space と Q または E を長押しして注ぐ。', 'transfer', source)
      : take(source)
  }

  const foldId = foldingFoil(s.stage)
  if (foldId) {
    if (held && o[held].spent) return release()
    return (
      prepare(foldId) ??
      emptyHands() ??
      (o[foldId].folded && !o[foldId].unfolded ? task(foldId, 'Space 長押しでホイルを開き、折り筋のある受け皿にする。', 'unfold') : task(foldId, o[foldId].foldCount === 0
        ? 'Space を押し、正方形の左奥と右手前を結ぶ対角線をなぞって三角に折る。'
        : 'Space を一度離し、押し直して三角の左手前の角と長辺の中央を結ぶ線をなぞる。', 'fold'))
    )
  }
  if (s.stage < MIX) {
    const phase = s.stage % STEPS_PER_MATERIAL
    if (phase === 1) return placeFoil() ?? task('scale', '秤量皿のホイルを確認。', 'place')
    if (phase === 2)
      return placeFoil() ?? (o.scale.open ? door(false)
        : task('scale', '風防を閉めた天秤の前で Space 長押し。空ホイルの質量を風袋引きする。', 'tare'))
    if (phase === 3)
      return (
        prepare(bottle) ??
        emptyHands() ??
        task(bottle, LABELS[bottle] + ' の蓋を Space 長押しで開ける。', 'open')
      )
    if (phase === 4) {
      const ready = placeFoil() ?? prepare(bottle)
      if (ready) return ready
      if (s.toolHygiene.state === 'wet' || s.toolHygiene.residue.some(kind => kind !== p))
        return held !== 'spatula' ? take('spatula')
          : task('cleaner', s.toolHygiene.state === 'wet' ? '清拭したスパチュラを乾燥させてから次の原料へ。'
            : '原料を変える前に清拭台へ。新しいワイプと無水エタノールで清拭し、乾燥を待つ。', 'wipe')
      if (!o.scale.open) return door(true)
      if (held !== 'spatula') return take('spatula')
      const remaining = Math.max(0, recipe[p] - bank(s, p) - o[foil][p])
      const current = o.spatula[p]
      if (current > EPS && remaining <= MASS_TOLERANCE)
        return task(bottle, 'ホイルは目標量に入った。スパチュラに残った余りを元の瓶へ戻そう。', 'transfer', 'spatula')
      if (bank(s, p) + o[foil][p] > recipe[p] + MASS_TOLERANCE)
        return task(foil, '多すぎる分をスパチュラですくい、元の瓶へ戻す。清拭台で X の微量廃棄もできる。', 'scoop')
      if (
        current <= EPS ||
        (dist(s.hand, o[bottle]) < 0.077 && current + EPS < Math.min(SCOOP_SIZE, remaining))
      ) {
        return task(bottle, '瓶口で Space を押し、先端を粉に入れて手前へ短く引く。離すと持ち上がる。', 'scoop')
      }
      return task(
        foil,
        '天秤内のホイルの上で Space ＋ Q/E で注ぐ。目標 ' + (recipe[p] - bank(s, p)).toFixed(3) + ' g。',
        'dispense',
      )
    }
    if (phase === 5)
      return (
        placeFoil() ??
        (o.scale.open
          ? door(false)
          : task('scale', '天秤の前で Space 長押し。閉じた風防の中で粉の正味質量を読み取る。', 'read'))
      )
    return prepare('mortar') ?? pourTask(foil, 'mortar')
  }
  if (s.stage === MIX)
    return (
      prepare('mortar') ??
      (held === 'pestle'
        ? task('mortar', '乳鉢の中で Space を押し、小さな円か往復を描く。', 'mix')
        : take('pestle'))
    )
  if (s.stage === MIX + 2) return prepare('foil2') ?? pourTask('mortar', 'foil2')
  if (s.stage === MIX + 3) return prepare('vial') ?? pourTask('foil2', 'vial')
  return (
    prepare('vial') ??
    (held === 'cap' ? task('vial', '瓶の口に蓋を合わせ、Space 長押しで締める。', 'seal') : take('cap'))
  )
}

function describe(s: GameState, t: Task) {
  s.target = t.target
  s.hint = s.objects[t.target].toppled ? LABELS[t.target] + ' が倒れている。手を空けて F で起こそう。' : t.hint
}

function fold(s: EngineState, sheet: TableObject, action: boolean) {
  function position(cornerToCorner: boolean) {
    const [a, b] = foldStroke(sheet, cornerToCorner)
    // Use scene units so the same tolerance applies in both bench dimensions.
    const dx = (b.x - a.x) * 12, dz = (b.y - a.y) * 6.5
    const hx = (s.hand.x - a.x) * 12, hz = (s.hand.y - a.y) * 6.5
    const length = Math.hypot(dx, dz)
    const along = (hx * dx + hz * dz) / (length * length)
    const offset = Math.abs(hx * dz - hz * dx) / length
    return { along, valid: offset <= 0.32 && along >= -0.45 && along <= 1.45 }
  }
  if (!action) {
    s.creaseStart = undefined
    s.releaseCrease = false
    sheet.foldProgress = 0
  } else if (!s.releaseCrease) {
    if (s.creaseStart === undefined) {
      // Either press the crease flat or bring a free corner to its opposite corner.
      for (const corners of [false, true]) {
        const { along, valid } = position(corners)
        if (!valid || (along > 0.23 && along < 0.77)) continue
        s.creaseStart = along <= 0.23 ? 0 : 1
        s.cornerToCorner = corners
        break
      }
    }
    const { along, valid } = position(!!s.cornerToCorner)
    if (!valid) {
      s.creaseStart = undefined
      sheet.foldProgress = 0
    } else if (s.creaseStart !== undefined) {
      const travel = s.creaseStart === 0 ? along : 1 - along
      sheet.foldProgress = clamp((travel - 0.23) / 0.57, 0, 1)
      if (sheet.foldProgress >= 1) {
        sheet.foldCount = sheet.foldCount === 0 ? 1 : 2
        sheet.folded = sheet.foldCount === 2
        sheet.foldProgress = 0
        s.creaseStart = undefined
        s.releaseCrease = true
        if (sheet.folded) {
          s.message = '二度折れた。Space を一度離し、長押ししてホイルを開こう。'
          return
        }
        s.message = '一度目の折り目が付いた。Space を離して次の線をなぞろう。'
      }
    }
  }
  s.progress = (sheet.foldCount + sheet.foldProgress) / 2
}

function advanceStages(s: EngineState) {
  const o = s.objects
  for (let transitions = 0; transitions < 10; transitions++) {
    const previous = s.stage
    if (s.stage < MIX) {
      const p = activePowder(s.stage)!, foil = weighFoils[p], phase = s.stage % STEPS_PER_MATERIAL
      if (phase === 0 && o[foil].unfolded && !o[foil].spent) go(s, s.stage + 1, '折り筋のある受け皿ができた。天秤に載せよう。')
      else if (phase === 1 && panSheet(s) === foil && o[foil].unfolded) go(s, s.stage + 1, '空の受け皿を載せた。風防を閉めて風袋を引こう。')
      else if (phase === 2 && s.taredSheets?.has(foil)) go(s, s.stage + 1, '風袋引き完了。原料を準備しよう。')
      else if (phase === 3 && o[bottles[p]].open) go(s, s.stage + 1, '原料瓶が開いた。取りすぎに注意して量ろう。')
      else if (phase === 4 && panSheet(s) === foil && s.taredSheets?.has(foil) && within(bank(s, p) + o[foil][p], p) && mass(o.spatula) < EPS)
        go(s, s.stage + 1, '許容差 ±0.002 g に入った。風防を閉めて記録しよう。')
      else if (phase === 5 && !within(bank(s, p) + o[foil][p], p)) go(s, s.stage - 1, '秤量を調整しよう。多い分はすくい戻せる。')
      else if (phase === 5 && s.recordedSheets?.has(foil)) go(s, s.stage + 1, '秤量を記録した。乳鉢へ移そう。')
      else if (phase === 6 && mass(o[foil]) < EPS) {
        o[foil].spent = true
        if (!nextMaterial(s)) go(s, MIX, '3原料がそろった。乳鉢全体を巡って混ぜよう。')
      }
    } else if (s.stage === MIX && powders.some(p => !enough(bank(s, p), p))) {
      nextMaterial(s)
    } else if (s.stage === MIX && s.mixed >= 100) {
      if (!nextMaterial(s)) go(s, o.foil2.unfolded ? MIX + 2 : MIX + 1, '混合完了。回収ホイルも折ったあと開いて使う。')
    } else if (s.stage === MIX + 1 && o.foil2.unfolded) go(s, MIX + 2, '回収用の受け皿ができた。')
    else if (s.stage === MIX + 2 && mass(o.mortar) < EPS) {
      if (!nextMaterial(s)) go(s, MIX + 3, '混合粉を回収した。サンプル瓶へ注ごう。')
    } else if (s.stage === MIX + 3 && mass(o.foil2) < EPS) {
      if (!nextMaterial(s)) go(s, MIX + 4, '瓶詰め完了。蓋を合わせて密栓しよう。')
    } else if (s.stage === MIX + 4) nextMaterial(s)
    if (s.stage === previous) break
  }
}

function work(s: EngineState, input: GameInput, dt: number, travel: number, forward: number) {
  const t = interaction(s, input), o = s.objects
  const key = t.op + ':' + t.target + ':' + (t.source ?? '')
  if (key !== s.operationKey) {
    s.operationKey = key
    s.operationProgress = 0
    s.creaseStart = undefined
  }
  if (!input.action) {
    s.releaseOperation = false
    s.releaseCrease = false
    s.operationProgress = 0
    s.toolHygiene.wipeProgress = 0
  }
  const dip = t.ready && t.op === 'scoop' && input.action && !input.tilt
  s.scoopDepth += ((dip ? 1 : 0) - s.scoopDepth) * (1 - Math.exp(-dt * 12))
  if (!t.ready) {
    if ((input.action || input.discard) && t.reason) s.message = t.reason
    s.operationProgress = 0
    if (t.op !== 'mix') s.progress = 0
    return
  }
  if (t.op === 'discard') {
    if (input.discard && t.source) {
      discard(s, t.source, dt * (input.support ? 0.025 : 0.16))
      s.message = '廃棄受けへ移している。床のこぼれとは別に記録する。'
      if (t.source === 'mortar') resetMix(s)
    }
    return
  }
  if (t.op === 'scoop') {
    if (dip && s.scoopDepth > 0.45 && forward * WORLD_DEPTH > dt * 0.015) {
      const p = bottlePowder(t.target) ?? foilPowder(t.target)!
      const before = mass(o.spatula)
      const dose = Math.min(forward * WORLD_DEPTH * (input.support ? 0.16 : 0.65), SCOOP_SIZE - before)
      move(s, t.target, 'spatula', p, dose)
      if (mass(o.spatula) > before + EPS) {
        s.toolHygiene.state = 'dirty'
        if (!s.toolHygiene.residue.includes(p)) s.toolHygiene.residue.push(p)
        s.message = `${LABELS[bottles[p]]} を ${mass(o.spatula).toFixed(3)} g すくった。`
      }
    }
    return
  }
  if (t.op === 'transfer') {
    const before = mass(o.mortar)
    transfer(s, input, t.source!, t.target, dt)
    if (t.target === 'mortar' && mass(o.mortar) > before + EPS) resetMix(s)
    s.progress = Math.min(1, mass(o[t.target]) / Math.max(EPS, mass(o[t.target]) + mass(o[t.source!])))
    return
  }
  if (t.op === 'mix') {
    const dx = (s.hand.x - o.mortar.x) * WORLD_WIDTH, dz = (s.hand.y - o.mortar.y) * WORLD_DEPTH
    if (input.action && Math.hypot(dx, dz) >= 0.15 && travel > dt * 0.015) {
      const sector = clamp(Math.floor((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI) * 8), 0, 7)
      s.mixCoverage[sector] = Math.min(1, s.mixCoverage[sector] + Math.min(travel, dt * 3) / 0.45)
      s.mixed = s.mixCoverage.reduce((a, b) => a + b, 0) / 8 * 100
      if (s.mixed > 100 - EPS) s.mixed = 100
      if (s.mixed === 100) markCompleted(s, MIX)
      s.message = s.mixed === 100 ? '乳鉢全体を混ぜ終えた。回収しよう。' : 'まだ混ざっていない区画へ乳棒を動かそう。'
    } else if (input.action && Math.hypot(dx, dz) < 0.15) s.message = '中心だけでは全体が混ざらない。乳鉢の内側を一周しよう。'
    s.progress = s.mixed / 100
    return
  }
  if (t.op === 'fold') { fold(s, o[t.target], input.action); return }
  if (!input.action || s.releaseOperation || (t.op === 'unfold' && s.releaseCrease)) return
  const duration = t.op === 'wipe' ? 1.25 : t.op === 'unfold' ? 0.45 : 0.60
  if (t.op === 'wipe' && !s.operationProgress) s.toolHygiene.wipesUsed++
  s.operationProgress = Math.min(1, (s.operationProgress ?? 0) + dt / duration)
  s.progress = s.operationProgress
  if (t.op === 'wipe') s.toolHygiene.wipeProgress = s.progress
  if (s.progress < 1 - EPS) return
  s.releaseOperation = true
  s.operationProgress = 0
  if (t.op === 'unfold') {
    o[t.target].unfolded = true
    const p = foilPowder(t.target)
    markCompleted(s, p ? powders.indexOf(p) * STEPS_PER_MATERIAL : MIX + 1)
    s.message = 'ホイルを開いた。折り筋が粉を支える受け皿になる。'
  } else if (t.op === 'open') {
    o[t.target].open = !o[t.target].open
    const p = bottlePowder(t.target)
    if (p && o[t.target].open) markCompleted(s, powders.indexOf(p) * STEPS_PER_MATERIAL + 3)
    s.message = `${LABELS[t.target]} を${o[t.target].open ? '開けた' : '閉じた'}。`
  } else if (t.op === 'tare') {
    s.taredSheets ??= new Set()
    s.taredSheets.add(t.source!)
    const first = powders.indexOf(foilPowder(t.source!)!) * STEPS_PER_MATERIAL
    markCompleted(s, first + 1); markCompleted(s, first + 2)
    s.tared = true
    s.message = '風袋引き完了。NET 0.000 g。'
  } else if (t.op === 'read') {
    const id = t.source!, p = foilPowder(id)!
    s.recordedSheets ??= new Set()
    if (!s.recordedSheets.has(id)) s.readings[p] += o[id][p]
    s.recordedSheets.add(id)
    markCompleted(s, powders.indexOf(p) * STEPS_PER_MATERIAL + 4)
    markCompleted(s, powders.indexOf(p) * STEPS_PER_MATERIAL + 5)
    s.message = `${LABELS[bottles[p]]} ${o[id][p].toFixed(3)} g を記録した。`
  } else if (t.op === 'wipe') {
    discard(s, 'spatula', mass(o.spatula))
    s.toolHygiene.residue = []
    s.toolHygiene.state = 'wet'
    s.toolHygiene.wipeProgress = 1
    s.toolHygiene.dryRemaining = DRY_SECONDS
    s.message = '新しいワイプで清拭した。乾燥するまで次の原料に触れないで待とう。'
    s.professorFeedback = '原料を変える前に清拭と乾燥。よく確認できているね。'
  } else if (t.op === 'seal') {
    Object.assign(o.cap, { x: o.vial.x, y: o.vial.y, tilt: 0 })
    s.hand.held = null
    o.vial.open = false
    s.status = 'won'
    s.completed = new Set(STAGES.map((_, index) => index))
    s.stats.completedSteps = s.stageCount
    s.target = null
    s.message = '密栓確認。LGPS 用の混合原料を回収した！'
    s.hint = '秤量・清拭・混合・回収まで完了。'
    s.professorFeedback = s.spilled < 0.01 ? '丁寧にできたね。清拭も含めて実験完了だ。' : '途中の失敗を立て直せたね。次は注ぎ口をもう少し意識しよう。'
  }
}

function tick(s: EngineState, table: TablePhysics, input: GameInput, dt: number, grip: boolean, door: boolean) {
  const h = s.hand
  const aimX = Number.isFinite(input.targetX) ? clamp(input.targetX, 0, 1) : h.x
  const aimY = Number.isFinite(input.targetY) ? clamp(input.targetY, 0, 1) : h.y
  const old = { x: h.x, y: h.y }
  const drag = Math.exp(-dt * 10.5)
  const gain = input.support ? 48 : 77
  h.vx = (h.vx + (aimX - h.x) * gain * dt) * drag
  h.vy = (h.vy + (aimY - h.y) * gain * dt) * drag
  h.x = clamp(h.x + h.vx * dt, 0, 1)
  h.y = clamp(h.y + h.vy * dt, 0, 1)
  s.elapsed += dt
  if (s.mode === 'standard') s.remaining = Math.max(0, s.remaining - dt)
  s.stageTimes[s.stage] = (s.stageTimes[s.stage] ?? 0) + dt
  s.spillFeedbackCooldown = Math.max(0, (s.spillFeedbackCooldown ?? 0) - dt)
  if (s.toolHygiene.state === 'wet') {
    s.toolHygiene.dryRemaining = Math.max(0, s.toolHygiene.dryRemaining - dt)
    if (s.toolHygiene.dryRemaining <= EPS) {
      s.toolHygiene.state = 'clean'
      s.toolHygiene.dryRemaining = 0
      s.toolHygiene.wipeProgress = 0
      s.message = 'スパチュラが乾いた。別の原料に使える。'
    }
  }
  if (door) {
    if (sceneDistance(h, HOME.scale) <= 1.15) {
      s.objects.scale.open = !s.objects.scale.open
      s.message = s.objects.scale.open ? '風防を開けた。皿に手が届く。' : '風防を閉めた。表示を確認しよう。'
    } else s.message = '左奥の天秤に手を近づけて R。'
  }
  if (h.toolPickup) {
    h.toolPickup.progress = Math.min(1, h.toolPickup.progress + dt / 0.20)
    if (h.toolPickup.progress === 1) h.toolPickup = undefined
  }
  if (grip) pickup(s, table)
  const tilt = Number.isFinite(input.tilt) ? clamp(input.tilt, -1, 1) : 0
  h.tilt += ((h.held ? tilt * 1.15 : tilt * 0.45) - h.tilt) * (1 - Math.exp(-dt * 8))
  if (h.held) Object.assign(s.objects[h.held], { x: h.x, y: h.y, tilt: h.tilt })
  s.supportTarget = input.support
    ? VESSELS.filter(id => id !== h.held && sceneDistance(h, s.objects[id]) < 1.15)
      .sort((a, b) => sceneDistance(h, s.objects[a]) - sceneDistance(h, s.objects[b]))[0] ?? null
    : null
  const speed = Math.hypot(h.vx, h.vy)
  applyImpacts(s, table.step(s, { x: aimX, y: aimY }, dt))
  leakingVessels(s, dt)
  jostle(s, input, speed, dt)
  const stableSheet = panSheet(s)
  const panMass = stableSheet ? foilWeight + mass(s.objects[stableSheet]) : 0
  const movingAtScale = sceneDistance(h, HOME.scale) < 0.9 && Math.hypot(h.vx * WORLD_WIDTH, h.vy * WORLD_DEPTH) > 0.15
  if (s.objects.scale.open || Math.abs(panMass - (s.previousPanMass ?? 0)) > EPS || movingAtScale)
    s.scaleSettling = 0.4
  else s.scaleSettling = Math.max(0, (s.scaleSettling ?? 0.4) - dt)
  s.previousPanMass = panMass
  s.scaleStable = !!stableSheet && !s.objects.scale.open && !movingAtScale && (s.scaleSettling ?? 0.4) <= EPS
  if (s.mode === 'practice' || (s.remaining > EPS && s.anger < 100)) {
    work(s, input, dt, sceneDistance(old, h), h.y - old.y)
    if (s.status === 'playing') advanceStages(s)
  }
  const onPan = panSheet(s)
  if (onPan) s.tared = s.taredSheets?.has(onPan) ?? false
  s.scaleMass = (onPan ? foilWeight + mass(s.objects[onPan]) : 0) - (s.tared ? foilWeight : 0)
  s.vialMass = mass(s.objects.vial)
  const drawn = powders.reduce((v, p) => v + STOCK[p] - s.objects[bottles[p]][p], 0)
  s.recovery = drawn > EPS ? clamp((100 * s.vialMass) / drawn, 0, 100) : 0
  const exhausted = powders.find(p => Object.values(s.objects).reduce((total, item) => total + item[p], 0) + EPS < recipe[p] - MASS_TOLERANCE)
  if (s.status !== 'won' && (exhausted || (s.mode === 'standard' && (s.remaining <= EPS || s.anger >= 100)))) {
    s.status = 'lost'
    s.message = exhausted ? `${LABELS[bottles[exhausted]]} の残量が目標を下回った。原料が足りず、今回の仕込みは完了できない。`
      : s.anger >= 100 ? '先生の我慢が限界に達した！' : '時間切れ！ 実験時間が終わってしまった。'
    s.hint = '結果を確認し、練習モードで苦手な操作を試そう。'
    s.professorFeedback = exhausted ? '今ある原料では不足だね。次は残量と廃棄量も確認しよう。' : '進んだ工程は記録したよ。次は一番時間のかかった操作を練習しよう。'
    s.target = null
  }
  publishTransfers(s)
  if (s.status === 'playing') present(s, input)
  else { s.actionReady = false; s.actionReason = s.message }
  if (s.status === 'won') s.score = Math.round(s.recovery * 60 + Math.max(0, ROUND_SECONDS - s.elapsed) * 5 + (100 - s.anger) * 20)
  else s.score = Math.round(s.stats.completedSteps / s.stageCount * 4500 + s.mixed * 5 + s.recovery * 15)
}

/** Advance the simulation by elapsed seconds. A grip edge is consumed just once. */
export function stepGame(s: GameState, input: GameInput, dt: number): void {
  if (s.status !== 'playing' || !Number.isFinite(dt) || dt <= 0) return
  let table = tables.get(s)
  if (!table) {
    table = new TablePhysics(s)
    tables.set(s, table)
  }
  let elapsed = s.mode === 'practice' ? dt : Math.min(dt, s.remaining)
  let grip = input.gripPressed
  let door = !!input.doorPressed
  while (elapsed > EPS && s.status === 'playing') {
    const slice = Math.min(elapsed, 1 / 120)
    tick(s, table, input, slice, grip, door)
    door = false
    grip = false
    elapsed -= slice
  }
}

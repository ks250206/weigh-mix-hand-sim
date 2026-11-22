import { HOME, LABELS, MIX, STEPS_PER_MATERIAL, activePowder, bottles, foilWeight, foldingFoil, foldStroke, inWork, isTool, isWeighFoil, mass, powders, recipe, toolHandle, weighFoils, workPositions } from './contract.ts'
import type { GameInput, GameState, ObjectId, Powder, PowderTransfer, Station, TableObject } from './contract.ts'

import { TablePhysics, type Impact } from './physics.ts'
import { caughtFraction } from './powder.ts'

const ROUND_SECONDS = 360
const REACH = 0.105
const POUR_REACH = 0.12
const EPS = 1e-7

const SCOOP_SIZE = 0.4
const STOCK = { a: 5, b: 5, c: 5 }
const ALL_IDS = Object.keys(HOME) as ObjectId[]
const VESSELS: ObjectId[] = ['jarA', 'jarB', 'jarC', 'mortar', 'vial']

type EngineState = GameState & {
  spillFeedbackCooldown?: number
  creaseStart?: 0 | 1
  cornerToCorner?: boolean
  releaseCrease?: boolean
  pendingTransfers?: Map<string, { transfer: Omit<PowderTransfer, 'id'>; started: number; updated: number }>
}
const tables = new WeakMap<GameState, TablePhysics>()

const STAGES = [
  ...powders.flatMap((p) => [
    LABELS[weighFoils[p]] + ' を二度折る',
    LABELS[weighFoils[p]] + ' を天秤に載せる',
    LABELS[weighFoils[p]] + ' の風袋を引く',
    LABELS[bottles[p]] + ' を開栓',
    LABELS[bottles[p]] + ' の秤量',
    LABELS[bottles[p]] + ' の秤量値を記録',
    LABELS[bottles[p]] + ' を乳鉢へ',
  ]),
  '乳棒で混合',
  '回収ホイルを折る',
  '混合粉を回収',
  'サンプル瓶に充填',
  'サンプル瓶を密栓',
]
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const dist = (a: Station, b: Station) => Math.hypot(a.x - b.x, a.y - b.y)
function panSheet(s: GameState) {
  return Object.values(weighFoils).find(id => s.hand.held !== id && dist(s.objects[id], HOME.scale) < 0.055)
}

export function createGame(): GameState {
  const objects = {} as Record<ObjectId, TableObject>
  for (const id of ALL_IDS) {
    objects[id] = { ...HOME[id], tilt: 0, toppled: false, foldCount: 0, foldProgress: 0, folded: false, spent: false, open: id === 'vial', a: 0, b: 0, c: 0 }
  }
  objects.jarA.a = STOCK.a
  objects.jarB.b = STOCK.b
  objects.jarC.c = STOCK.c
  const s: GameState = {
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

export function startGame(): GameState {
  const s = createGame()
  s.status = 'playing'
  return s
}

function go(s: GameState, stage: number, message: string) {
  s.stage = stage
  s.stageName = STAGES[stage]
  s.progress = 0
  s.message = message
}

function bank(s: GameState, p: Powder) {
  return s.objects.mortar[p] + s.objects.foil2[p] + s.objects.vial[p]
}

function enough(amount: number, p: Powder) {
  return amount + EPS >= recipe[p] - 0.002
}
function nextMaterial(s: GameState) {
  const p = powders.find((p) => !enough(bank(s, p), p))
  if (!p) return false
  const first = powders.indexOf(p) * STEPS_PER_MATERIAL
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
  }
  const dest = to ? s.objects[to] : src
  const key = from + ':' + to + ':' + p
  s.pendingTransfers ??= new Map()
  const previous = s.pendingTransfers.get(key)
  if (previous) {
    previous.transfer.grams += amount
    previous.updated = s.remaining
  } else {
    s.pendingTransfers.set(key, {
      started: s.remaining, updated: s.remaining,
      transfer: { from, to, kind: p, grams: amount, x: src.x, y: src.y, targetX: dest.x, targetY: dest.y },
    })
  }
}

// A stream fills a short batch, including its final few milligrams when the user releases the control.
function publishTransfers(s: EngineState) {
  if (!s.pendingTransfers) return
  for (const [key, { transfer, started, updated }] of s.pendingTransfers) {
    if (s.status === 'playing' && updated === s.remaining && started - s.remaining < 0.045 &&
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

function pickup(s: GameState, table: TablePhysics) {
  const held = s.hand.held
  if (held) {
    const o = s.objects[held]
    if (isWeighFoil(held) && o.spent) {
      Object.assign(o, HOME[held], { foldCount: 0, foldProgress: 0, folded: false, spent: false, tilt: 0, yaw: 0 })
      table.release(held, o, { x: 0, y: 0 }, false)
      s.hand.held = null
      s.hand.tilt = 0
      s.message = '使用済みホイルを廃棄。予備の新しい正方形は左の棚にある。'
      return
    }
    const onPan = isWeighFoil(held) && dist(s.hand, HOME.scale) < 0.095
    if (onPan) {
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
    if (candidate === 'scale' || candidate === 'work') continue
    const item = s.objects[candidate]
    let reach = dist(s.hand, item)
    if (isTool(candidate)) reach = Math.min(reach, dist(s.hand, toolHandle(candidate, item)))
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

function applyImpacts(s: GameState, impacts: Impact[]) {
  for (const { id, direction } of impacts) {
    const o = s.objects[id]
    if (!VESSELS.includes(id) || o.toppled) continue
    o.toppled = true
    o.tilt = direction * 0.98
    s.anger = Math.min(100, s.anger + 6)
    if (o.open || id === 'mortar') pour(s, id, null, Math.min(0.26, mass(o) * 0.22))
    s.message = `${LABELS[id]}が倒れた！ 近づいて「つかむ」で起こそう。`
  }
}

function jostle(s: EngineState, speed: number, dt: number) {
  const { held, tilt } = s.hand
  if (speed < 1.15 || Math.abs(tilt) < 0.72 || !held) return
  if (held !== 'spatula' && !isWeighFoil(held) && held !== 'foil2' && held !== 'mortar') return
  if (mass(s.objects[held]) <= EPS) return
  const p = activePowder(s.stage) ?? 'a'
  const receiver = held === 'spatula' ? weighFoils[p] : held === 'foil2' ? 'vial' : held === 'mortar' ? 'foil2' : 'mortar'
  if (dist(s.hand, s.objects[receiver]) <= POUR_REACH) return
  pour(s, held, null, (speed - 1) * Math.abs(tilt) * dt * 0.32)
  if ((s.spillFeedbackCooldown ?? 0) <= 0) {
    s.message = '傾けたまま急に運ぶと粉が飛ぶ！ 移動中は Q/E を離そう。'
    s.spillFeedbackCooldown = 0.8
  }
}

function transfer(s: EngineState, input: GameInput, from: ObjectId, to: ObjectId, dt: number) {
  if (s.hand.held !== from || !input.action || Math.abs(s.hand.tilt) < 0.28) return
  const source = s.objects[from]
  const dest = s.objects[to]
  const rate = Math.abs(s.hand.tilt) * dt
  if (dist(source, dest) <= POUR_REACH && !dest.toppled) {
    const dx = (source.x - dest.x) * 12, dz = (source.y - dest.y) * 6.5
    const distance = Math.hypot(dx, dz)
    const aimFactor = distance > 0.18 ? 1 - 0.18 / distance : 0
    const receiverRadius = to === 'mortar' ? 0.61 : to === 'vial' ? 0.31 : 0.52
    const caught = caughtFraction(dx * aimFactor, dz * aimFactor,
      s.hand.vx * 12 * 0.2, s.hand.vy * 6.5 * 0.2, receiverRadius, 0.36)
    const dose = Math.min(mass(source), rate * 1.35)
    pour(s, from, to, dose * caught)
    pour(s, from, null, dose * (1 - caught))
    if (dose > EPS && caught < 1 && (s.spillFeedbackCooldown ?? 0) <= 0) {
      s.message = LABELS[to] + ' の縁から粉が落ちている。中央に合わせよう。'
      s.spillFeedbackCooldown = 0.8
    }
  } else if (from !== 'spatula' || dist(source, s.objects[bottles[activePowder(s.stage) ?? 'a']]) > POUR_REACH) {
    const before = mass(source)
    pour(s, from, null, rate * 0.4)
    if (before > EPS && (s.spillFeedbackCooldown ?? 0) <= 0) {
      s.message = `粉がこぼれている！ ${LABELS[to]}の真上で傾けよう。`
      s.spillFeedbackCooldown = 0.8
    }
  }
}

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
interface Task {
  op: Operation
  target: ObjectId
  hint: string
  source?: ObjectId
}
const task = (target: ObjectId, hint: string, op: Operation = 'aim', source?: ObjectId): Task => ({
  target,
  hint,
  op,
  source,
})

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
      task(foldId, o[foldId].foldCount === 0
        ? 'Space を押し、正方形の左奥と右手前を結ぶ対角線をなぞって三角に折る。'
        : 'Space を一度離し、押し直して三角の左手前の角と長辺の中央を結ぶ線をなぞる。', 'fold')
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
      if (!o.scale.open) return door(true)
      if (held !== 'spatula') return take('spatula')
      const remaining = Math.max(0, recipe[p] - bank(s, p) - o[foil][p])
      const current = o.spatula[p]
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
          go(s, s.stage + 1, '二度折って四枚重ねの三角形ができた。')
          return
        }
        s.message = '一度目の折り目が付いた。Space を離して次の線をなぞろう。'
      }
    }
  }
  s.progress = (sheet.foldCount + sheet.foldProgress) / 2
}

function work(s: EngineState, input: GameInput, dt: number, travel: number, forward: number) {
  const t = plan(s),
    p = activePowder(s.stage) ?? 'a',
    foil = weighFoils[p],
    bottle = bottles[p],
    o = s.objects
  if (t.op !== 'fold') {
    s.creaseStart = undefined
    if (!input.action) s.releaseCrease = false
    const foldId = foldingFoil(s.stage)
    if (foldId) {
      o[foldId].foldProgress = 0
      s.progress = o[foldId].foldCount / 2
    }
  }
  const at = dist(s.hand, o[t.target]) <= REACH && !o[t.target].toppled
  const weighing =
    s.stage < MIX && s.stage % STEPS_PER_MATERIAL === 4
  const dip =
    weighing &&
    s.hand.held === 'spatula' &&
    o[bottle].open &&
    !o[bottle].toppled &&
    inWork(o[bottle]) &&
    dist(s.hand, o[bottle]) < 0.08 &&
    input.action
  s.scoopDepth += ((dip ? 1 : 0) - s.scoopDepth) * (1 - Math.exp(-dt * 12))
  if (t.op === 'place') {
    go(s, s.stage + 1, '秤量ホイルを載せた。表示はホイル込み。')
    return
  }
  if (t.op === 'scoop' && dip && s.scoopDepth > 0.45 && forward > dt * 0.012) {
    const need = recipe[p] - bank(s, p) - o[foil][p] - o.spatula[p]
    const before = o.spatula[p]
    move(s, bottle, 'spatula', p, Math.min(forward * 8, SCOOP_SIZE - mass(o.spatula), need))
    if (Math.floor(o.spatula[p] * 100) > Math.floor(before * 100))
      s.message = LABELS[bottle] + ' をすくった。手を水平にして天秤へ。'
  }
  if (t.op === 'dispense') {
    const before = o[foil][p]
    transfer(s, input, 'spatula', foil, dt)
    if (Math.floor(o[foil][p] * 100) > Math.floor(before * 100))
      s.message = '秤量ホイルに ' + LABELS[bottle] + ' を移した。'
  }
  if (weighing) {
    s.progress = clamp(o[foil][p] / Math.max(EPS, recipe[p] - bank(s, p)), 0, 1)
    if (panSheet(s) === foil && s.tared && enough(bank(s, p) + o[foil][p], p) && mass(o.spatula) < EPS) {
      go(s, s.stage + 1, '目標量に達した。風防を閉じて表示を確認しよう。')
    }
    return
  }
  if (t.op === 'transfer') {
    const source = t.source!
    transfer(s, input, source, t.target, dt)
    s.progress = clamp(mass(o[t.target]) / Math.max(EPS, mass(o[source]) + mass(o[t.target])), 0, 1)
  }
  if (
    s.stage < MIX &&
    s.stage % STEPS_PER_MATERIAL === 6 &&
    mass(o[foil]) < EPS
  ) {
    o[foil].spent = true
    s.mixed = 0
    if (!nextMaterial(s)) go(s, MIX, '3原料がそろった。手前の乳鉢で混合しよう。')
    return
  }
  if (t.op === 'mix') {
    if (at && input.action && travel > dt * 0.012) s.mixed = Math.min(100, s.mixed + travel * 100)
    s.progress = s.mixed / 100
    if (s.mixed === 100 && !nextMaterial(s))
      go(s, o.foil2.folded ? MIX + 2 : MIX + 1, '混合完了。新しい回収ホイルを用意しよう。')
    return
  }
  if ((s.stage === MIX + 2 || s.stage === MIX + 3) && mass(o[s.stage === MIX + 2 ? 'mortar' : 'foil2']) < EPS) {
    if (!nextMaterial(s)) go(s, s.stage + 1, '移し替え完了。')
    return
  }
  if (s.stage === MIX + 4 && nextMaterial(s)) return
  if (t.op === 'fold') {
    fold(s, o[t.target], input.action)
    return
  }
  if (!['tare', 'open', 'read', 'seal'].includes(t.op)) return
  if (!at || !input.action) {
    s.progress = 0
    return
  }
  s.progress = Math.min(1, s.progress + dt / 0.72)
  if (s.progress < 1 - EPS) return
  switch (t.op) {
    case 'tare':
      s.tared = true
      go(s, s.stage + (o[bottle].open ? 2 : 1), 'NET 0.000 g。専用ホイルの風袋を引いた。')
      break
    case 'open':
      o[bottle].open = true
      go(s, s.stage + 1, LABELS[bottle] + ' を開けた。')
      break
    case 'read':
      if (!enough(bank(s, p) + o[foil][p], p)) {
        go(s, s.stage - 1, '不足分をすくい足そう。')
        break
      }
      s.readings[p] += o[foil][p]
      go(s, s.stage + 1, LABELS[bottle] + ' の正味質量 ' + o[foil][p].toFixed(3) + ' g を記録。')
      break
    case 'seal':
      if (s.mixed < 100 || !powders.every((k) => enough(o.vial[k], k))) return
      Object.assign(o.cap, { x: o.vial.x, y: o.vial.y, tilt: 0 })
      s.hand.held = null
      o.vial.open = false
      s.status = 'won'
      s.target = null
      s.message = '密栓確認。LGPS 用の混合原料を回収した！'
      s.hint = 'Li₁₀GeP₂S₁₂ 用原料の秤量・混合完了。'
  }
}

function tick(s: EngineState, table: TablePhysics, input: GameInput, dt: number, grip: boolean, door: boolean) {
  const h = s.hand
  const aimX = Number.isFinite(input.targetX) ? clamp(input.targetX, 0, 1) : h.x
  const aimY = Number.isFinite(input.targetY) ? clamp(input.targetY, 0, 1) : h.y
  const old = { x: h.x, y: h.y }
  const drag = Math.exp(-dt * 10.5)
  h.vx = (h.vx + (aimX - h.x) * 77 * dt) * drag
  h.vy = (h.vy + (aimY - h.y) * 77 * dt) * drag
  h.x = clamp(h.x + h.vx * dt, 0, 1)
  h.y = clamp(h.y + h.vy * dt, 0, 1)
  s.spillFeedbackCooldown = Math.max(0, (s.spillFeedbackCooldown ?? 0) - dt)
  if (door) {
    if (dist(h, HOME.scale) <= 0.16) {
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
  const speed = Math.hypot(h.vx, h.vy)
  s.remaining = Math.max(0, s.remaining - dt)
  applyImpacts(s, table.step(s, { x: aimX, y: aimY }, dt))
  jostle(s, speed, dt)
  if (s.remaining > EPS && s.anger < 100) work(s, input, dt, dist(old, h), h.y - old.y)
  const onPan = panSheet(s)
  s.scaleMass = (onPan ? foilWeight + mass(s.objects[onPan]) : 0) - (s.tared ? foilWeight : 0)
  s.vialMass = mass(s.objects.vial)
  const drawn = powders.reduce((v, p) => v + STOCK[p] - s.objects[bottles[p]][p], 0)
  s.recovery = drawn > EPS ? clamp((100 * s.vialMass) / drawn, 0, 100) : 0
  if (s.remaining <= EPS || s.anger >= 100) {
    if (s.remaining <= EPS) s.remaining = 0
    s.status = 'lost'
    s.message = s.anger >= 100 ? '先生の我慢が限界に達した！' : '時間切れ！ 実験時間が終わってしまった。'
    s.hint = 'リスタートで新しい実験を始めよう。'
    s.target = null
  }
  publishTransfers(s)
  if (s.status === 'playing') describe(s, plan(s))
  else if (s.status === 'won') s.score = Math.round(s.recovery * 60 + s.remaining * 5 + (100 - s.anger) * 20)
}

/** Advance the simulation by elapsed seconds. A grip edge is consumed just once. */
export function stepGame(s: GameState, input: GameInput, dt: number): void {
  if (s.status !== 'playing' || !Number.isFinite(dt) || dt <= 0) return
  let table = tables.get(s)
  if (!table) {
    table = new TablePhysics(s)
    tables.set(s, table)
  }
  let elapsed = Math.min(dt, s.remaining)
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

import { HOME, LABELS, bottles, foilWeight, inWork, mass, powders, recipe, workPositions } from './contract.ts'
import type { GameInput, GameState, ObjectId, Powder, Station, TableObject } from './contract.ts'

import { TablePhysics, type Impact } from './physics.ts'

const ROUND_SECONDS = 360
const REACH = 0.105
const POUR_REACH = 0.12
const EPS = 1e-7

const SCOOP_SIZE = 0.4
const STOCK = { a: 5, b: 5, c: 5 }
const ALL_IDS = Object.keys(HOME) as ObjectId[]
const VESSELS: ObjectId[] = ['jarA', 'jarB', 'jarC', 'mortar', 'vial']

type EngineState = GameState & { spillFeedbackCooldown?: number }
const tables = new WeakMap<GameState, TablePhysics>()

const STAGES = [
  '秤量ホイルを折る',
  '天秤にホイルを入れる',
  '風袋を引く',
  ...powders.flatMap((p) => [
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
const FIRST_MATERIAL = 3
const STEPS_PER_MATERIAL = 4
const MIX = FIRST_MATERIAL + powders.length * STEPS_PER_MATERIAL
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const dist = (a: Station, b: Station) => Math.hypot(a.x - b.x, a.y - b.y)
const powderFor = (stage: number): Powder =>
  powders[clamp(Math.floor((stage - FIRST_MATERIAL) / STEPS_PER_MATERIAL), 0, 2)]
const onScale = (s: GameState) => s.hand.held !== 'foil' && dist(s.objects.foil, HOME.scale) < 0.055

export function createGame(): GameState {
  const objects = {} as Record<ObjectId, TableObject>
  for (const id of ALL_IDS) {
    objects[id] = { ...HOME[id], tilt: 0, toppled: false, folded: false, open: id === 'vial', a: 0, b: 0, c: 0 }
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
    particles: [],
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
  const first = FIRST_MATERIAL + powders.indexOf(p) * STEPS_PER_MATERIAL
  go(
    s,
    first + Number(s.objects[bottles[p]].open),
    LABELS[bottles[p]] + ' を準備。あと ' + (recipe[p] - bank(s, p)).toFixed(3) + ' g。',
  )
  return true
}
function grains(s: GameState, at: Station, p: Powder, count: number) {
  for (let i = 0; i < count; i++) {
    const t = s.remaining * 7.1 + (s.particles.length + 1) * 2.4
    s.particles.push({
      x: at.x,
      y: at.y,
      vx: Math.cos(t) * 0.045,
      vy: -0.055 + Math.sin(t) * 0.035,
      life: 0.6,
      kind: p,
    })
  }
}

// All powder moves between inventories or into the cumulative spill ledger.
function move(s: GameState, from: ObjectId, to: ObjectId | null, p: Powder, max: number) {
  const src = s.objects[from]
  const amount = Math.min(src[p], Math.max(0, max))
  if (amount <= 0) return
  const before = src[p]
  src[p] -= amount
  if (to) s.objects[to][p] += amount
  else {
    s.spilled += amount
    s.spilledMass[p] += amount
    s.anger = Math.min(100, s.anger + amount * 20)
  }
  if (Math.floor(before * 24) !== Math.floor(src[p] * 24) || src[p] === 0) {
    grains(s, to ? s.objects[to] : src, p, to ? 2 : 4)
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
    const onPan = held === 'foil' && dist(s.hand, HOME.scale) < 0.095
    if (onPan) {
      if (!s.objects.scale.open) {
        s.message = '風防が閉じている。天秤の前で R を押して開けよう。'
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
    table.release(held, o, { x: s.hand.vx, y: s.hand.vy }, onPan)
    o.tilt = 0
    o.yaw = 0
    s.hand.held = null
    s.hand.tilt = 0
    return
  }
  const ids = ALL_IDS.filter((id) => id !== 'scale' && id !== 'work' && dist(s.hand, s.objects[id]) <= REACH)
  ids.sort((a, b) => dist(s.hand, s.objects[a]) - dist(s.hand, s.objects[b]))
  const id = ids[0]
  if (id === 'foil' && onScale(s) && !s.objects.scale.open) {
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
  if (held !== 'spatula' && held !== 'foil' && held !== 'foil2' && held !== 'mortar') return
  if (mass(s.objects[held]) <= EPS) return
  const receiver = { spatula: 'foil', foil: 'mortar', foil2: 'vial', mortar: 'foil2' } as const
  if (dist(s.hand, s.objects[receiver[held]]) <= POUR_REACH) return
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
    pour(s, from, to, rate * 1.35)
  } else if (from !== 'spatula' || dist(source, s.objects[bottles[powderFor(s.stage)]]) > POUR_REACH) {
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
    p = powderFor(s.stage),
    bottle = bottles[p]
  const release = () => task(held!, LABELS[held!] + ' を空いている場所で F で置く。器具は置いた位置に残る。')
  const door = (open: boolean) =>
    task('scale', '左奥の天秤に手を合わせ、R で風防を' + (open ? '開ける。' : '閉める。'))
  function take(id: ObjectId): Task {
    if (held) return release()
    if (id === 'foil' && onScale(s) && !o.scale.open) return door(true)
    return task(id, LABELS[id] + ' に手を合わせて F でつかむ。')
  }
  function prepare(id: keyof typeof workPositions): Task | null {
    if (inWork(o[id]) && held !== id) return null
    if (held !== id) return take(id)
    Object.assign(o.work, workPositions[id])
    return task('work', LABELS[id] + ' を両腕の間に運ぶ。枠内の空いた場所で F を押して置く。')
  }
  function placeFoil(): Task | null {
    if (onScale(s)) return null
    if (held !== 'foil') return take('foil')
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

  if (s.stage === 0 || s.stage === MIX + 1) {
    const id = s.stage === 0 ? 'foil' : 'foil2'
    return (
      prepare(id) ??
      emptyHands() ??
      task(id, '手前に置いた' + LABELS[id] + ' に手を合わせ、Space 長押しで縁を折る。', 'fold')
    )
  }
  if (s.stage === 1) return placeFoil() ?? task('scale', '秤量皿のホイルを確認。', 'place')
  if (s.stage === 2)
    return (
      placeFoil() ??
      (o.scale.open
        ? door(false)
        : task('scale', '風防を閉めた天秤の前で Space 長押し。空ホイルの質量を風袋引きする。', 'tare'))
    )

  if (s.stage < MIX) {
    const phase = (s.stage - FIRST_MATERIAL) % STEPS_PER_MATERIAL
    if (phase === 0)
      return (
        prepare(bottle) ??
        emptyHands() ??
        task(bottle, LABELS[bottle] + ' の蓋を Space 長押しで開ける。', 'open')
      )
    if (phase === 1) {
      const ready = placeFoil() ?? prepare(bottle)
      if (ready) return ready
      if (!o.scale.open) return door(true)
      if (held !== 'spatula') return take('spatula')
      const remaining = Math.max(0, recipe[p] - bank(s, p) - o.foil[p])
      const current = o.spatula[p]
      if (
        current <= EPS ||
        (dist(s.hand, o[bottle]) < 0.077 && current + EPS < Math.min(SCOOP_SIZE, remaining))
      ) {
        return task(bottle, '瓶口で Space を押し、先端を粉に入れて手前へ短く引く。離すと持ち上がる。', 'scoop')
      }
      return task(
        'foil',
        '天秤内のホイルの上で Space ＋ Q/E で注ぐ。目標 ' + (recipe[p] - bank(s, p)).toFixed(3) + ' g。',
        'dispense',
      )
    }
    if (phase === 2)
      return (
        placeFoil() ??
        (o.scale.open
          ? door(false)
          : task('scale', '天秤の前で Space 長押し。閉じた風防の中で粉の正味質量を読み取る。', 'read'))
      )
    return prepare('mortar') ?? pourTask('foil', 'mortar')
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

function work(s: EngineState, input: GameInput, dt: number, travel: number, forward: number) {
  const t = plan(s),
    p = powderFor(s.stage),
    bottle = bottles[p],
    o = s.objects
  const at = dist(s.hand, o[t.target]) <= REACH && !o[t.target].toppled
  const weighing =
    s.stage >= FIRST_MATERIAL && s.stage < MIX && (s.stage - FIRST_MATERIAL) % STEPS_PER_MATERIAL === 1
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
    go(s, 2, '秤量ホイルを載せた。表示はホイル込み。')
    return
  }
  if (t.op === 'scoop' && dip && s.scoopDepth > 0.45 && forward > dt * 0.012) {
    const need = recipe[p] - bank(s, p) - o.foil[p] - o.spatula[p]
    const before = o.spatula[p]
    move(s, bottle, 'spatula', p, Math.min(forward * 8, SCOOP_SIZE - mass(o.spatula), need))
    if (Math.floor(o.spatula[p] * 100) > Math.floor(before * 100))
      s.message = LABELS[bottle] + ' をすくった。手を水平にして天秤へ。'
  }
  if (t.op === 'dispense') {
    const before = o.foil[p]
    transfer(s, input, 'spatula', 'foil', dt)
    if (Math.floor(o.foil[p] * 100) > Math.floor(before * 100))
      s.message = '秤量ホイルに ' + LABELS[bottle] + ' を移した。'
  }
  if (weighing) {
    s.progress = clamp(o.foil[p] / Math.max(EPS, recipe[p] - bank(s, p)), 0, 1)
    if (onScale(s) && enough(bank(s, p) + o.foil[p], p) && mass(o.spatula) < EPS) {
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
    s.stage >= FIRST_MATERIAL &&
    s.stage < MIX &&
    (s.stage - FIRST_MATERIAL) % STEPS_PER_MATERIAL === 3 &&
    mass(o.foil) < EPS
  ) {
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
  if (!['fold', 'tare', 'open', 'read', 'seal'].includes(t.op)) return
  if (!at || !input.action) {
    s.progress = 0
    return
  }
  s.progress = Math.min(1, s.progress + dt / 0.72)
  if (s.progress < 1 - EPS) return
  switch (t.op) {
    case 'fold':
      o[t.target].folded = true
      go(s, s.stage + 1, 'ホイルの縁を折った。')
      break
    case 'tare':
      s.tared = true
      go(s, 3, 'NET 0.000 g。これからは粉の質量を表示する。')
      break
    case 'open':
      o[bottle].open = true
      go(s, s.stage + 1, LABELS[bottle] + ' を開けた。')
      break
    case 'read':
      if (!enough(bank(s, p) + o.foil[p], p)) {
        go(s, s.stage - 1, '不足分をすくい足そう。')
        break
      }
      s.readings[p] += o.foil[p]
      go(s, s.stage + 1, LABELS[bottle] + ' の正味質量 ' + o.foil[p].toFixed(3) + ' g を記録。')
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
  if (grip) pickup(s, table)
  const tilt = Number.isFinite(input.tilt) ? clamp(input.tilt, -1, 1) : 0
  h.tilt += ((h.held ? tilt * 1.15 : tilt * 0.45) - h.tilt) * (1 - Math.exp(-dt * 8))
  if (h.held) Object.assign(s.objects[h.held], { x: h.x, y: h.y, tilt: h.tilt })
  const speed = Math.hypot(h.vx, h.vy)
  applyImpacts(s, table.step(s, { x: aimX, y: aimY }, dt))
  jostle(s, speed, dt)
  for (const grain of s.particles) {
    grain.life -= dt
    grain.x += grain.vx * dt
    grain.y += grain.vy * dt
    grain.vy += 0.18 * dt
  }
  while (s.particles.length && s.particles[0].life <= 0) s.particles.shift()
  s.remaining = Math.max(0, s.remaining - dt)
  if (s.remaining > EPS && s.anger < 100) work(s, input, dt, dist(old, h), h.y - old.y)
  s.scaleMass = (onScale(s) ? foilWeight + mass(s.objects.foil) : 0) - (s.tared ? foilWeight : 0)
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

import { HOME, LABELS } from './contract.ts'
import type { GameInput, GameState, ObjectId, Station, TableObject } from './contract.ts'

const ROUND_SECONDS = 360
const REACH = 0.105
const POUR_REACH = 0.12
const EPS = 1e-7
const RECIPE = { a: 1.2, b: 0.8 }
const SCOOP_SIZE = 0.4
const STOCK = { a: 12, b: 8 }
const ALL_IDS = Object.keys(HOME) as ObjectId[]
const VESSELS: ObjectId[] = ['jarA', 'jarB', 'mortar', 'vial']
type Powder = keyof typeof RECIPE
type EngineState = GameState & { impactCooldown?: number; spillFeedbackCooldown?: number }

const STAGES = [
  '秤量ホイルを折る', '電子天秤に載せる', '試薬 A を開栓', '試薬 A を秤量', '試薬 A を乳鉢へ',
  '試薬 B を開栓', '試薬 B を秤量', '試薬 B を乳鉢へ', '乳棒で混合', '回収ホイルを折る',
  '混合粉を回収', 'サンプル瓶に充填', 'サンプル瓶を密栓',
]
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const dist = (a: Station, b: Station) => Math.hypot(a.x - b.x, a.y - b.y)
const mass = (o: TableObject) => o.a + o.b
const jar = (p: Powder): ObjectId => p === 'a' ? 'jarA' : 'jarB'
const powderFor = (stage: number): Powder => stage < 5 ? 'a' : 'b'
const onScale = (s: GameState) => s.hand.held !== 'foil' && dist(s.objects.foil, HOME.scale) < 0.055

export function createGame(): GameState {
  const objects = {} as Record<ObjectId, TableObject>
  for (const id of ALL_IDS) {
    objects[id] = { ...HOME[id], tilt: 0, toppled: false, folded: false, open: id === 'vial', a: 0, b: 0 }
  }
  objects.jarA.a = STOCK.a
  objects.jarB.b = STOCK.b
  const s: GameState = {
    status: 'title', stage: 0, stageCount: STAGES.length, stageName: STAGES[0], hint: '', target: 'foil',
    remaining: ROUND_SECONDS, anger: 0, mixed: 0, scaleMass: 0, vialMass: 0, spilled: 0, recovery: 0,
    score: 0, message: '落ち着いて、まずはホイルから。', progress: 0,
    hand: { x: 0.48, y: 0.86, vx: 0, vy: 0, tilt: 0, held: null }, objects, particles: [],
  }
  describe(s)
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
  return amount + EPS >= RECIPE[p] * 0.9
}

function dock(s: GameState, id: ObjectId) {
  const home = id === 'foil' && s.stage >= 2 ? HOME.scale : HOME[id]
  Object.assign(s.objects[id], home, { tilt: 0 })
  if (s.hand.held === id) {
    s.hand.held = null
    s.hand.tilt = 0
  }
}

function reweigh(s: GameState): boolean {
  for (const p of ['a', 'b'] as const) {
    if (enough(bank(s, p), p)) continue
    const bottle = jar(p)
    const stage = p === 'a' ? 2 : 5
    go(s, stage + (s.objects[bottle].open ? 1 : 0), `試薬 ${p.toUpperCase()} を追加しよう。目標まであと ${(RECIPE[p] - bank(s, p)).toFixed(2)} g。`)
    return true
  }
  return false
}

function grains(s: GameState, at: Station, p: Powder, count: number) {
  for (let i = 0; i < count; i++) {
    const t = s.remaining * 7.1 + (s.particles.length + 1) * 2.4
    s.particles.push({ x: at.x, y: at.y, vx: Math.cos(t) * 0.045, vy: -0.055 + Math.sin(t) * 0.035, life: 0.6, kind: p })
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
  move(s, from, to, 'a', src.a * fraction)
  move(s, from, to, 'b', src.b * fraction)
}

function pickup(s: GameState) {
  const held = s.hand.held
  if (held) {
    if (held === 'foil' && s.stage === 1 && dist(s.hand, HOME.scale) < POUR_REACH) {
      go(s, 2, '風袋はゼロ。試薬 A を準備しよう。')
    }
    dock(s, held)
    return
  }
  // Prefer the tool for this step when two objects overlap. The balance is fixed.
  const ids = ALL_IDS.filter(id => id !== 'scale' && dist(s.hand, s.objects[id]) <= REACH)
  ids.sort((a, b) => dist(s.hand, s.objects[a]) - dist(s.hand, s.objects[b]))
  const id = ids.includes(s.target as ObjectId) ? s.target : ids[0]
  if (!id) return
  const o = s.objects[id]
  if (o.toppled) {
    o.toppled = false
    o.tilt = 0
    s.message = `${LABELS[id]}を起こした。もう一度つかめるぞ。`
    return
  }
  s.hand.held = id
  s.hand.tilt = o.tilt
}

function collide(s: EngineState, input: GameInput, speed: number) {
  if ((s.impactCooldown ?? 0) > 0 || speed < 1.55) return
  const aim = { x: input.targetX, y: input.targetY }
  for (const id of VESSELS) {
    const o = s.objects[id]
    if (s.hand.held === id || o.toppled || dist(s.hand, o) > 0.057 || dist(aim, o) < 0.17) continue
    if ((o.x - s.hand.x) * s.hand.vx + (o.y - s.hand.y) * s.hand.vy <= 0) continue
    o.toppled = true
    o.tilt = s.hand.vx >= 0 ? 0.98 : -0.98
    s.anger = Math.min(100, s.anger + 6)
    if (o.open || id === 'mortar') pour(s, id, null, Math.min(0.26, mass(o) * 0.22))
    s.message = `${LABELS[id]}が倒れた！ 近づいて「つかむ」で起こそう。`
    s.impactCooldown = 1.25
    break
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

function describe(s: GameState) {
  const held = s.hand.held
  const p = powderFor(s.stage)
  const bottle = jar(p)
  const label = LABELS[bottle]
  let target: ObjectId
  let hint: string
  switch (s.stage) {
    case 0: case 9:
      target = s.stage === 0 ? 'foil' : 'foil2'
      hint = `${LABELS[target]}に手を合わせ、Space 長押しで縁を折る。`
      break
    case 1:
      target = held === 'foil' ? 'scale' : 'foil'
      hint = held === 'foil' ? '電子天秤の中央へ運び、つかむボタンをもう一度押して置く。' : '秤量ホイルをつかみ、電子天秤へ運ぶ。'
      break
    case 2: case 5:
      target = bottle
      hint = `${label}の蓋に手を合わせ、Space 長押しで開ける。`
      break
    case 3: case 6: {
      const needed = Math.max(0, RECIPE[p] - bank(s, p))
      const load = s.objects.spatula[p]
      const filling = dist(s.hand, s.objects[bottle]) <= REACH && load + EPS < Math.min(SCOOP_SIZE, needed - s.objects.foil[p])
      target = held !== 'spatula' ? 'spatula' : load <= EPS || filling ? bottle : 'foil'
      const goal = needed.toFixed(2)
      if (target === 'spatula') hint = `スパチュラをつかむ。天秤で量る${label}は ${goal} g。`
      else if (target === 'foil') hint = `電子天秤の秤量ホイル上で Space 長押し＋Q/E どちらかで傾けて移す。目標 ${goal} g。`
      else hint = `${label}の口で Space 長押し。スパチュラに ${load.toFixed(2)} g。すくえたら電子天秤へ。`
      break
    }
    case 4: case 7:
      target = held === 'foil' ? 'mortar' : 'foil'
      hint = held === 'foil' ? '乳鉢の口で Space 長押し＋Q/E どちらかで傾け、粉を移す。' : '天秤上の秤量ホイルをつかみ、乳鉢へ運ぶ。'
      break
    case 8:
      target = held === 'pestle' ? 'mortar' : 'pestle'
      hint = held === 'pestle' ? '乳鉢の中で Space を押しながら小さく円を描くか往復する。' : '乳棒をつかみ、乳鉢の中心へ運ぶ。'
      break
    case 10: case 11: {
      const source = s.stage === 10 ? 'mortar' : 'foil2'
      const dest = s.stage === 10 ? 'foil2' : 'vial'
      target = held === source ? dest : source
      hint = held === source ? `${LABELS[dest]}の上で Space 長押し＋Q/E どちらかで傾けて注ぐ。` : `${LABELS[source]}をつかみ、${LABELS[dest]}へ運ぶ。`
      break
    }
    default:
      target = held === 'cap' ? 'vial' : 'cap'
      hint = held === 'cap' ? 'サンプル瓶の口に蓋を合わせ、Space 長押しで締める。' : '瓶の蓋をつかみ、サンプル瓶の口へ運ぶ。'
  }
  if (s.objects[target].toppled) hint = `${LABELS[target]}が倒れている。手を空け、近くで「つかむ」を押して起こす。`
  else if (held && held !== target && !workingWith(s.stage, held)) hint = `${LABELS[held]}を「つかむ」で離す。${hint}`
  s.target = target
  s.hint = hint
}

function workingWith(stage: number, held: ObjectId) {
  return held === (['foil', 'foil', 'jarA', 'spatula', 'foil', 'jarB', 'spatula', 'foil', 'pestle', 'foil2', 'mortar', 'foil2', 'cap'] as const)[stage]
}

function holdAction(s: GameState, input: GameInput, object: ObjectId, dt: number, seconds: number, tool: ObjectId | null = null) {
  const o = s.objects[object]
  const gripOK = tool ? s.hand.held === tool : !s.hand.held || s.hand.held === object
  if (!input.action || !gripOK || dist(s.hand, o) > REACH || o.toppled) {
    s.progress = 0
    return false
  }
  s.progress = Math.min(1, s.progress + dt / seconds)
  return s.progress >= 1 - EPS
}

function transfer(s: EngineState, input: GameInput, from: ObjectId, to: ObjectId, dt: number) {
  if (s.hand.held !== from || !input.action || Math.abs(s.hand.tilt) < 0.28) return
  const source = s.objects[from]
  const dest = s.objects[to]
  const rate = Math.abs(s.hand.tilt) * dt
  if (dist(source, dest) <= POUR_REACH && !dest.toppled) {
    pour(s, from, to, rate * 1.35)
  } else if (from !== 'spatula' || dist(source, s.objects[jar(powderFor(s.stage))]) > POUR_REACH) {
    const before = mass(source)
    pour(s, from, null, rate * 0.4)
    if (before > EPS && (s.spillFeedbackCooldown ?? 0) <= 0) {
      s.message = `粉がこぼれている！ ${LABELS[to]}の真上で傾けよう。`
      s.spillFeedbackCooldown = 0.8
    }
  }
}

function weigh(s: EngineState, input: GameInput, dt: number) {
  const p = powderFor(s.stage)
  const bottle = jar(p)
  const o = s.objects
  const goal = RECIPE[p] - bank(s, p)
  const needed = goal - o.foil[p] - o.spatula[p]
  if (s.hand.held === 'spatula' && input.action && !o[bottle].toppled && o[bottle].open && dist(s.hand, o[bottle]) <= REACH) {
    move(s, bottle, 'spatula', p, Math.min(dt * 0.85, SCOOP_SIZE - mass(o.spatula), needed))
  } else if (onScale(s)) {
    transfer(s, input, 'spatula', 'foil', dt)
  }
  s.progress = clamp(o.foil[p] / Math.max(EPS, goal), 0, 1)
  if (enough(bank(s, p) + o.foil[p], p) && mass(o.spatula) <= EPS) {
    dock(s, 'spatula')
    go(s, s.stage + 1, `${LABELS[bottle]}を ${o.foil[p].toFixed(2)} g 秤量した。`)
  }
}

function work(s: EngineState, input: GameInput, dt: number, travel: number) {
  const o = s.objects
  switch (s.stage) {
    case 0: case 9: {
      const id = s.stage === 0 ? 'foil' : 'foil2'
      if (holdAction(s, input, id, dt, 0.8)) {
        o[id].folded = true
        if (id === 'foil2') dock(s, id)
        go(s, s.stage + 1, '四辺が折れた。粉を受ける準備よし。')
      }
      break
    }
    case 2: case 5: {
      const id = jar(powderFor(s.stage))
      if (holdAction(s, input, id, dt, 0.85)) {
        o[id].open = true
        dock(s, id)
        go(s, s.stage + 1, `${LABELS[id]}を開けた。スパチュラの出番だ。`)
      }
      break
    }
    case 3: case 6:
      weigh(s, input, dt)
      break
    case 4: case 7:
      transfer(s, input, 'foil', 'mortar', dt)
      s.progress = clamp(1 - mass(o.foil) / RECIPE[powderFor(s.stage)], 0, 1)
      if (mass(o.foil) <= EPS) {
        dock(s, 'foil')
        s.mixed = 0
        if (!reweigh(s)) go(s, 8, '材料がそろった。乳棒でよく混ぜよう。')
      }
      break
    case 8:
      if (s.hand.held === 'pestle' && input.action && !o.mortar.toppled && dist(s.hand, o.mortar) <= POUR_REACH) {
        s.mixed = Math.min(100, s.mixed + travel * 100)
      }
      s.progress = s.mixed / 100
      if (s.mixed >= 100) {
        dock(s, 'pestle')
        if (!reweigh(s)) go(s, o.foil2.folded ? 10 : 9, '均一になった。回収ホイルを用意しよう。')
      }
      break
    case 10: case 11: {
      const collecting = s.stage === 10
      const source = collecting ? 'mortar' : 'foil2'
      const dest = collecting ? 'foil2' : 'vial'
      transfer(s, input, source, dest, dt)
      s.progress = clamp(mass(o[dest]) / Math.max(EPS, mass(o[source]) + mass(o[dest])), 0, 1)
      if (mass(o[source]) <= EPS) {
        dock(s, source)
        if (!reweigh(s)) go(s, s.stage + 1, collecting ? '混合粉を回収した。次は瓶詰めだ。' : '瓶詰め完了。最後に蓋を締めよう。')
      }
      break
    }
    case 12:
      if (reweigh(s)) return
      if (s.mixed >= 100 && enough(o.vial.a, 'a') && enough(o.vial.b, 'b') && holdAction(s, input, 'vial', dt, 0.9, 'cap')) {
        dock(s, 'cap')
        Object.assign(o.cap, { x: o.vial.x, y: o.vial.y })
        o.vial.open = false
        s.status = 'won'
        s.progress = 1
        s.message = '密栓確認。先生、できました！'
        s.target = null
        s.hint = 'サンプル瓶を密栓して全工程完了。'
      }
  }
}

function tick(s: EngineState, input: GameInput, dt: number, grip: boolean) {
  const h = s.hand
  const aimX = Number.isFinite(input.targetX) ? clamp(input.targetX, 0, 1) : h.x
  const aimY = Number.isFinite(input.targetY) ? clamp(input.targetY, 0, 1) : h.y
  const old = { x: h.x, y: h.y }
  const drag = Math.exp(-dt * 10.5)
  h.vx = (h.vx + (aimX - h.x) * 77 * dt) * drag
  h.vy = (h.vy + (aimY - h.y) * 77 * dt) * drag
  h.x = clamp(h.x + h.vx * dt, 0, 1)
  h.y = clamp(h.y + h.vy * dt, 0, 1)
  s.impactCooldown = Math.max(0, (s.impactCooldown ?? 0) - dt)
  s.spillFeedbackCooldown = Math.max(0, (s.spillFeedbackCooldown ?? 0) - dt)
  if (grip) pickup(s)
  const tilt = Number.isFinite(input.tilt) ? clamp(input.tilt, -1, 1) : 0
  h.tilt += ((h.held ? tilt * 1.15 : tilt * 0.45) - h.tilt) * (1 - Math.exp(-dt * 8))
  if (h.held) Object.assign(s.objects[h.held], { x: h.x, y: h.y, tilt: h.tilt })
  const speed = Math.hypot(h.vx, h.vy)
  collide(s, input, speed)
  jostle(s, speed, dt)
  for (const grain of s.particles) {
    grain.life -= dt
    grain.x += grain.vx * dt
    grain.y += grain.vy * dt
    grain.vy += 0.18 * dt
  }
  while (s.particles.length && s.particles[0].life <= 0) s.particles.shift()
  s.remaining = Math.max(0, s.remaining - dt)
  if (s.remaining > EPS && s.anger < 100) work(s, input, dt, dist(old, h))
  s.scaleMass = onScale(s) ? mass(s.objects.foil) : 0
  s.vialMass = mass(s.objects.vial)
  const drawn = STOCK.a + STOCK.b - mass(s.objects.jarA) - mass(s.objects.jarB)
  s.recovery = drawn > EPS ? clamp(100 * s.vialMass / drawn, 0, 100) : 0
  if (s.remaining <= EPS || s.anger >= 100) {
    if (s.remaining <= EPS) s.remaining = 0
    s.status = 'lost'
    s.message = s.anger >= 100 ? '先生の我慢が限界に達した！' : '時間切れ！ 実験時間が終わってしまった。'
    s.hint = 'リスタートで新しい実験を始めよう。'
    s.target = null
  }
  if (s.status === 'playing') describe(s)
  else if (s.status === 'won') s.score = Math.round(s.recovery * 60 + s.remaining * 5 + (100 - s.anger) * 20)
}

/** Advance the simulation by elapsed seconds. A grip edge is consumed just once. */
export function stepGame(s: GameState, input: GameInput, dt: number): void {
  if (s.status !== 'playing' || !Number.isFinite(dt) || dt <= 0) return
  let elapsed = Math.min(dt, s.remaining)
  let grip = input.gripPressed
  while (elapsed > EPS && s.status === 'playing') {
    const slice = Math.min(elapsed, 1 / 120)
    tick(s, input, slice, grip)
    grip = false
    elapsed -= slice
  }
}

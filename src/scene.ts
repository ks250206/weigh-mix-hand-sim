// Register the 3D renderer pipes before Pixi initializes the WebGL backend.
import { AmbientLight, DirectionalLight, Plane, SphereGeometry, Vector3, View3D, type Mesh3D } from '@pixi/3d'
import { Application } from 'pixi.js'
import { FxaaEffect } from '@pixi/3d/extras'
import { defaultGraphics, type GraphicsSettings } from './graphics'
import { PowderPhysics } from './powder'
import { foldingFoil, foldStroke, foilIds, foilHalfSide, HOME, inWork, isFoil, isTool, toolHandle, isWeighFoil, LABELS, weighFoils, type GameState, type ObjectId, type Station } from './contract'
import { ANCHOR_HEIGHT, chamber, TABLE_DEPTH, TABLE_WIDTH, worldX, worldZ } from './render/chamber'
import { Forms } from './render/forms'
import { sheetHeight } from './render/foil'
import { glove } from './render/gloves'
import type { WristPose } from './render/toolGrip'
import { instrument, powderColors } from './render/instruments'

const ids = Object.keys(HOME) as ObjectId[]
const limit = (v: number) => Math.max(0, Math.min(1, v))
function activeFold(s: GameState) {
  const id = foldingFoil(s.stage)
  if (s.status !== 'playing' || !id || s.target !== id || s.hand.held || s.objects[id].folded || !inWork(s.objects[id])) return null
  return s.objects[id]
}
const styles = `
.gb-window {position:absolute;inset:0;overflow:hidden;pointer-events:none;box-shadow:inset 0 0 0 3px #223b67,inset 0 0 0 5px #b7d0fd70,inset 0 7px 16px #1a325b45,inset 0 -4px 10px #182c4a50;z-index:1}
.gb-window::after {content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(119deg,transparent 2%,#effaff12 2.15%,#eef8ff09 5%,transparent 5.2%,transparent 88%,#e5f5ff10 88.15%,transparent 91%);}
.gb-station {position:absolute;left:0;top:0;width:8px;height:8px;margin:-4px;pointer-events:none;z-index:1}
.gb-station > span {position:absolute;left:50%;top:50%;transform:translate(calc(-50% + var(--shift, 0px)),var(--offset));white-space:nowrap;color:#172d4e;background:#f9fbfff2;border:1px solid #788ca8;border-radius:3px;padding:2px 5px;font:700 var(--label-size, 11px)/1.2 "Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;letter-spacing:.025em;box-shadow:0 1px 2px #1a365637;pointer-events:auto;cursor:crosshair;}
.gb-station[data-focus] {z-index:3}
.gb-station[data-focus] > span {color:#ffffff;background:#263f70;border-color:#e9f4ff}
.gb-station[data-held] > span {pointer-events:none}
.gb-station[data-goal] {z-index:4}
.gb-station[data-goal] > span {color:#ffffff;background:#1747cf;border-color:#ecf6ff}
.gb-fold-guide {position:absolute;inset:0;pointer-events:none;z-index:5}
.gb-fold-guide i,.gb-fold-guide b {position:absolute;left:0;top:0}
.gb-fold-guide i {height:0;border-top:2px dashed #145b8c;transform-origin:left center;filter:drop-shadow(0 1px 0 #fff)}
.gb-fold-guide b {width:7px;height:7px;margin:-3.5px;background:#e8fcff;border:1.5px solid #095077;border-radius:50%;box-shadow:0 0 0 1px #fff}
.gb-loupe {position:absolute;top:28px;right:10px;pointer-events:none;z-index:6;border:2px solid #edf4ff;outline:1px solid #304969;box-shadow:0 2px 8px #10294755;border-radius:4px;overflow:hidden;background:#9dacbc}
.gb-loupe[data-left] {right:auto;left:10px}
.gb-loupe canvas {display:block}
.gb-loupe span {position:absolute;bottom:3px;left:4px;color:#fff;background:#1b3054de;border-radius:2px;padding:1px 4px;font:600 10px/1.4 monospace}
.gb-cursor {position:absolute;top:0;left:0;width:15px;height:15px;margin:-7.5px;border:1.5px solid #ffffff;border-radius:50%;box-shadow:0 0 0 1px #233957e6;pointer-events:none;z-index:2}
.gb-cursor::after {content:"";position:absolute;left:50%;top:50%;width:3px;height:3px;background:#173eab;border:1px solid #ffffff;box-sizing:content-box;border-radius:50%;transform:translate(-50%,-50%)}
`
export async function createScene(host: HTMLElement, initialGraphics = defaultGraphics()): Promise<{
  setGraphics(settings: GraphicsSettings): void
  draw(state: GameState): void
  pick(clientX: number, clientY: number): Station
  setLoupe(enabled: boolean): void
  destroy(): void
}> {
  let graphics = initialGraphics
  const app = new Application()
  await app.init({
    preference: 'webgl',
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
    autoStart: false,
    autoDensity: true,
    resolution: graphics.resolution,
    background: 0xabbcd0,
    antialias: false,
    powerPreference: 'high-performance',
  })
  const view = new View3D({
    width: 1,
    height: 1,
    composite: true,
    environment: null,
    toneMapping: 'none',
    cull: 'cpu',
    resolution: graphics.resolution,
  })
  let fxaa: FxaaEffect | undefined
  if (graphics.antialiasing === 'fxaa') view.passes = [fxaa = new FxaaEffect()]
  view.eventMode = 'none'
  app.stage.addChild(view)
  const f = new Forms(),
    root = view.root
  root.addChild(new AmbientLight({ color: 0xf2f6ff, intensity: 0.93 }))
  const key = new DirectionalLight({ color: 0xfff9f0, intensity: 1.72 })
  root.addChild(key)
  key.position.set(-6, 10, 5)
  key.lookAt({ x: 0, y: 0, z: 0 })
  const fill = new DirectionalLight({ color: 0xd5e7ff, intensity: 0.7 })
  root.addChild(fill)
  fill.position.set(7, 5, -3)
  fill.lookAt({ x: 0, y: 0, z: 0 })
  const pilot = chamber(f, root)
  const left = glove(f, root, -1),
    right = glove(f, root, 1)
  const skin = document.createElement('div'),
    style = document.createElement('style'),
    cursor = document.createElement('span')
  const fpsLabel = document.createElement('output')
  fpsLabel.setAttribute('aria-label', '描画フレームレート')
  fpsLabel.style.cssText = 'position:absolute;top:8px;right:8px;color:white;background:#1c3177;padding:3px 6px;font:600 11px monospace'
  fpsLabel.hidden = !graphics.showFps
  skin.appendChild(fpsLabel)
  let frames = 0, fpsStart = 0
  skin.className = 'gb-window'
  style.textContent = styles
  cursor.className = 'gb-cursor'
  const guide = document.createElement('div'), crease = document.createElement('i')
  guide.className = 'gb-fold-guide'
  guide.hidden = true
  guide.setAttribute('aria-hidden', 'true')
  const foldPoints = ['start', 'end'].map((name) => {
    const dot = document.createElement('b')
    dot.dataset.foldPoint = name
    return dot
  })
  guide.append(crease, ...foldPoints)
  const loupe = document.createElement('div'), detail = document.createElement('canvas')
  const scaleLabel = document.createElement('span')
  scaleLabel.textContent = '2.5×'
  loupe.className = 'gb-loupe'
  loupe.setAttribute('aria-label', '手元の拡大表示')
  loupe.hidden = true
  loupe.append(detail, scaleLabel)
  skin.append(style, cursor, guide, loupe)
  let detailContext: CanvasRenderingContext2D | null = null
  let loupeLeft = false, loupeWidth = 0, loupeHeight = 0
  const position = host.style.position
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
  app.canvas.style.display = 'block'
  app.canvas.setAttribute('aria-hidden', 'true')
  host.append(app.canvas, skin)
  const models = ids.map((id) => {
    const model = instrument(f, root, id)
    const shadow = f.shadow(root, model.radius * 2.7, model.radius * 2.22)
    const marker = document.createElement('span'),
      caption = document.createElement('span')
    marker.className = 'gb-station'
    marker.dataset.station = id
    caption.textContent = LABELS[id]
    marker.appendChild(caption)
    skin.appendChild(marker)
    return { id, model, marker, caption, shadow, ax: 0, ay: 0, offset: 0, tagWidth: 0, tagHeight: 0 }
  })
  const goal = f.mesh(root, f.ring, f.ink(0x174edb), 0, 0.034, 0, 1)
  const powderWorld = new PowderPhysics()
  f.setShadows(graphics.shadows)
  powderWorld.setDetail(graphics.particles)
  const grainShape = f.geometry(new SphereGeometry({ radius: 1, widthSegments: 7, heightSegments: 5 }))
  const grainMeshes: Mesh3D[] = []
  let previousRound: GameState | undefined
  let previousRemaining = 0
  const plane = new Plane(new Vector3(0, 1, 0), -ANCHOR_HEIGHT)
  const handlePlane = new Plane(new Vector3(0, 1, 0), -0.15)
  const sheetPlane = new Plane(new Vector3(0, 1, 0), -sheetHeight)
  const powderSurface = new Plane(new Vector3(0, 1, 0), -1.11)
  const jarLid = new Plane(new Vector3(0, 1, 0), -1.415)
  const shieldRoof = new Plane(new Vector3(0, 1, 0), -1.58)
  const point = new Vector3()
  let width = 1,
    height = 1,
    last: GameState | undefined
  let hovering: ObjectId | null = null
  const resize = () => {
    width = Math.max(1, host.clientWidth)
    height = Math.max(1, host.clientHeight)
    loupeWidth = Math.round(Math.min(320, width * 0.43))
    loupeHeight = Math.round(Math.min(248, height * 0.39))
    app.renderer.resize(width, height, graphics.resolution)
    view.width = width
    view.height = height
    view.camera.mode = 'perspective'
    view.camera.near = 0.1
    view.camera.far = 90
    view.camera.position.set(0, 12.5, 15.7)
    view.camera.lookAt({ x: 0, y: 0.49, z: 0 })
    const halfH = Math.max(3.55, (6.75 * height) / width)
    view.camera.fov = (2 * Math.atan(halfH / 19.7) * 180) / Math.PI
    skin.style.setProperty('--label-size', width < 480 ? '9px' : width < 850 ? '10px' : '12px')
    for (const entry of models) {
      entry.caption.style.padding = width < 500 ? '1px 3px' : '2px 5px'
      const wasHidden = entry.marker.hidden
      entry.marker.hidden = false
      const box = entry.caption.getBoundingClientRect()
      entry.marker.hidden = wasHidden
      entry.tagWidth = box.width
      entry.tagHeight = box.height
    }
    if (last) draw(last)
  }
  const ro = new ResizeObserver(resize)
  ro.observe(host)
  resize()

  function pick(clientX: number, clientY: number): Station {
    const rect = app.canvas.getBoundingClientRect()
    const pixel = {
      x: ((clientX - rect.left) * width) / (rect.width || 1),
      y: ((clientY - rect.top) * height) / (rect.height || 1),
    }
    const sheet = last && activeFold(last)
    if (sheet) {
      const surface = view.screenToWorld(pixel, sheetPlane, point)
      if (surface && Math.hypot(surface.x - worldX(sheet.x), surface.z - worldZ(sheet.y)) < 1.02)
        return { x: surface.x / TABLE_WIDTH + 0.5, y: surface.z / TABLE_DEPTH + 0.5 }
    }
    // Captions select their own instrument. Folding uses the actual paper surface,
    // including where a nearby label or the animated hand crosses the crease.
    const label = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.gb-station')
    const id = label?.dataset.station as ObjectId | undefined
    if (id && label && skin.contains(label) && last) {
      if (isTool(id) && last.hand.held !== id) return toolHandle(id, last.objects[id])
      const { x, y } = last.objects[id]
      return { x, y }
    }
    // Raised lids and the draft shield project well behind their tabletop anchors.
    if (last) {
      if (!last.hand.held) {
        const hit = view.screenToWorld(pixel, handlePlane, point)
        if (hit) for (const id of ['spatula', 'pestle'] as const) {
          const handle = toolHandle(id, last.objects[id])
          if (Math.hypot(hit.x - worldX(handle.x), hit.z - worldZ(handle.y)) < 0.25) return handle
        }
      }
      for (const id of ['jarA', 'jarB', 'jarC'] as const) {
        const jar = last.objects[id]
        if (last.hand.held === id || jar.toppled) continue
        const surface = view.screenToWorld(pixel, jar.open ? powderSurface : jarLid, point)
        if (surface && Math.hypot(surface.x - worldX(jar.x), surface.z - worldZ(jar.y)) < 0.46) {
          if (jar.open && last.hand.held === 'spatula')
            return { x: surface.x / TABLE_WIDTH + 0.5, y: surface.z / TABLE_DEPTH + 0.5 }
          return { x: jar.x, y: jar.y }
        }
      }
      const scale = last.objects.scale
      const roof = view.screenToWorld(pixel, shieldRoof, point)
      if (roof && Math.abs(roof.x - worldX(scale.x)) <= 0.75 &&
        Math.abs(roof.z - worldZ(scale.y) + 0.12) <= 0.58)
        return { x: scale.x, y: scale.y }
      if (!last.hand.held) {
        const surface = view.screenToWorld(pixel, sheetPlane, point)
        if (surface) for (const id of foilIds) {
          const foil = last.objects[id], angle = foil.yaw ?? 0
          const dx = surface.x - worldX(foil.x), dz = surface.z - worldZ(foil.y)
          const localX = dx * Math.cos(angle) - dz * Math.sin(angle)
          const localZ = dz * Math.cos(angle) + dx * Math.sin(angle)
          if (Math.max(Math.abs(localX), Math.abs(localZ)) <= foilHalfSide) return { x: foil.x, y: foil.y }
        }
      }
    }
    const hit = view.screenToWorld(pixel, plane, point)
    return hit
      ? { x: limit(hit.x / TABLE_WIDTH + 0.5), y: limit(hit.z / TABLE_DEPTH + 0.5) }
      : { x: 0.5, y: 0.5 }
  }
  function pointer(e: PointerEvent) {
    if (!last) return
    const p = pick(e.clientX, e.clientY)
    let best = 0.106
    hovering = null
    for (const id of ids) {
      const o = isTool(id) && last.hand.held !== id ? toolHandle(id, last.objects[id]) : last.objects[id],
        d = Math.hypot(o.x - p.x, o.y - p.y)
      if (d < best) {
        best = d
        hovering = id
      }
    }
  }
  const leave = () => {
    hovering = null
  }
  host.addEventListener('pointermove', pointer)
  host.addEventListener('pointerleave', leave)
  function layoutCaptions() {
    const occupied: { left: number; top: number; right: number; bottom: number }[] = []
    for (const entry of models) {
      if (entry.marker.hidden) continue
      const { ax, ay, offset, tagWidth: w, tagHeight: h } = entry
      // On a phone the two foil sheets and the vial/cap sit almost one caption apart.
      const sideLabel = width < 500 && (isFoil(entry.id) || entry.id === 'vial' || entry.id === 'cap')
      const preferredX = sideLabel ? (ax < width / 2 ? 1 : -1) * (w / 2 + width * entry.model.radius / 12) : 0
      const preferredY = sideLabel ? 1 : offset
      const candidates = [
        [preferredX, preferredY],
        [0, offset],
        [0, offset + h + 3],
        [0, -h - 13],
        [-w * 0.68, offset],
        [w * 0.68, offset],
        [-w * 0.7, -h - 4],
        [w * 0.7, -h - 4],
      ]
      let bestScore = Infinity,
        bestX = 0,
        bestY = offset
      for (const [shift, dy] of candidates) {
        const dx = Math.max(w / 2 + 4, Math.min(width - w / 2 - 4, ax + shift)) - ax
        const left = ax + dx - w / 2,
          right = left + w,
          top = ay + dy,
          bottom = top + h
        let score = Math.abs(dx - preferredX) * 0.12 + Math.abs(dy - preferredY) * 0.2
        if (top < 3 || bottom > height - 3) score += 1000
        for (const other of models) {
          if (
            !other.marker.hidden &&
            other.ax >= left - 4 &&
            other.ax <= right + 4 &&
            other.ay >= top - 3 &&
            other.ay <= bottom + 3
          )
            score += 500
        }
        for (const prior of occupied) {
          if (
            left < prior.right + 2 &&
            right > prior.left - 2 &&
            top < prior.bottom + 2 &&
            bottom > prior.top - 2
          )
            score += 150
        }
        if (score < bestScore) {
          bestScore = score
          bestX = dx
          bestY = dy
        }
      }
      const x = Math.round(bestX) + 'px',
        y = Math.round(bestY) + 'px'
      if (entry.marker.style.getPropertyValue('--shift') !== x) entry.marker.style.setProperty('--shift', x)
      if (entry.marker.style.getPropertyValue('--offset') !== y) entry.marker.style.setProperty('--offset', y)
      occupied.push({
        left: ax + bestX - w / 2,
        right: ax + bestX + w / 2,
        top: ay + bestY,
        bottom: ay + bestY + h,
      })
    }
  }
  const support = { x: -3.1, z: 2.35, height: ANCHOR_HEIGHT }
  let previousDraw = 0
  function draw(s: GameState) {
    last = s
    const t = performance.now() / 1000
    if (graphics.showFps) {
      if (!fpsStart) fpsStart = t
      frames++
      if (t - fpsStart >= 0.5) {
        fpsLabel.textContent = Math.round(frames / (t - fpsStart)) + ' FPS'
        frames = 0
        fpsStart = t
      }
    }
    const goalId = s.status === 'playing' ? s.target : null
    const held = s.hand.held
    const project = (x: number, y: number, z: number) => view.worldToScreen({ x, y, z })
    const hx = worldX(s.hand.x),
      hz = worldZ(s.hand.y)
    const yaw = Math.atan2(3.76 - hx, Math.max(0.5, 3.76 - hz)) * 0.76
    let utensilHeight = 0.64
    if (held === 'spatula') {
      for (const id of ['jarA', 'jarB', 'jarC'] as const) {
        const jar = s.objects[id]
        const reach = limit(1 - (Math.hypot(s.hand.x - jar.x, s.hand.y - jar.y) - 0.045) / 0.12)
        utensilHeight = Math.max(utensilHeight, 0.64 + reach * (0.78 - 0.31 * s.scoopDepth))
      }
      const reach = limit(1 - Math.hypot(s.hand.x - s.objects.scale.x, s.hand.y - s.objects.scale.y) / 0.14)
      utensilHeight = Math.max(utensilHeight, 0.64 + 0.32 * reach)
    }
    let grind = 0
    if (held === 'pestle') {
      const bowl = s.objects.mortar
      const r = Math.hypot(hx - worldX(bowl.x), hz - worldZ(bowl.y))
      grind = bowl.toppled ? 0 : limit((0.73 - r) / 0.20)
      // Trace the ceramic floor while lifting the working end over the lip.
      utensilHeight = 0.81 * (1 - grind) + (0.32 + 0.85 * r * r) * grind
    }
    let toolWrist: WristPose | undefined
    let toolTip: { x: number; y: number; z: number } | undefined
    for (const entry of models) {
      const { id, model, marker, shadow } = entry
      const o = s.objects[id],
        x = worldX(o.x),
        z = worldZ(o.y)
      const dockedFoil =
        isWeighFoil(id) && id !== held && Math.hypot(o.x - s.objects.scale.x, o.y - s.objects.scale.y) < 0.055
      const sealedCap =
        id === 'cap' &&
        !s.objects.vial.open &&
        Math.hypot(o.x - s.objects.vial.x, o.y - s.objects.vial.y) < 0.03
      const heldTool = isTool(id) && id === held
      const pickup = heldTool ? s.hand.toolPickup : undefined
      const linear = pickup?.progress ?? 1
      const lift = linear * linear * (3 - 2 * linear)
      const y = heldTool ? utensilHeight * lift + 0.14 * Math.sin(lift * Math.PI)
        : id === held ? 0.5 : dockedFoil ? 0.515 : 0
      const px = pickup ? (1 - lift) * worldX(pickup.x) + lift * x : x
      const pz = pickup ? (1 - lift) * worldZ(pickup.y) + lift * z : z
      model.root.visible = !sealedCap
      model.root.position.set(px, y + (o.toppled ? model.radius * 0.75 : 0), pz)
      model.root.rotation.z = o.toppled ? -Math.sign(o.tilt || 1) * 1.36 : -o.tilt
      const initialYaw = pickup?.yaw ?? yaw
      const turn = Math.atan2(Math.sin(yaw - initialYaw), Math.cos(yaw - initialYaw))
      model.root.rotation.y = heldTool ? initialYaw + lift * turn : (o.yaw ?? 0)
      model.update?.(o, s.scaleMass, s.mixed, id === held, id === 'pestle' ? grind : s.scoopDepth, lift)
      if (heldTool) {
        toolWrist = model.grip?.wrist()
        toolTip = model.tip?.toGlobal({ x: 0, y: 0, z: 0 })
      }
      shadow.position.set(x + 0.09, 0.013, z + 0.065)
      shadow.visible = !heldTool && !dockedFoil && !sealedCap && id !== 'work'
      const handle = isTool(id) && !heldTool ? toolHandle(id, o) : undefined
      const anchor = handle ? project(worldX(handle.x), 0.15, worldZ(handle.y))
        : project(x, isFoil(id) ? y + sheetHeight : ANCHOR_HEIGHT, z)
      const tag = project(x, 0.022, z + model.radius * (width < 500 ? 0.48 : 0.7) + 0.08)
      if (anchor && tag) {
        const transform = 'translate(' + anchor.x.toFixed(2) + 'px,' + anchor.y.toFixed(2) + 'px)'
        if (marker.style.transform !== transform) marker.style.transform = transform
        entry.ax = anchor.x
        entry.ay = anchor.y
        const rearInstrument = id === 'scale' || id === 'jarA' || id === 'jarB' || id === 'jarC'
        const top = width < 500 && rearInstrument ? project(x, y + model.height, z - 0.25) : null
        entry.offset = top ? top.y - anchor.y - entry.tagHeight - 2 : tag.y - anchor.y + 2
      }
      marker.hidden =
        heldTool || sealedCap ||
        (id === 'work' && goalId !== 'work') ||
        (id === 'scale' && goalId !== 'scale' && Object.values(weighFoils).some((foil) =>
          held !== foil && Math.hypot(s.objects[foil].x - o.x, s.objects[foil].y - o.y) < 0.055))
      marker.toggleAttribute('data-held', id === held)
      marker.toggleAttribute('data-goal', id === goalId)
      marker.toggleAttribute('data-focus', id === hovering || id === held)
      if (id === goalId) {
        goal.position.set(handle ? worldX(handle.x) : x, 0.036, handle ? worldZ(handle.y) : z)
        const r = model.radius * (1.25 + 0.035 * Math.sin(t * 4))
        goal.scale.set(r, 0.45, r)
      }
    }
    const sheet = activeFold(s)
    guide.hidden = !sheet
    if (sheet) {
      const [a, b] = foldStroke(sheet).map(p => project(worldX(p.x), sheetHeight, worldZ(p.y)))
      if (a && b) {
        const at = (p: { x: number; y: number }) => 'translate(' + p.x.toFixed(2) + 'px,' + p.y.toFixed(2) + 'px)'
        foldPoints[0].style.transform = at(a)
        foldPoints[1].style.transform = at(b)
        crease.style.width = Math.hypot(b.x - a.x, b.y - a.y).toFixed(2) + 'px'
        crease.style.transform = at(a) + ' rotate(' + Math.atan2(b.y - a.y, b.x - a.x) + 'rad)'
      }
    }
    layoutCaptions()
    goal.visible = goalId !== null
    const title = s.status === 'title'
    const idle = title ? 0.1 : 0
    const tracing = sheet && Math.hypot(hx - worldX(sheet.x), hz - worldZ(sheet.y)) < 1.04
    right(
      hx,
      hz,
      yaw,
      s.hand.tilt,
      held ? 0.78 : 0,
      t,
      tracing ? 0.11 : ANCHOR_HEIGHT,
      toolWrist,
    )
    // The free glove braces the vessel while the tool hand scoops or grinds.
    const receiving =
      held === 'pestle' ? (['mortar'] as const) : held === 'spatula' ? (['jarA', 'jarB', 'jarC'] as const) : []
    let brace: Station | undefined
    for (const id of receiving) {
      const vessel = s.objects[id]
      if (
        !vessel.toppled &&
        (id === 'mortar' || vessel.open) &&
        Math.hypot(s.hand.x - vessel.x, s.hand.y - vessel.y) < 0.1
      )
        brace = vessel
    }
    const blend = 1 - Math.exp(-Math.min(0.1, t - previousDraw) * 7)
    previousDraw = t
    support.x += ((brace ? worldX(brace.x) - 0.48 : -3.1 + Math.sin(t * 0.91) * 0.06) - support.x) * blend
    support.z +=
      ((brace ? worldZ(brace.y) + 0.1 : 2.35 + Math.sin(t * 1.13) * (0.035 + idle)) - support.z) * blend
    support.height += ((brace ? (held === 'pestle' ? 0.44 : 0.61) : ANCHOR_HEIGHT) - support.height) * blend
    left(support.x, support.z, -0.64, 0.11, brace ? 0.55 : 0.15, t + 0.83, support.height)
    const target = toolTip ? project(toolTip.x, toolTip.y, toolTip.z) : project(hx, tracing ? sheetHeight : ANCHOR_HEIGHT, hz)
    cursor.hidden = s.status !== 'playing'
    if (target)
      cursor.style.transform = 'translate(' + target.x.toFixed(2) + 'px,' + target.y.toFixed(2) + 'px)'
    pilot.scale.y = 0.07 + 0.009 * Math.sin(t * 2.5)
    if (previousRound !== s) {
      powderWorld.reset()
      previousRound = s
      previousRemaining = s.remaining
    }
    powderWorld.advance(s.powderTransfers, s.transferSeq, previousRemaining - s.remaining)
    previousRemaining = s.remaining
    const moving = powderWorld.moving, settled = powderWorld.residue
    const count = moving.length + settled.length
    for (let i = 0; i < Math.max(count, grainMeshes.length); i++) {
      if (i >= count) {
        grainMeshes[i].visible = false
        continue
      }
      const airborne = i < moving.length
      const grain = airborne ? moving[i] : settled[i - moving.length]
      const mesh = grainMeshes[i] ?? (grainMeshes[i] = f.mesh(root, grainShape, powderColors[grain.kind]))
      mesh.visible = true
      mesh.material = f.material(powderColors[grain.kind])
      mesh.position.set(grain.x, grain.y, grain.z)
      mesh.scale.set(grain.radius, grain.radius * (airborne ? 0.84 : 0.57), grain.radius * 0.91)
    }
    app.render()
    if (!loupe.hidden && detailContext && target) {
      // Copy the WebGL drawing buffer in this frame, before the browser presents it.
      // CSS dimensions and the main renderer's current pixel resolution are independent.
      const density = Math.min(window.devicePixelRatio || 1, 1.5)
      const w = Math.round(loupeWidth * density), h = Math.round(loupeHeight * density)
      if (detail.width !== w || detail.height !== h) {
        detail.width = w
        detail.height = h
      }
      detail.style.width = loupeWidth + 'px'
      detail.style.height = loupeHeight + 'px'
      if (target.x < width * 0.44) loupeLeft = false
      else if (target.x > width * 0.56) loupeLeft = true
      loupe.toggleAttribute('data-left', loupeLeft)
      const wrist = toolWrist && project(toolWrist.position.x, toolWrist.position.y, toolWrist.position.z)
      const cropWidth = loupeWidth / 2.5, cropHeight = loupeHeight / 2.5
      // Favor the working point; include the fingers on the handle whenever it fits.
      const centerX = target.x + (wrist ? Math.max(-cropWidth * 0.35, Math.min(cropWidth * 0.35, (wrist.x - target.x) * 0.45)) : 0)
      const centerY = target.y + (wrist ? Math.max(-cropHeight * 0.35, Math.min(cropHeight * 0.35, (wrist.y - target.y) * 0.45)) : 0)
      const sx = Math.max(0, Math.min(width - cropWidth, centerX - cropWidth / 2))
      const sy = Math.max(0, Math.min(height - cropHeight, centerY - cropHeight / 2))
      const rx = app.canvas.width / width, ry = app.canvas.height / height
      detailContext.drawImage(app.canvas, sx * rx, sy * ry, cropWidth * rx, cropHeight * ry, 0, 0, w, h)
    }
  }
  return {
    draw,
    pick,
    setLoupe(enabled) {
      if (enabled) detailContext ??= detail.getContext('2d', { alpha: false })
      loupe.hidden = !enabled || !detailContext
    },
    setGraphics(next) {
      const resolutionChanged = graphics.resolution !== next.resolution
      if (graphics.antialiasing !== next.antialiasing) {
        if (next.antialiasing === 'fxaa') fxaa ??= new FxaaEffect()
        view.passes = next.antialiasing === 'fxaa' && fxaa ? [fxaa] : []
      }
      if (graphics.showFps !== next.showFps) {
        frames = 0
        fpsStart = 0
        fpsLabel.hidden = !next.showFps
        fpsLabel.textContent = ''
      }
      graphics = next
      f.setShadows(next.shadows)
      powderWorld.setDetail(next.particles)
      if (resolutionChanged) {
        view.resolution = next.resolution
        resize()
      }
    },
    destroy() {
      powderWorld.reset()
      ro.disconnect()
      host.removeEventListener('pointermove', pointer)
      host.removeEventListener('pointerleave', leave)
      skin.remove()
      host.style.position = position
      view.passes = []
      fxaa?.destroy()
      view.destroy({ children: true })
      f.destroy()
      app.destroy({ removeView: true }, { children: true })
    },
  }
}

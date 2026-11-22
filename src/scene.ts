// Register the 3D renderer pipes before Pixi initializes the WebGL backend.
import { AmbientLight, DirectionalLight, Plane, Vector3, View3D, type Mesh3D } from '@pixi/3d'
import { Application } from 'pixi.js'
import { HOME, LABELS, type GameState, type ObjectId, type Station } from './contract'
import { ANCHOR_HEIGHT, chamber, TABLE_DEPTH, TABLE_WIDTH, worldX, worldZ } from './render/chamber'
import { Forms } from './render/forms'
import { glove } from './render/gloves'
import { instrument } from './render/instruments'

const ids = Object.keys(HOME) as ObjectId[]
const limit = (v: number) => Math.max(0, Math.min(1, v))
const styles = `
.gb-window {position:absolute;inset:0;overflow:hidden;pointer-events:none;box-shadow:inset 0 0 0 3px #344e4d,inset 0 0 0 5px #95aaa05e,inset 0 7px 16px #17303355,inset 0 -4px 10px #1c383650;z-index:1}
.gb-window::after {content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(119deg,transparent 2%,#defff70c 2.15%,#defff708 5%,transparent 5.2%,transparent 88%,#e7fff50a 88.15%,transparent 91%);}
.gb-station {position:absolute;left:0;top:0;width:8px;height:8px;margin:-4px;pointer-events:none;z-index:1}
.gb-station > span {position:absolute;left:50%;top:50%;transform:translate(calc(-50% + var(--shift, 0px)),var(--offset));white-space:nowrap;color:#253d36;background:#d7e2d5de;border:1px solid #869e90;border-radius:3px;padding:2px 5px;font:700 var(--label-size, 11px)/1.2 "Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;letter-spacing:.025em;box-shadow:0 1px 2px #1e38352b;pointer-events:auto;cursor:crosshair;}
.gb-station[data-focus] {z-index:3}
.gb-station[data-focus] > span {color:#f4fae4;background:#2b4940;border-color:#d1e7b3}
.gb-station[data-goal] {z-index:4}
.gb-station[data-goal] > span {color:#28301c;background:#e4f45e;border-color:#5a6a36}
.gb-cursor {position:absolute;top:0;left:0;width:15px;height:15px;margin:-7.5px;border:1.5px solid #f6ffe5;border-radius:50%;box-shadow:0 0 0 1px #27433cc4;pointer-events:none;z-index:2}
.gb-cursor::after {content:"";position:absolute;left:50%;top:50%;width:3px;height:3px;background:#26463c;border:1px solid #f7ffe8;box-sizing:content-box;border-radius:50%;transform:translate(-50%,-50%)}
`
export async function createScene(host: HTMLElement): Promise<{
  draw(state: GameState): void
  pick(clientX: number, clientY: number): Station
  destroy(): void
}> {
  const app = new Application()
  await app.init({
    preference: 'webgl',
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
    autoStart: false,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    background: 0x415e60,
    antialias: true,
    powerPreference: 'high-performance',
  })
  const view = new View3D({
    width: 1,
    height: 1,
    composite: true,
    environment: null,
    toneMapping: 'none',
    cull: 'cpu',
    resolution: Math.min(1.5, window.devicePixelRatio || 1),
  })
  view.eventMode = 'none'
  app.stage.addChild(view)
  const f = new Forms(),
    root = view.root
  root.addChild(new AmbientLight({ color: 0xe0eee7, intensity: 0.93 }))
  const key = new DirectionalLight({ color: 0xfff0d1, intensity: 1.72 })
  root.addChild(key)
  key.position.set(-6, 10, 5)
  key.lookAt({ x: 0, y: 0, z: 0 })
  const fill = new DirectionalLight({ color: 0xc8e8f7, intensity: 0.7 })
  root.addChild(fill)
  fill.position.set(7, 5, -3)
  fill.lookAt({ x: 0, y: 0, z: 0 })
  const pilot = chamber(f, root)
  const left = glove(f, root, -1),
    right = glove(f, root, 1)
  const skin = document.createElement('div'),
    style = document.createElement('style'),
    cursor = document.createElement('span')
  skin.className = 'gb-window'
  style.textContent = styles
  cursor.className = 'gb-cursor'
  skin.append(style, cursor)
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
  const goal = f.mesh(root, f.ring, f.ink(0xd8e845), 0, 0.034, 0, 1)
  const particles: Mesh3D[] = []
  const residue: Mesh3D[] = []
  let spilled = 0,
    residueCount = 0
  const plane = new Plane(new Vector3(0, 1, 0), -ANCHOR_HEIGHT)
  const point = new Vector3()
  let width = 1,
    height = 1,
    last: GameState | undefined
  let hovering: ObjectId | null = null
  const resize = () => {
    width = Math.max(1, host.clientWidth)
    height = Math.max(1, host.clientHeight)
    app.renderer.resize(width, height)
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
    // Captions can be selected directly; every other pixel is a real ray/plane intersection.
    const label = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.gb-station')
    const id = label?.dataset.station as ObjectId | undefined
    if (id && label && skin.contains(label) && last) {
      const { x, y } = last.objects[id]
      return { x, y }
    }
    const rect = app.canvas.getBoundingClientRect()
    const hit = view.screenToWorld(
      {
        x: ((clientX - rect.left) * width) / (rect.width || 1),
        y: ((clientY - rect.top) * height) / (rect.height || 1),
      },
      plane,
      point,
    )
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
      const o = last.objects[id],
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
      const candidates = [
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
        let score = Math.abs(dx) * 0.12 + Math.abs(dy - offset) * 0.2
        if (top < 3 || bottom > height - 3) score += 1000
        for (const other of models) {
          if (
            !other.marker.hidden &&
            other.ax >= left - 6 &&
            other.ax <= right + 6 &&
            other.ay >= top - 6 &&
            other.ay <= bottom + 6
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
  function draw(s: GameState) {
    last = s
    const t = performance.now() / 1000
    const goalId = s.status === 'playing' ? s.target : null
    const held = s.hand.held
    const project = (x: number, y: number, z: number) => view.worldToScreen({ x, y, z })
    for (const entry of models) {
      const { id, model, marker, shadow } = entry
      const o = s.objects[id],
        x = worldX(o.x),
        z = worldZ(o.y)
      const dockedFoil =
        id === 'foil' && id !== held && Math.hypot(o.x - s.objects.scale.x, o.y - s.objects.scale.y) < 0.055
      const sealedCap =
        id === 'cap' &&
        !s.objects.vial.open &&
        Math.hypot(o.x - s.objects.vial.x, o.y - s.objects.vial.y) < 0.03
      const y = id === held ? 0.5 : dockedFoil ? 0.515 : 0
      model.root.visible = !sealedCap
      model.root.position.set(x, y + (o.toppled ? model.radius * 0.75 : 0), z)
      model.root.rotation.z = o.toppled ? -Math.sign(o.tilt || 1) * 1.36 : -o.tilt
      model.update?.(o, s.scaleMass, s.mixed)
      shadow.position.set(x + 0.09, 0.013, z + 0.065)
      shadow.visible = !dockedFoil && !sealedCap
      const anchor = project(x, ANCHOR_HEIGHT, z)
      const tag = project(x, 0.022, z + model.radius * 0.7 + 0.15)
      if (anchor && tag) {
        const transform = 'translate(' + anchor.x.toFixed(2) + 'px,' + anchor.y.toFixed(2) + 'px)'
        if (marker.style.transform !== transform) marker.style.transform = transform
        entry.ax = anchor.x
        entry.ay = anchor.y
        entry.offset = tag.y - anchor.y + 2
      }
      marker.hidden =
        sealedCap ||
        (id === 'scale' && s.objects.foil.x === o.x && s.objects.foil.y === o.y && goalId !== 'scale')
      marker.toggleAttribute('data-goal', id === goalId)
      marker.toggleAttribute('data-focus', id === hovering || id === held)
      if (id === goalId) {
        goal.position.set(x, 0.036, z)
        const r = model.radius * (1.25 + 0.035 * Math.sin(t * 4))
        goal.scale.set(r, 0.45, r)
      }
    }
    layoutCaptions()
    goal.visible = goalId !== null
    const title = s.status === 'title'
    const hx = worldX(s.hand.x),
      hz = worldZ(s.hand.y)
    const idle = title ? 0.1 : 0
    right(hx, hz, Math.atan2(3.76 - hx, Math.max(0.5, 3.76 - hz)) * 0.76, s.hand.tilt, held ? 0.78 : 0, t)
    left(
      -3.1 + Math.sin(t * 0.91) * 0.06,
      2.35 + Math.sin(t * 1.13) * (0.035 + idle),
      -0.44,
      0.11,
      0.15,
      t + 0.83,
    )
    const target = project(hx, ANCHOR_HEIGHT, hz)
    cursor.hidden = s.status !== 'playing'
    if (target)
      cursor.style.transform = 'translate(' + target.x.toFixed(2) + 'px,' + target.y.toFixed(2) + 'px)'
    pilot.scale.y = 0.07 + 0.009 * Math.sin(t * 2.5)
    // A spill leaves powder at the emission point after its airborne particles settle.
    // Keep the visual on the bench until a new round resets the mass ledger.
    if (s.spilled < spilled) {
      for (const spot of residue) spot.visible = false
      residueCount = 0
    } else if (s.spilled > spilled) {
      const source = s.particles.at(-1) ?? s.hand
      const color = s.particles.at(-1)?.kind === 'b' ? 0x87b7ba : 0xc0a35c
      const count = Math.max(1, Math.min(7, Math.ceil((s.spilled - spilled) * 28)))
      for (let i = 0; i < count; i++) {
        const index = residueCount % 128
        const spot = residue[index] ?? (residue[index] = f.mesh(root, f.ball, color))
        const angle = residueCount * 2.39996,
          radius = 0.12 + 0.31 * Math.abs(Math.sin(residueCount * 1.72))
        spot.position.set(
          worldX(source.x) + Math.cos(angle) * radius,
          0.019,
          worldZ(source.y) + Math.sin(angle) * radius,
        )
        spot.scale.set(0.042 + 0.019 * Math.sin(angle), 0.012, 0.038)
        spot.material = f.material(color)
        spot.visible = true
        residueCount++
      }
    }
    spilled = s.spilled
    for (let i = 0; i < Math.max(particles.length, s.particles.length); i++) {
      const grain = s.particles[i]
      if (!grain) {
        particles[i].visible = false
        continue
      }
      const mesh = particles[i] ?? (particles[i] = f.mesh(root, f.ball, 0xe3d099))
      mesh.visible = true
      mesh.material = f.material(grain.kind === 'a' ? 0xffda80 : 0x92c6d2)
      const age = limit(1 - grain.life / 0.6)
      mesh.position.set(
        worldX(grain.x),
        0.06 + 0.4 * Math.sin(age * Math.PI) + 0.2 * (1 - age),
        worldZ(grain.y),
      )
      mesh.scale.set(0.034, 0.025, 0.038)
    }
    app.render()
  }
  return {
    draw,
    pick,
    destroy() {
      ro.disconnect()
      host.removeEventListener('pointermove', pointer)
      host.removeEventListener('pointerleave', leave)
      skin.remove()
      host.style.position = position
      view.destroy({ children: true })
      f.destroy()
      app.destroy({ removeView: true }, { children: true })
    },
  }
}

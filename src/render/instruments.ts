import { Container3D, Geometry3D, Quaternion, Vector3, type Mesh3D } from '@pixi/3d'
import { DRY_SECONDS, LABELS, isFoil, mass as powderMass, type ObjectId, type Powder, type TableObject, type GameState } from '../contract'
import { jarPowderHeight, vesselGeometry } from '../geometry'
import { Forms, group } from './forms'
import { foilSheet } from './foil'
import { toolGrip } from './toolGrip'

const WHITE = 0xd6d9e1,
  METAL = 0x929fb1,
  CHARCOAL = 0x27364d
const POWDER_A = 0xeee8d3,
  POWDER_B = 0xd6d9cf

export const powderColors = { a: POWDER_A, b: POWDER_B, c: 0xe9cf6f }

export interface Instrument {
  root: Container3D
  radius: number
  height: number
  grip?: ReturnType<typeof toolGrip>
  tip?: Container3D
  update?: (obj: TableObject, mass: number, mixed: number, held: boolean, depth: number, lift: number, state: GameState, dt: number) => void
}

const blendColor = (from: number, to: number, amount: number) => {
  let color = 0
  for (const shift of [16, 8, 0]) {
    const a = (from >> shift) & 255, b = (to >> shift) & 255
    color |= Math.min(255, Math.round((a + (b - a) * amount) / 4) * 4) << shift
  }
  return color
}
function powder(f: Forms, p: Container3D, x: number, y: number, z: number, radius: number) {
  const holder = group(p)
  holder.position.set(x, y, z)
  const lump = f.oval(holder, POWDER_A, 0, 0, 0, radius, 0.12, radius * 0.94)
  const second = f.oval(holder, POWDER_B, 0.1 * radius, 0.025, 0, radius * 0.8, 0.09, radius * 0.88)
  const granules: Mesh3D[] = []
  for (let i = 0; i < 9; i++) {
    const theta = i * 2.4,
      r = Math.sqrt((i + 0.5) / 10) * radius * 0.8
    granules.push(
      f.oval(
        holder,
        i % 2 === 0 ? POWDER_A : POWDER_B,
        Math.cos(theta) * r,
        0.095 * (1 - r / radius),
        Math.sin(theta) * r,
        0.038,
        0.033,
        0.045,
      ),
    )
  }
  return (obj: TableObject, mixed: number, coverage?: number[]) => {
    const weight = powderMass(obj)
    holder.visible = weight > 0.00001
    if (!holder.visible) return
    const fraction = (obj.b + obj.c) / weight
    const accent = obj.c > obj.b ? powderColors.c : POWDER_B
    const amount = Math.min(1, 0.26 + Math.cbrt(weight) * 0.46)
    holder.scale.set(amount, 0.32 + amount * 0.68, amount)
    let homogeneous = 0
    for (const shift of [16, 8, 0]) {
      const channel = (obj.a * ((POWDER_A >> shift) & 255) + obj.b * ((POWDER_B >> shift) & 255) + obj.c * ((powderColors.c >> shift) & 255)) / weight
      homogeneous |= Math.min(255, Math.round(channel / 4) * 4) << shift
    }
    const uniformity = Math.round(Math.min(1, Math.max(0, mixed / 100)) * 20) / 20
    lump.material = f.material(blendColor(fraction > 0.96 ? accent : POWDER_A, homogeneous, uniformity))
    second.material = f.material(blendColor(accent, homogeneous, uniformity))
    second.visible = fraction > 0.02 && fraction < 0.96 && uniformity < 0.96
    second.scale.x = radius * Math.sqrt(fraction) * (1 - 0.7 * uniformity)
    granules.forEach((grain, i) => {
      const original = i / 9 < obj.c / weight ? powderColors.c : i / 9 < fraction ? POWDER_B : POWDER_A
      const sector = (Math.floor(((i * 2.4) % (2 * Math.PI)) / (Math.PI / 4)) + 4) % 8
      const local = coverage ? Math.min(1, coverage[sector] ?? 0) : uniformity
      grain.material = f.material(blendColor(original, homogeneous, Math.max(uniformity * 0.4, local)))
      grain.scale.y = 0.033 * (1 - uniformity * 0.4)
    })
  }
}

function bottleLabel(f: Forms, letter: string, color: string) {
  return f.decal(256, 150, (c) => {
    c.fillStyle = '#fafbff'
    c.fillRect(0, 0, 256, 150)
    c.fillStyle = color
    c.fillRect(0, 0, 26, 150)
    c.fillStyle = '#152841'
    c.textAlign = 'center'
    c.font = 'bold 65px Helvetica,Arial,sans-serif'
    c.fillText(letter, 130, 92)
    c.fillStyle = color
    c.fillRect(33, 108, 184, 5)
    c.font = 'bold 17px monospace'
    c.fillText('LGPS  /  REAGENT', 130, 137)
  })
}

// A cylindrical label patch hugs the bottle and follows its motion and tilt.
function wrap(f: Forms, radius: number, height: number, arc: number) {
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = []
  for (let i = 0; i <= 20; i++) {
    const u = i / 20,
      a = (u - 0.5) * arc,
      x = Math.sin(a),
      z = Math.cos(a)
    positions.push(radius * x, -height / 2, radius * z, radius * x, height / 2, radius * z)
    normals.push(x, 0, z, x, 0, z)
    uvs.push(u, 1, u, 0)
    if (i < 20) {
      const k = i * 2
      indices.push(k, k + 2, k + 1, k + 2, k + 3, k + 1)
    }
  }
  return f.geometry(
    new Geometry3D({
      positions: Float32Array.from(positions),
      normals: Float32Array.from(normals),
      uvs: Float32Array.from(uvs),
      indices: Uint16Array.from(indices),
    }),
  )
}

function jar(f: Forms, root: Container3D, p: Powder): Instrument {
  const a = p === 'a'
  const band = p === 'c' ? 0xc39737 : a ? 0xa94926 : 0x234e9f
  const glass = f.material(p === 'c' ? 0x8e6827 : a ? 0xa55529 : 0x315c88, 0.3)
  f.mesh(
    root,
    f.profile([
      [0, 0],
      [0.38, 0],
      [0.46, 0.045],
      [0.49, 0.11],
      [0.49, 0.86],
      [0.475, 0.94],
      [0.37, 1.04],
      [0.335, 1.07],
      [0.335, 1.19],
      [0.35, 1.21],
      [0.35, 1.25],
      [0.29, 1.25],
      [0.29, 0.18],
      [0, 0.18],
    ]),
    glass,
  )
  f.disc(root, 0x2a3341, 0, 0.165, 0, 0.29, 0.025)
  const contents = f.disc(root, powderColors[p], 0, 1.107, 0, 0.282, 0.021)
  f.mesh(
    root,
    wrap(f, 0.494, 0.53, 2.66),
    bottleLabel(
      f,
      LABELS[p === 'a' ? 'jarA' : p === 'b' ? 'jarB' : 'jarC'],
      p === 'c' ? '#a47819' : a ? '#a54627' : '#244f9f',
    ),
    0,
    0.5,
    0,
  )
  const lid = group(root)
  let lidOpened = false
  const parkedLid = new Vector3()
  f.mesh(
    lid,
    f.profile([
      [0, 0],
      [0.35, 0],
      [0.397, 0.03],
      [0.397, 0.195],
      [0.373, 0.224],
      [0, 0.224],
    ]),
    band,
  )
  f.disc(lid, p === 'c' ? 0xe5bb54 : a ? 0xce774f : 0x508dd3, 0, 0.222, 0, 0.338, 0.018)
  for (let i = 0; i < 24; i++) {
    const t = (i * Math.PI) / 12
    const rib = f.box(lid, band, 0.393 * Math.sin(t), 0.113, 0.393 * Math.cos(t), 0.032, 0.15, 0.015)
    rib.rotation.y = t
  }
  return {
    root,
    radius: 0.51,
    height: 1.45,
    update(obj) {
      if (obj.open && !lidOpened) {
        // A removed lid stays on the bench when its bottle is carried away.
        root.toGlobal({ x: 0.68, y: 0.02, z: -0.12 }, parkedLid)
        root.parent!.addChild(lid)
        lid.position.copyFrom(parkedLid)
        lid.rotation.set(0, 0, -0.10)
      } else if (!obj.open) {
        if (lid.parent !== root) root.addChild(lid)
        lid.position.set(0, 1.185, 0)
        lid.rotation.set(0, 0, 0)
      }
      lidOpened = obj.open
      contents.visible = powderMass(obj) > 0.00001
      contents.position.y = jarPowderHeight(obj)
    },
  }
}

export function instrument(f: Forms, parent: Container3D, id: ObjectId): Instrument {
  const root = group(parent)
  if (id === 'work') return { root, radius: 0.47, height: 0 }
  if (id === 'cleaner') {
    f.box(root, 0x8ba3bf, 0, 0.045, 0, 1.42, 0.09, 1.0)
    f.box(root, 0xe3eaf1, 0, 0.099, 0, 1.33, 0.018, 0.91)
    const bottle = group(root)
    bottle.position.set(-0.44, 0.10, -0.10)
    f.mesh(bottle, f.profile([[0, 0], [0.16, 0], [0.19, 0.06], [0.19, 0.48], [0.09, 0.56], [0.08, 0.67], [0, 0.67]]), f.ink(0xb5e8f4, 0.68))
    f.disc(bottle, 0x286b9f, 0, 0.67, 0, 0.085, 0.11)
    f.box(bottle, 0x286b9f, 0.075, 0.75, 0, 0.23, 0.035, 0.07)
    const label = f.decal(220, 150, c => {
      c.fillStyle = '#f7fbff'; c.fillRect(0, 0, 220, 150)
      c.fillStyle = '#204e80'; c.textAlign = 'center'; c.font = 'bold 45px sans-serif'; c.fillText('EtOH', 110, 65)
      c.font = 'bold 24px sans-serif'; c.fillText('無水', 110, 110)
    })
    f.panel(bottle, label, 0, 0.29, 0.192, 0.31, 0.25)
    // Fresh wipes, a working wipe and a closed bin have distinct positions and colours.
    for (let i = 0; i < 3; i++) f.box(root, i % 2 ? 0xecf3f8 : 0xffffff, 0.36, 0.14 + i * 0.027, -0.25, 0.40, 0.024, 0.25)
    const cloth = group(root)
    cloth.position.set(0.05, 0.13, 0.17)
    const wipe = f.box(cloth, 0xf9fbf5, 0, 0, 0, 0.46, 0.026, 0.34)
    f.box(root, 0x53708d, 0.53, 0.24, 0.24, 0.26, 0.27, 0.30)
    f.box(root, 0x263f5c, 0.53, 0.386, 0.24, 0.28, 0.025, 0.32)
    const used = Array.from({ length: 6 }, (_, i) => f.oval(root, 0xcac9ad, 0.48 + (i % 2) * 0.08, 0.41 + Math.floor(i / 2) * 0.027, 0.21 + (i % 3) * 0.024, 0.059, 0.025, 0.055))
    const lamp = f.disc(root, 0x53bfa0, -0.06, 0.13, -0.34, 0.075, 0.035)
    const drying = f.box(root, 0x2796d1, -0.04, 0.125, 0.39, 0.66, 0.016, 0.033)
    return {
      root, radius: 0.71, height: 0.9,
      update(_obj, _mass, _mixed, _held, _depth, _lift, state) {
        const hygiene = state.toolHygiene
        const washing = hygiene.wipeProgress > 0 && hygiene.wipeProgress < 1
        const pulse = Math.sin(state.elapsed * 26)
        cloth.position.x = 0.05 + (washing ? 0.13 * pulse : 0)
        cloth.rotation.y = washing ? pulse * 0.12 : 0
        wipe.material = f.material(hygiene.state === 'wet' || washing ? 0xc5e9ee : 0xf9fbf5)
        lamp.material = f.material(hygiene.state === 'clean' ? 0x42b58e : hygiene.state === 'wet' ? 0x329bd0 : 0xd79438)
        drying.visible = hygiene.state === 'wet'
        drying.scale.x = 0.66 * Math.max(0.02, Math.min(1, hygiene.dryRemaining / DRY_SECONDS))
        used.forEach((mesh, i) => { mesh.visible = i < hygiene.wipesUsed; })
      },
    }
  }
  if (id === 'jarA' || id === 'jarB' || id === 'jarC')
    return jar(f, root, id === 'jarA' ? 'a' : id === 'jarB' ? 'b' : 'c')
  if (isFoil(id)) {
    const accents = { foil: 0xa94926, foilB: 0x234e9f, foilC: 0xb18a2d, foil2: 0x526877 }
    const paper = group(root)
    const fold = foilSheet(f, paper, accents[id])
    const dust = powder(f, paper, 0, 0.115, 0, 0.30)
    let centered = 0, opened = 0
    return {
      root,
      radius: 0.64,
      height: 0.15,
      update(obj, _mass, mixed, _held, _depth, _lift, _state, dt) {
        const blend = 1 - Math.exp(-dt * 14)
        opened += (Number(obj.unfolded) - opened) * blend
        centered += (Number(obj.folded && !obj.unfolded) - centered) * blend
        fold(obj.foldCount + obj.foldProgress, opened)
        // Once the last crease is pressed, align the packet's centroid with the
        // pickup point and pan center. The guides stay fixed during both strokes.
        paper.position.x = 0.32 * centered
        dust(obj, mixed)
      },
    }
  }
  if (id === 'scale') {
    f.box(root, CHARCOAL, 0, 0.075, 0, 1.55, 0.12, 1.37)
    f.box(root, 0x93a5bc, 0, 0.165, 0, 1.59, 0.16, 1.4)
    f.box(root, 0xd8dfe9, 0, 0.268, -0.025, 1.55, 0.12, 1.32)
    f.disc(root, 0x5a6b84, 0, 0.375, -0.165, 0.565, 0.104)
    f.mesh(
      root,
      f.profile([
        [0, 0],
        [0.51, 0],
        [0.6, 0.035],
        [0.61, 0.072],
        [0.58, 0.09],
        [0, 0.09],
      ]),
      f.material(METAL, 0.48),
      0,
      0.408,
      -0.165,
    )
    f.box(root, CHARCOAL, -0.13, 0.337, 0.462, 0.85, 0.039, 0.27)
    // Transparent draft shield with a sliding front sash and a metal handle.
    const glass = f.ink(0x83bdff, 0.14),
      frame = f.material(0x526785, 0.45)
    for (const x of [-0.73, 0.73]) {
      f.box(root, glass, x, 0.96, -0.12, 0.022, 1.22, 1.13)
      for (const z of [-0.69, 0.45]) f.box(root, frame, x, 0.96, z, 0.035, 1.23, 0.035)
      f.box(root, frame, x, 1.58, -0.12, 0.05, 0.045, 1.18)
    }
    f.box(root, glass, 0, 0.97, -0.69, 1.46, 1.22, 0.02)
    for (const z of [-0.69, 0.45]) f.box(root, frame, 0, 1.58, z, 1.51, 0.052, 0.05)
    f.box(root, glass, 0, 1.58, -0.12, 1.43, 0.018, 1.14)
    const sash = group(root)
    f.box(sash, glass, 0, 0, 0, 1.4, 1.12, 0.022)
    f.box(sash, frame, 0, -0.55, 0, 1.43, 0.048, 0.044)
    f.box(sash, 0x284ec1, 0.37, -0.44, 0.05, 0.31, 0.062, 0.08)
    let opening = 0
    let ctx: CanvasRenderingContext2D | undefined
    let previous = ''
    const readout = f.decal(384, 88, (c) => {
      ctx = c
    })
    const face = f.panel(root, readout, -0.13, 0.358, 0.462, 0.81, 0.23)
    face.rotation.x = -Math.PI / 2
    for (let i = 0; i < 2; i++)
      f.disc(root, i === 0 ? 0x244fbe : 0x8496ac, 0.42 + i * 0.18, 0.34, 0.465, 0.062, 0.034)
    return {
      root,
      radius: 0.8,
      height: 1.59,
      update(obj, mass, _mixed, _held, _depth, _lift, _state, dt) {
        opening += (Number(obj.open) - opening) * (1 - Math.exp(-dt * 12))
        sash.position.set(0, 0.97 + opening * 0.93, 0.456)
        const value = mass.toFixed(3) + ' g'
        if (value === previous || !ctx) return
        previous = value
        ctx.fillStyle = '#10243c'
        ctx.fillRect(0, 0, 384, 88)
        ctx.fillStyle = '#a5f8ec'
        ctx.font = 'bold 66px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(value, 192, 67)
        readout.textures.baseColor?.source.update()
      },
    }
  }
  if (id === 'mortar') {
    f.mesh(
      root,
      f.profile([
        [0, 0],
        [0.31, 0],
        [0.35, 0.04],
        [0.35, 0.12],
        [0.32, 0.15],
        [0.48, 0.23],
        [0.63, 0.4],
        [0.7, 0.61],
        [0.7, 0.71],
        [0.67, 0.75],
        [0.608, 0.72],
        [0.594, 0.61],
        [0.49, 0.43],
        [0.35, 0.34],
        [0.14, 0.29],
        [0, 0.29],
      ]),
      f.material(WHITE, 0.22),
    )
    f.oval(root, WHITE, 0.62, 0.68, -0.03, 0.135, 0.065, 0.14)
    const dust = powder(f, root, 0, 0.345, 0, 0.45)
    return {
      root,
      radius: vesselGeometry.mortar.radius,
      height: 0.75,
      update(obj, _mass, mixed, _held, _depth, _lift, state) {
        dust(obj, mixed, state.mixCoverage)
      },
    }
  }
  if (id === 'pestle' || id === 'spatula') {
    const tool = group(root)
    const pestle = id === 'pestle'
    const grip = toolGrip(f, tool, id), tip = group(tool)
    tip.position.y = pestle ? 1.2 : 1.36
    const resting = new Quaternion().setFromEuler({ x: 1.43, y: 0, z: pestle ? -0.75 : 0.83 })
    const origin = pestle ? new Vector3(-0.45, 0.13, -0.34) : new Vector3(0.42, 0.09, -0.4)
    const carrying = new Quaternion(), restGrip = new Vector3(0, grip.frame.position.y, 0).applyQuaternion(resting)
    const heldGrip = new Vector3(), offset = new Vector3(), rotation = new Quaternion()
    function pose(held: boolean, depth: number, lift: number) {
      grip.frame.visible = held
      if (!held) {
        tool.quaternion.copyFrom(resting)
        tool.position.copyFrom(origin)
        return
      }
      const angle = pestle ? -2.86 + 0.12 * depth : -1.91 - 0.54 * depth
      carrying.setFromAxisAngle({ x: 1, y: 0, z: 0 }, angle)
      resting.slerp(carrying, lift, rotation)
      tool.quaternion.copyFrom(rotation)
      heldGrip.set(0, grip.frame.position.y - tip.position.y, 0).applyQuaternion(carrying)
      offset.set(0, grip.frame.position.y, 0).applyQuaternion(rotation)
      // During pickup the shaft turns about the part that's actually in the palm.
      tool.position.set(
        (origin.x + restGrip.x) * (1-lift) + heldGrip.x * lift - offset.x,
        (origin.y + restGrip.y) * (1-lift) + heldGrip.y * lift - offset.y,
        (origin.z + restGrip.z) * (1-lift) + heldGrip.z * lift - offset.z,
      )
    }
    if (id === 'pestle') {
      f.mesh(
        tool,
        f.profile([
          [0, 0],
          [0.08, 0.02],
          [0.095, 0.08],
          [0.087, 0.72],
          [0.123, 0.84],
          [0.164, 1.02],
          [0.15, 1.12],
          [0.1, 1.17],
          [0, 1.2],
        ]),
        f.material(WHITE, 0.24),
      )
      return { root, grip, tip, radius: 0.57, height: 0.24, update(_obj, _mass, _mixed, held, depth, lift) { pose(held, depth, lift) } }
    }
    f.mesh(
      tool,
      f.profile([
        [0, 0],
        [0.057, 0],
        [0.067, 0.04],
        [0.055, 0.61],
        [0.037, 0.64],
        [0.035, 1.13],
        [0, 1.15],
      ]),
      f.material(0x758499, 0.5),
    )
    f.oval(tool, f.material(0xb1bfcd, 0.72), 0, 1.16, 0, 0.114, 0.215, 0.045)
    const dust = powder(f, tool, 0, 1.15, -0.047, 0.1)
    const stain = f.oval(tool, 0xc7b25e, 0, 1.20, -0.049, 0.066, 0.105, 0.008)
    const wetFilm = f.oval(tool, f.ink(0xa7e5f1, 0.45), 0, 1.16, -0.053, 0.095, 0.18, 0.009)
    return {
      root,
      grip,
      tip,
      radius: 0.56,
      height: 0.16,
      update(obj, _mass, mixed, held, depth, lift, state) {
        pose(held, depth, lift)
        dust(obj, mixed)
        stain.visible = state.toolHygiene.state === 'dirty' && powderMass(obj) < 0.002
        wetFilm.visible = state.toolHygiene.state === 'wet'
      },
    }
  }
  if (id === 'vial') {
    const wall = f.ink(0x94c7f1, 0.32)
    f.mesh(
      root,
      f.profile([
        [0.24, 0.02],
        [0.26, 0.06],
        [0.26, 0.52],
        [0.214, 0.62],
        [0.214, 0.7],
        [0.225, 0.72],
        [0.225, 0.75],
        [0.184, 0.75],
        [0.184, 0.66],
      ]),
      wall,
    )
    f.disc(root, 0x698298, 0, 0.035, 0, 0.242, 0.068)
    f.mesh(root, wrap(f, 0.262, 0.21, 2.4), f.ink(0xf7f9fc), 0, 0.36, 0)
    f.mesh(root, f.ring, 0xa5bad0, 0, 0.748, 0, 0.209)
    const dust = powder(f, root, 0, 0.098, 0, 0.2)
    const closed = f.disc(root, CHARCOAL, 0, 0.755, 0, 0.236, 0.16)
    return {
      root,
      radius: vesselGeometry.vial.radius,
      height: 0.8,
      update(obj, _mass, mixed) {
        dust(obj, mixed)
        closed.visible = !obj.open
      },
    }
  }
  f.mesh(
    root,
    f.profile([
      [0, 0],
      [0.224, 0],
      [0.248, 0.02],
      [0.248, 0.14],
      [0.23, 0.158],
      [0, 0.158],
    ]),
    CHARCOAL,
  )
  f.disc(root, 0x586c88, 0, 0.159, 0, 0.205, 0.009)
  return { root, radius: 0.26, height: 0.16 }
}

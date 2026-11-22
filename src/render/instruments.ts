import { Container3D, Geometry3D, Quaternion, Vector3, type Mesh3D } from '@pixi/3d'
import { LABELS, isFoil, mass as powderMass, type ObjectId, type Powder, type TableObject } from '../contract'
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
  update?: (obj: TableObject, mass: number, mixed: number, held: boolean, depth: number, lift: number) => void
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
  return (obj: TableObject, mixed: number) => {
    const weight = powderMass(obj)
    holder.visible = weight > 0.00001
    if (!holder.visible) return
    const fraction = (obj.b + obj.c) / weight
    const accent = obj.c > obj.b ? powderColors.c : POWDER_B
    const amount = Math.min(1, 0.26 + Math.cbrt(weight) * 0.46)
    holder.scale.set(amount, 0.32 + amount * 0.68, amount)
    lump.material = f.material(fraction > 0.96 ? accent : POWDER_A)
    second.material = f.material(accent)
    second.visible = fraction > 0.02 && fraction < 0.96
    second.scale.x = radius * Math.sqrt(fraction) * (1 - 0.006 * mixed)
    granules.forEach((grain, i) => {
      grain.material = f.material(
        i / 9 < obj.c / weight ? powderColors.c : i / 9 < fraction ? POWDER_B : POWDER_A,
      )
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
      [0.29, 1.1],
    ]),
    glass,
  )
  f.disc(root, 0x2a3341, 0, 1.078, 0, 0.3, 0.035)
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
      lid.position.set(obj.open ? 0.67 : 0, obj.open ? 0.02 : 1.185, obj.open ? -0.12 : 0)
      lid.rotation.z = obj.open ? -0.15 : 0
      contents.visible = powderMass(obj) > 0.00001
    },
  }
}

export function instrument(f: Forms, parent: Container3D, id: ObjectId): Instrument {
  const root = group(parent)
  if (id === 'work') return { root, radius: 0.47, height: 0 }
  if (id === 'jarA' || id === 'jarB' || id === 'jarC')
    return jar(f, root, id === 'jarA' ? 'a' : id === 'jarB' ? 'b' : 'c')
  if (isFoil(id)) {
    const accents = { foil: 0xa94926, foilB: 0x234e9f, foilC: 0xb18a2d, foil2: 0x526877 }
    const paper = group(root)
    const fold = foilSheet(f, paper, accents[id])
    const dust = powder(f, paper, -0.32, 0.15, 0, 0.22)
    let finishedAt = 0
    return {
      root,
      radius: 0.64,
      height: 0.15,
      update(obj, _mass, mixed) {
        fold(obj.foldCount + obj.foldProgress)
        // Once the last crease is pressed, align the packet's centroid with the
        // pickup point and pan center. The guides stay fixed during both strokes.
        const now = performance.now()
        if (!obj.folded) finishedAt = 0
        else if (!finishedAt) finishedAt = now
        paper.position.x = finishedAt ? 0.32 * Math.min(1, (now - finishedAt) / 220) : 0
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
      update(obj, mass) {
        opening += (Number(obj.open) - opening) * 0.16
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
      radius: 0.72,
      height: 0.75,
      update(obj, _mass, mixed) {
        dust(obj, mixed)
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
    return {
      root,
      grip,
      tip,
      radius: 0.56,
      height: 0.16,
      update(obj, _mass, mixed, held, depth, lift) {
        pose(held, depth, lift)
        dust(obj, mixed)
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
      radius: 0.28,
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

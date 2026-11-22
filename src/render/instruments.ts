import { Container3D, Geometry3D, type Mesh3D } from '@pixi/3d'
import type { ObjectId, TableObject } from '../contract'
import { Forms, group } from './forms'

const WHITE = 0xe1e5cf,
  METAL = 0xa5b8b5,
  CHARCOAL = 0x304541
const POWDER_A = 0xffdc80,
  POWDER_B = 0xa6d7dd

export interface Instrument {
  root: Container3D
  radius: number
  height: number
  update?: (obj: TableObject, mass: number, mixed: number) => void
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
    const weight = obj.a + obj.b
    holder.visible = weight > 0.00001
    if (!holder.visible) return
    const fraction = obj.b / weight
    const amount = Math.min(1, 0.26 + Math.cbrt(weight) * 0.46)
    holder.scale.set(amount, 0.32 + amount * 0.68, amount)
    lump.material = f.material(fraction > 0.96 ? POWDER_B : POWDER_A)
    second.visible = fraction > 0.02 && fraction < 0.96
    second.scale.x = radius * Math.sqrt(fraction) * (1 - 0.006 * mixed)
    granules.forEach((grain, i) => {
      grain.material = f.material(i / 9 < fraction ? POWDER_B : POWDER_A)
    })
  }
}

function bottleLabel(f: Forms, letter: string, color: string) {
  return f.decal(256, 150, (c) => {
    c.fillStyle = '#eeeddb'
    c.fillRect(0, 0, 256, 150)
    c.fillStyle = color
    c.fillRect(0, 0, 26, 150)
    c.fillStyle = '#243a35'
    c.font = 'bold 91px Helvetica,Arial,sans-serif'
    c.fillText(letter, 37, 103)
    c.fillStyle = color
    c.fillRect(40, 116, 97, 8)
    c.fillStyle = '#445751'
    c.font = 'bold 15px monospace'
    c.fillText('REAGENT', 123, 62)
    c.fillRect(124, 77, 90, 4)
    c.fillRect(124, 87, 62, 4)
    for (let i = 0; i < 22; i++) c.fillRect(125 + i * 3.6, 104, 1 + (i % 3), 16)
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

function jar(f: Forms, root: Container3D, a: boolean): Instrument {
  const glass = f.material(a ? 0xbd773e : 0x497e81, 0.3)
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
  f.disc(root, 0x35413b, 0, 1.078, 0, 0.3, 0.035)
  const contents = f.disc(root, a ? POWDER_A : POWDER_B, 0, 1.107, 0, 0.282, 0.021)
  f.mesh(
    root,
    wrap(f, 0.494, 0.53, 2.66),
    bottleLabel(f, a ? 'A' : 'B', a ? '#c38a45' : '#5c9a9d'),
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
    a ? 0xaf683a : 0x44747a,
  )
  f.disc(lid, a ? 0xd59d62 : 0x80aaa7, 0, 0.222, 0, 0.338, 0.018)
  for (let i = 0; i < 24; i++) {
    const t = (i * Math.PI) / 12
    const rib = f.box(
      lid,
      a ? 0xc3834b : 0x638d8e,
      0.393 * Math.sin(t),
      0.113,
      0.393 * Math.cos(t),
      0.032,
      0.15,
      0.015,
    )
    rib.rotation.y = t
  }
  return {
    root,
    radius: 0.51,
    height: 1.45,
    update(obj) {
      lid.position.set(obj.open ? 0.67 : 0, obj.open ? 0.02 : 1.185, obj.open ? -0.12 : 0)
      lid.rotation.z = obj.open ? -0.15 : 0
      contents.visible = obj.a + obj.b > 0.00001
    },
  }
}

function sheetGeometry(f: Forms, folded: boolean) {
  const pos: number[] = [],
    normals: number[] = []
  function point(i: number, j: number): [number, number, number] {
    const x = (i / 6) * 2 - 1,
      z = (j / 5) * 2 - 1
    const edge = Math.max(Math.abs(x), Math.abs(z))
    const ripple = Math.sin(i * 2.32 + j * 1.59) * 0.028 + Math.cos(i * 3.63 - j) * 0.023
    return [
      x * (folded ? 0.43 : 0.7) + ripple * 0.24,
      0.028 + (folded ? 0.38 * x * x : 0.1 * edge ** 4) + ripple * (0.2 + 0.8 * edge),
      z * 0.44 + ripple * 0.22,
    ]
  }
  function tri(a: number[], b: number[], c: number[]) {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2],
      ex = c[0] - a[0],
      ey = c[1] - a[1],
      ez = c[2] - a[2]
    const nx = dy * ez - dz * ey,
      ny = dz * ex - dx * ez,
      nz = dx * ey - dy * ex,
      n = Math.hypot(nx, ny, nz)
    pos.push(...a, ...b, ...c)
    for (let k = 0; k < 3; k++) normals.push(nx / n, ny / n, nz / n)
  }
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 5; j++) {
      const a = point(i, j),
        b = point(i + 1, j),
        c = point(i, j + 1),
        d = point(i + 1, j + 1)
      tri(a, c, b)
      tri(b, c, d)
    }
  return f.geometry(
    new Geometry3D({ positions: Float32Array.from(pos), normals: Float32Array.from(normals) }),
  )
}

export function instrument(f: Forms, parent: Container3D, id: ObjectId): Instrument {
  const root = group(parent)
  if (id === 'jarA' || id === 'jarB') return jar(f, root, id === 'jarA')
  if (id === 'foil' || id === 'foil2') {
    const paper = group(root)
    paper.rotation.y = id === 'foil' ? -0.13 : 0.19
    const mat = f.material(id === 'foil' ? 0xd8e1db : 0xbacfd0, 0.8)
    const flat = f.mesh(paper, sheetGeometry(f, false), mat)
    const folded = f.mesh(paper, sheetGeometry(f, true), mat)
    const dust = powder(f, paper, 0, 0.055, 0, 0.37)
    return {
      root,
      radius: 0.66,
      height: 0.16,
      update(obj, _mass, mixed) {
        flat.visible = !obj.folded
        folded.visible = obj.folded
        dust(obj, mixed)
      },
    }
  }
  if (id === 'scale') {
    f.box(root, CHARCOAL, 0, 0.075, 0, 1.55, 0.12, 1.37)
    f.box(root, 0xb5c9c1, 0, 0.165, 0, 1.59, 0.16, 1.4)
    f.box(root, 0xe0e7d9, 0, 0.268, -0.025, 1.55, 0.12, 1.32)
    f.disc(root, 0x667e7a, 0, 0.375, -0.165, 0.565, 0.104)
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
    let ctx: CanvasRenderingContext2D | undefined
    let previous = ''
    const readout = f.decal(384, 88, (c) => {
      ctx = c
    })
    const face = f.panel(root, readout, -0.13, 0.358, 0.462, 0.81, 0.23)
    face.rotation.x = -Math.PI / 2
    for (let i = 0; i < 2; i++)
      f.disc(root, i === 0 ? 0x71a99a : 0x90a8a1, 0.42 + i * 0.18, 0.34, 0.465, 0.062, 0.034)
    return {
      root,
      radius: 0.8,
      height: 0.5,
      update(_obj, mass) {
        const value = mass.toFixed(3) + ' g'
        if (value === previous || !ctx) return
        previous = value
        ctx.fillStyle = '#213e3c'
        ctx.fillRect(0, 0, 384, 88)
        ctx.fillStyle = '#beffb7'
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
    tool.rotation.set(1.43, 0, id === 'pestle' ? -0.75 : 0.83)
    if (id === 'pestle') {
      tool.position.set(-0.45, 0.13, -0.34)
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
      return { root, radius: 0.57, height: 0.24 }
    }
    tool.position.set(0.42, 0.09, -0.4)
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
      f.material(0x849c96, 0.5),
    )
    f.oval(tool, f.material(0xdbe4d8, 0.72), 0, 1.16, 0, 0.114, 0.215, 0.045)
    const dust = powder(f, tool, 0, 1.15, -0.047, 0.1)
    return {
      root,
      radius: 0.56,
      height: 0.16,
      update(obj, _mass, mixed) {
        dust(obj, mixed)
      },
    }
  }
  if (id === 'vial') {
    const wall = f.ink(0xb8dada, 0.32)
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
    f.disc(root, 0x779d99, 0, 0.035, 0, 0.242, 0.068)
    f.mesh(root, wrap(f, 0.262, 0.21, 2.4), f.ink(0xeee8d5), 0, 0.36, 0)
    f.mesh(root, f.ring, 0xb2c6ba, 0, 0.748, 0, 0.209)
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
  f.disc(root, 0x78908a, 0, 0.159, 0, 0.205, 0.009)
  return { root, radius: 0.26, height: 0.16 }
}

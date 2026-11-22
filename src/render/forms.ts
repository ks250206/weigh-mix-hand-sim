import {
  Container3D, CubeGeometry, CylinderGeometry, FlatMaterial, Geometry3D, Mesh3D,
  PhongMaterial, PlaneGeometry, SphereGeometry, TorusGeometry,
  type BaseMaterial3D,
} from '@pixi/3d'
import { Texture } from 'pixi.js'

export type Point3 = { x: number; y: number; z: number }
export type Paint = number | BaseMaterial3D
export type Section = readonly [radius: number, height: number]

export function group(parent: Container3D) {
  const child = new Container3D()
  parent.addChild(child)
  return child
}

// A turned profile runs from the underside around the outside and back into the mouth.
// Splitting the bands gives creases at the lip, shoulder and foot, smooth around the circumference.
function turned(profile: readonly Section[], sides: number) {
  const positions: number[] = [], normals: number[] = [], indices: number[] = []
  for (let row = 1; row < profile.length; row++) {
    const [r0, h0] = profile[row - 1], [r1, h1] = profile[row]
    const dr = r1 - r0, dh = h1 - h0, length = Math.hypot(dr, dh) || 1
    const start = positions.length / 3
    for (let i = 0; i <= sides; i++) {
      const a = 2 * Math.PI * i / sides, x = Math.cos(a), z = Math.sin(a)
      positions.push(r0 * x, h0, r0 * z, r1 * x, h1, r1 * z)
      for (let j = 0; j < 2; j++) normals.push(dh * x / length, -dr / length, dh * z / length)
      const k = start + i * 2
      if (i < sides) indices.push(k, k + 1, k + 2, k + 2, k + 1, k + 3)
    }
  }
  return new Geometry3D({ positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint16Array.from(indices) })
}

export class Forms {
  readonly block = new CubeGeometry()
  readonly ball = new SphereGeometry({ radius: 1, widthSegments: 18, heightSegments: 12 })
  readonly cylinder = new CylinderGeometry({ radiusTop: 1, radiusBottom: 1, height: 1, radialSegments: 36 })
  readonly ring = new TorusGeometry({ radius: 1, tube: .055, radialSegments: 8, tubularSegments: 48 })
  readonly plane = new PlaneGeometry({ flipV: true })
  private geometries = new Set<Geometry3D>([this.block, this.ball, this.cylinder, this.ring, this.plane])
  private paints = new Map<string, BaseMaterial3D>()
  private textures: Texture[] = []
  private decals: BaseMaterial3D[] = []

  material(color: number, sheen = .15) {
    const key = color + '/' + sheen
    let mat = this.paints.get(key)
    if (!mat) {
      mat = new PhongMaterial({ baseColor: color, specularStrength: sheen, specularColor: 0xc2d6d1, shininess: 39, doubleSided: true })
      this.paints.set(key, mat)
    }
    return mat
  }

  ink(color: number, alpha = 1) {
    const key = 'ink/' + color + '/' + alpha
    let mat = this.paints.get(key)
    if (!mat) {
      mat = new FlatMaterial({ baseColor: color, doubleSided: true, alpha, alphaMode: alpha < 1 ? 'blend' : 'opaque' })
      this.paints.set(key, mat)
    }
    return mat
  }

  profile(sections: readonly Section[], sides = 40) {
    return this.geometry(turned(sections, sides))
  }

  geometry(g: Geometry3D) { this.geometries.add(g); return g }

  decal(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    draw(ctx)
    const tex = Texture.from(canvas)
    const mat = new FlatMaterial({ baseColorTexture: tex, doubleSided: true, alphaMode: 'blend' })
    this.textures.push(tex)
    this.decals.push(mat)
    return mat
  }

  mesh(parent: Container3D, shape: Geometry3D, paint: Paint, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) {
    const mesh = new Mesh3D({ geometry: shape, material: typeof paint === 'number' ? this.material(paint) : paint })
    mesh.position.set(x, y, z)
    mesh.scale.set(sx, sy, sz)
    parent.addChild(mesh)
    return mesh
  }

  box(parent: Container3D, paint: Paint, x: number, y: number, z: number, w: number, h: number, d: number) {
    return this.mesh(parent, this.block, paint, x, y, z, w, h, d)
  }

  oval(parent: Container3D, paint: Paint, x: number, y: number, z: number, rx: number, ry: number, rz: number) {
    return this.mesh(parent, this.ball, paint, x, y, z, rx, ry, rz)
  }

  disc(parent: Container3D, paint: Paint, x: number, y: number, z: number, radius: number, h: number) {
    return this.mesh(parent, this.cylinder, paint, x, y, z, radius, h, radius)
  }

  panel(parent: Container3D, paint: Paint, x: number, y: number, z: number, w: number, h: number) {
    return this.mesh(parent, this.plane, paint, x, y, z, w, h, 1)
  }

  destroy() {
    for (const mat of [...this.paints.values(), ...this.decals]) mat.destroy()
    for (const shape of this.geometries) shape.destroy()
    for (const tex of this.textures) tex.destroy(true)
  }
}

// Maps the local +Y of a cylindrical or ellipsoidal mesh to the segment.
export function segment(node: Mesh3D, from: Point3, to: Point3, rx: number, rz: number, half = false) {
  const x = to.x - from.x, y = to.y - from.y, z = to.z - from.z
  const len = Math.max(.0001, Math.hypot(x, y, z))
  node.position.set(from.x + x / 2, from.y + y / 2, from.z + z / 2)
  node.rotation.set(Math.atan2(z, y), 0, -Math.asin(Math.max(-1, Math.min(1, x / len))))
  node.scale.set(rx, half ? len / 2 : len, rz)
}

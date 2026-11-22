import { Box, Geometry3D, type Container3D } from '@pixi/3d'
import { Forms, type Paint, type Point3 } from './forms'
import { inwardNormal } from './chamber'

// Rings follow a cubic from the port's inward normal to the wrist. A single continuous
// surface keeps the folds joined as the hand stretches or turns across the bench.
export function sleeve(f: Forms, parent: Container3D, paint: Paint, port: Point3) {
  const rows = 33,
    sides = 24
  const positions = new Float32Array(rows * sides * 3),
    normals = new Float32Array(positions.length)
  const indices: number[] = []
  for (let i = 0; i < rows - 1; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j,
        b = i * sides + ((j + 1) % sides)
      indices.push(a, b, a + sides, b, b + sides, a + sides)
    }
  const geometry = f.geometry(
    new Geometry3D({
      positions,
      normals,
      indices: Uint16Array.from(indices),
      quantizeNormals: false,
      dynamic: true,
      bounds3D: Box.fromCenterSize({ x: 0, y: 1, z: 0 }, { x: 16, y: 4, z: 12 }),
    }),
  )
  f.mesh(parent, geometry, paint)
  const sin = Array.from({ length: sides }, (_, i) => Math.sin((i / sides) * Math.PI * 2))
  const cos = Array.from({ length: sides }, (_, i) => Math.cos((i / sides) * Math.PI * 2))
  return (wrist: Point3, yaw: number, tangent?: Point3) => {
    const length = Math.hypot(wrist.x - port.x, wrist.z - port.z)
    const bend = Math.min(0.92, length * 0.4)
    const neck = Math.max(0.55, bend)
    const ax = port.x,
      ay = port.y + inwardNormal.y * neck,
      az = port.z + inwardNormal.z * neck
    const bx = wrist.x + (tangent?.x ?? Math.sin(yaw)) * bend * 0.72,
      by = wrist.y + (tangent ? tangent.y * bend * 0.72 : 0.05),
      bz = wrist.z + (tangent?.z ?? Math.cos(yaw)) * bend * 0.72
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1),
        u = 1 - t
      const x = u ** 3 * port.x + 3 * u * u * t * ax + 3 * u * t * t * bx + t ** 3 * wrist.x
      const y = u ** 3 * port.y + 3 * u * u * t * ay + 3 * u * t * t * by + t ** 3 * wrist.y
      const z = u ** 3 * port.z + 3 * u * u * t * az + 3 * u * t * t * bz + t ** 3 * wrist.z
      let dx = u * u * (ax - port.x) + 2 * u * t * (bx - ax) + t * t * (wrist.x - bx)
      let dy = u * u * (ay - port.y) + 2 * u * t * (by - ay) + t * t * (wrist.y - by)
      let dz = u * u * (az - port.z) + 2 * u * t * (bz - az) + t * t * (wrist.z - bz)
      const speed = 3 * Math.hypot(dx, dy, dz) || 1
      dx *= 3 / speed
      dy *= 3 / speed
      dz *= 3 / speed
      const horizontal = Math.hypot(dx, dz) || 1,
        ux = -dz / horizontal,
        uz = dx / horizontal
      const vx = dy * uz,
        vy = dz * ux - dx * uz,
        vz = -dy * ux
      const phase = t * Math.PI * 10,
        depth = 0.045 * (1 - 0.65 * t)
      const wristRadius = tangent ? 0.177 : 0.205
      const radius = wristRadius + (0.48 - wristRadius) * u ** 1.3 + depth * Math.sin(phase)
      const slope =
        (-1.3 * (0.48 - wristRadius) * u ** 0.3 - 0.02925 * Math.sin(phase) + depth * Math.PI * 10 * Math.cos(phase)) / speed
      const inv = 1 / Math.hypot(1, slope)
      for (let j = 0; j < sides; j++) {
        const nx = ux * cos[j] + vx * sin[j],
          ny = vy * sin[j],
          nz = uz * cos[j] + vz * sin[j]
        const k = (i * sides + j) * 3
        positions[k] = x + radius * nx
        positions[k + 1] = y + radius * ny
        positions[k + 2] = z + radius * nz
        normals[k] = (nx - slope * dx) * inv
        normals[k + 1] = (ny - slope * dy) * inv
        normals[k + 2] = (nz - slope * dz) * inv
      }
    }
    geometry.attributes.aPosition.buffer.update()
    geometry.attributes.aNormal.buffer.update()
  }
}

import { Geometry3D, type Container3D } from '@pixi/3d'
import { workArea } from '../contract'
import { Forms, group } from './forms'

export const TABLE_WIDTH = 12
export const TABLE_DEPTH = 6.5
export const ANCHOR_HEIGHT = 0.38
export const worldX = (x: number) => (x - 0.5) * TABLE_WIDTH
export const worldZ = (y: number) => (y - 0.5) * TABLE_DEPTH

// Local X/Y span the observation glass. Its top leans into the enclosure.
const windowTilt = -0.38
const windowBase = { y: -0.22, z: 4.42 }
const portSpacing = 3.76
const portHeight = 1.12
const aperture = 0.485
export const inwardNormal = { x: 0, y: Math.sin(windowTilt), z: -Math.cos(windowTilt) }
export function glovePort(side: -1 | 1) {
  return {
    x: side * portSpacing,
    y: windowBase.y + portHeight * Math.cos(windowTilt),
    z: windowBase.z + portHeight * Math.sin(windowTilt),
  }
}

// Each half pane is meshed from the circular opening to the rectangle around it.
// Sampling the four rectangle edges explicitly preserves the corners at the sill.
function glazing(f: Forms, side: -1 | 1) {
  const vertices: number[] = [], indices: number[] = []
  const center = side * portSpacing
  const lo = side < 0 ? -6.78 : 0, hi = side < 0 ? 0 : 6.78
  const corners = [[lo, 0], [hi, 0], [hi, 4.6], [lo, 4.6]]
  for (let edge = 0; edge < 4; edge++) {
    const [ax, ay] = corners[edge], [bx, by] = corners[(edge + 1) % 4]
    const start = Math.atan2(ay - portHeight, ax - center)
    let span = Math.atan2(by - portHeight, bx - center) - start
    if (span < 0) span += 2 * Math.PI
    for (let i = 0; i <= 16; i++) {
      const angle = start + span * i / 16, dx = Math.cos(angle), dy = Math.sin(angle)
      const length = ax === bx ? (ax - center) / dx : (ay - portHeight) / dy
      const k = vertices.length / 3
      vertices.push(center + aperture * dx, portHeight + aperture * dy, 0, center + length * dx, portHeight + length * dy, 0)
      if (i < 16) indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  return f.geometry(new Geometry3D({ positions: Float32Array.from(vertices), indices: Uint16Array.from(indices) }))
}

function frontWindow(f: Forms, root: Container3D) {
  const pane = group(root)
  pane.position.set(0, windowBase.y, windowBase.z)
  pane.rotation.x = windowTilt
  f.box(pane, 0x253b67, 0, -0.01, 0, 13.68, 0.48, 0.25)
  f.box(pane, 0xb7c7d5, 0, 0.285, 0, 13.56, 0.12, 0.19)
  f.box(pane, 0x63788e, 0, 0.36, 0, 13.56, 0.03, 0.12)
  const flange = f.profile([
    [aperture, -0.08], [0.68, -0.08], [0.716, -0.045], [0.716, 0.05],
    [0.691, 0.083], [aperture, 0.083], [aperture, -0.08],
  ], 64)
  const lip = f.profile([[0.46, 0.05], [0.52, 0.05], [0.535, 0.078],
    [0.515, 0.105], [0.46, 0.105], [0.46, 0.05]], 64)
  for (const side of [-1, 1] as const) {
    f.mesh(pane, glazing(f, side), f.ink(0xc8e8f7, 0.055))
    f.box(pane, 0x4f6689, side * 6.76, 2.30, 0, 0.10, 4.6, 0.14)
    const mount = group(pane)
    mount.position.set(side * portSpacing, portHeight, 0)
    mount.rotation.x = Math.PI / 2
    f.mesh(mount, flange, f.material(0x9eafc1, 0.55))
    f.mesh(mount, lip, f.material(0x263341, 0.22))
    for (let i = 0; i < 10; i++) {
      const angle = (i * 2 * Math.PI) / 10
      const x = 0.621 * Math.cos(angle), z = 0.621 * Math.sin(angle)
      f.disc(mount, 0x46576b, x, 0.091, z, 0.034, 0.025)
    }
  }
}

function deckSurface(f: Forms) {
  return f.decal(1536, 860, (c) => {
    const gradient = c.createLinearGradient(30, 0, 1000, 1000)
    gradient.addColorStop(0, '#a6b7ce')
    gradient.addColorStop(0.35, '#f1f5f9')
    gradient.addColorStop(0.72, '#d9e2ed')
    gradient.addColorStop(1, '#b4c1d1')
    c.fillStyle = gradient
    c.fillRect(0, 0, 1536, 860)
    // The glazing of brushed stainless sheet has a fine, directional grain.
    for (let i = 0; i < 860; i++) {
      c.fillStyle = 'rgba(251,253,255,' + (0.016 + 0.028 * Math.sin(i * 99.4) ** 2) + ')'
      c.fillRect(0, i, 1536, 1)
    }
    c.strokeStyle = '#637e9c38'
    c.lineWidth = 1
    c.beginPath()
    for (let x = 48; x < 1536; x += 48) {
      c.moveTo(x, 0)
      c.lineTo(x, 860)
    }
    for (let y = 46; y < 860; y += 48) {
      c.moveTo(0, y)
      c.lineTo(1536, y)
    }
    c.stroke()
    c.strokeStyle = '#38527480'
    c.lineWidth = 2
    c.strokeRect(23, 23, 1490, 814)
    c.beginPath()
    for (let x = 48; x < 1500; x += 12) {
      const h = x % 48 === 0 ? 11 : 4
      c.moveTo(x, 26)
      c.lineTo(x, 26 + h)
      c.moveTo(x, 835)
      c.lineTo(x, 835 - h)
    }
    for (const x of [72, 384, 768, 1152, 1464])
      for (const y of [72, 432, 788]) {
        c.moveTo(x - 7, y)
        c.lineTo(x + 7, y)
        c.moveTo(x, y - 7)
        c.lineTo(x, y + 7)
      }
    c.stroke()
  })
}

function wallPanel(f: Forms) {
  return f.decal(1536, 348, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 348)
    g.addColorStop(0, '#adbed4')
    g.addColorStop(0.3, '#f8fbff')
    g.addColorStop(0.76, '#dce5f0')
    g.addColorStop(1, '#9dacc0')
    c.fillStyle = g
    c.fillRect(0, 0, 1536, 348)
    for (let x = 12; x < 1536; x += 304) {
      c.strokeStyle = '#8699af'
      c.lineWidth = 3
      c.strokeRect(x, 12, 290, 316)
      c.strokeStyle = '#ffffffdd'
      c.lineWidth = 1
      c.strokeRect(x + 2, 14, 287, 312)
      for (const xx of [x + 13, x + 278])
        for (const y of [27, 310]) {
          c.fillStyle = '#e9f0f6'
          c.beginPath()
          c.arc(xx, y, 4, 0, Math.PI * 2)
          c.fill()
          c.fillStyle = '#53647b'
          c.fillRect(xx - 2.5, y - 1, 5, 2)
        }
    }
    // The enamel stripe crosses the service panels, with a break at each joint.
    for (let x = 12; x < 1536; x += 304) {
      c.fillStyle = '#1643b9'
      c.fillRect(x, 229, 290, 34)
      c.fillStyle = '#4979ed'
      c.fillRect(x, 263, 290, 4)
    }
  })
}

function gauge(f: Forms, parent: Container3D, x: number, angle: number) {
  const p = group(parent)
  p.position.set(x, 1.56, -3.82)
  const rim = f.disc(p, 0x45526d, 0, 0, 0, 0.255, 0.13)
  rim.rotation.x = Math.PI / 2
  const face = f.decal(128, 128, (c) => {
    c.fillStyle = '#f9fbff'
    c.beginPath()
    c.arc(64, 64, 61, 0, Math.PI * 2)
    c.fill()
    for (let i = 0; i < 11; i++) {
      const a = Math.PI * (0.8 + i * 0.14)
      c.strokeStyle = i > 7 ? '#de6b26' : '#334568'
      c.lineWidth = i % 2 === 0 ? 4 : 2
      c.beginPath()
      c.moveTo(64 + Math.cos(a) * 43, 64 + Math.sin(a) * 43)
      c.lineTo(64 + Math.cos(a) * 51, 64 + Math.sin(a) * 51)
      c.stroke()
    }
    c.strokeStyle = '#e74925'
    c.lineWidth = 5
    c.beginPath()
    c.moveTo(64, 64)
    c.lineTo(64 + 39 * Math.cos(angle), 64 + 39 * Math.sin(angle))
    c.stroke()
    c.fillStyle = '#1b304e'
    c.beginPath()
    c.arc(64, 64, 6, 0, Math.PI * 2)
    c.fill()
  })
  f.panel(p, face, 0, 0, 0.07, 0.455, 0.455)
}

export function chamber(f: Forms, root: Container3D) {
  const steel = 0x8192a9,
    shadowSteel = 0x283e60,
    trim = 0xc0cfde
  f.box(root, shadowSteel, 0, -0.27, 0, 13.65, 0.52, 7.75)
  f.panel(root, deckSurface(f), 0, 0.002, 0, 13.45, 7.62).rotation.x = -Math.PI / 2
  f.box(root, steel, 0, 1.48, -3.97, 13.65, 3.1, 0.21)
  f.panel(root, wallPanel(f), 0, 1.45, -3.858, 13.45, 3.05)
  for (const sign of [-1, 1]) {
    f.box(root, steel, sign * 6.78, 0.85, -0.02, 0.18, 1.8, 7.75)
    f.box(root, f.ink(0x1b46bc), sign * 6.68, 0.64, -0.02, 0.032, 0.22, 7.73)
    f.box(root, trim, sign * 6.76, 1.79, -0.02, 0.2, 0.06, 7.8)
    f.box(root, shadowSteel, sign * 6.66, 0.09, -0.02, 0.08, 0.17, 7.6)
    f.box(root, 0x213fb3, sign * 6.66, 1.43, -3.79, 0.17, 2.86, 0.2)
  }
  f.box(root, shadowSteel, 0, 0.09, -3.73, 13.4, 0.16, 0.23)
  f.box(root, trim, 0, 0.21, -3.8, 13.33, 0.065, 0.08)
  const matWidth = (workArea.right - workArea.left) * TABLE_WIDTH
  const matDepth = (workArea.front - workArea.back) * TABLE_DEPTH
  const mat = f.decal(900, 380, (c) => {
    c.fillStyle = '#b5c9e5'
    c.fillRect(0, 0, 900, 380)
    c.strokeStyle = '#738fb9'
    c.lineWidth = 3
    c.strokeRect(6, 6, 888, 368)
    c.fillStyle = '#7892b1'
    for (let x = 45; x < 890; x += 27)
      for (let y = 70; y < 350; y += 27) c.fillRect(x, y, 2, 2)
    c.strokeStyle = '#1945aa'
    c.lineWidth = 6
    for (const x of [22, 878])
      for (const y of [22, 358]) {
        c.beginPath()
        c.moveTo(x + (x < 450 ? 32 : -32), y)
        c.lineTo(x, y)
        c.lineTo(x, y + (y < 190 ? 28 : -28))
        c.stroke()
      }
    c.fillStyle = '#2a497d'
    c.font = 'bold 21px monospace'
    c.fillText('PREP AREA', 44, 50)
  })
  f.panel(
    root,
    mat,
    worldX((workArea.left + workArea.right) / 2),
    0.006,
    worldZ((workArea.back + workArea.front) / 2),
    matWidth,
    matDepth,
  ).rotation.x = -Math.PI / 2
  // Rear service panel, pressure gauges and the linear inspection lamp.
  f.box(root, shadowSteel, -0.1, 2.38, -3.77, 7.8, 0.18, 0.25)
  f.box(root, f.ink(0xf9ffff), -0.1, 2.32, -3.615, 7.42, 0.074, 0.07)
  f.box(root, 0xa5b4c7, -4.91, 1.42, -3.77, 2.08, 1.17, 0.12)
  f.box(root, shadowSteel, -4.91, 1.42, -3.685, 1.84, 0.94, 0.06)
  for (let i = 0; i < 7; i++) f.box(root, 0x93a3ba, -4.91, 1.04 + i * 0.123, -3.62, 1.7, 0.055, 0.105)
  for (const x of [3.57, 4.18]) gauge(f, root, x, x === 3.57 ? -1.92 : -1.12)
  for (const x of [3.57, 4.18]) {
    f.box(root, 0x8798ad, x, 0.85, -3.76, 0.085, 0.92, 0.1)
    f.box(root, 0xad8558, x, 1.15, -3.72, 0.18, 0.13, 0.15)
  }
  const pilot = f.oval(root, f.ink(0x4bf1af), 5.32, 1.61, -3.72, 0.075, 0.075, 0.043)
  f.box(root, shadowSteel, 5.81, 1.61, -3.78, 0.69, 0.165, 0.07)
  const gasPlate = f.decal(192, 54, (c) => {
    c.fillStyle = '#203956'
    c.fillRect(0, 0, 192, 54)
    c.fillStyle = '#f5fbff'
    c.font = 'bold 32px monospace'
    c.fillText('Ar', 9, 38)
    c.font = 'bold 17px monospace'
    c.fillText('ARGON', 72, 33)
  })
  f.panel(root, gasPlate, 5.81, 1.61, -3.728, 0.68, 0.18)
  frontWindow(f, root)
  return pilot
}

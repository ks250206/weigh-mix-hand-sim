import type { Container3D } from '@pixi/3d'
import { workArea } from '../contract'
import { Forms, group } from './forms'

export const TABLE_WIDTH = 12
export const TABLE_DEPTH = 6.5
export const ANCHOR_HEIGHT = 0.38
export const worldX = (x: number) => (x - 0.5) * TABLE_WIDTH
export const worldZ = (y: number) => (y - 0.5) * TABLE_DEPTH

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
  // Front retaining sill and the two sealed entry ports frame the observation window.
  f.box(root, 0x213fb3, 0, -0.25, 3.89, 13.66, 0.53, 0.23)
  f.box(root, f.ink(0x244ec5), 0, -0.18, 4.012, 13.58, 0.22, 0.016)
  f.box(root, 0xc3cfdf, 0, 0.04, 3.85, 13.58, 0.07, 0.2)
  for (const side of [-1, 1]) {
    const port = group(root)
    port.position.set(side * 3.76, 0.14, 3.75)
    port.rotation.x = -0.2
    f.disc(port, 0x526684, 0, 0, 0, 0.73, 0.19)
    f.disc(port, 0xb7c6db, 0, 0.105, 0, 0.66, 0.06)
    f.disc(port, 0x25314a, 0, 0.149, 0, 0.555, 0.058)
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4
      f.disc(port, 0x415476, Math.sin(a) * 0.608, 0.148, Math.cos(a) * 0.608, 0.035, 0.025)
    }
  }
  return pilot
}

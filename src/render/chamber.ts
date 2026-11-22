import type { Container3D } from '@pixi/3d'
import { Forms, group } from './forms'

export const TABLE_WIDTH = 12
export const TABLE_DEPTH = 6.5
export const ANCHOR_HEIGHT = .38
export const worldX = (x: number) => (x - .5) * TABLE_WIDTH
export const worldZ = (y: number) => (y - .5) * TABLE_DEPTH

function deckSurface(f: Forms) {
  return f.decal(1536, 860, c => {
    const gradient = c.createLinearGradient(30, 0, 1000, 1000)
    gradient.addColorStop(0, '#93acaa')
    gradient.addColorStop(.35, '#c5d6cd')
    gradient.addColorStop(.72, '#b4c8be')
    gradient.addColorStop(1, '#93aaa1')
    c.fillStyle = gradient; c.fillRect(0, 0, 1536, 860)
    // The glazing of brushed stainless sheet has a fine, directional grain.
    for (let i = 0; i < 860; i++) {
      c.fillStyle = 'rgba(243,253,239,' + (.016 + .028 * Math.sin(i * 99.4) ** 2) + ')'
      c.fillRect(0, i, 1536, 1)
    }
    c.strokeStyle = '#6e8c8545'; c.lineWidth = 1
    c.beginPath()
    for (let x = 48; x < 1536; x += 48) { c.moveTo(x, 0); c.lineTo(x, 860) }
    for (let y = 46; y < 860; y += 48) { c.moveTo(0, y); c.lineTo(1536, y) }
    c.stroke()
    c.strokeStyle = '#486d6366'; c.lineWidth = 2
    c.strokeRect(23, 23, 1490, 814)
    c.beginPath()
    for (let x = 48; x < 1500; x += 12) {
      const h = x % 48 === 0 ? 11 : 4
      c.moveTo(x, 26); c.lineTo(x, 26 + h)
      c.moveTo(x, 835); c.lineTo(x, 835 - h)
    }
    for (const x of [72, 384, 768, 1152, 1464]) for (const y of [72, 432, 788]) {
      c.moveTo(x - 7, y); c.lineTo(x + 7, y); c.moveTo(x, y - 7); c.lineTo(x, y + 7)
    }
    c.stroke()
  })
}

function wallPanel(f: Forms) {
  return f.decal(1536, 348, c => {
    const g = c.createLinearGradient(0, 0, 0, 348)
    g.addColorStop(0, '#3c6369'); g.addColorStop(.3, '#719397')
    g.addColorStop(.76, '#88a5a3'); g.addColorStop(1, '#4c7073')
    c.fillStyle = g; c.fillRect(0, 0, 1536, 348)
    for (let x = 12; x < 1536; x += 304) {
      c.strokeStyle='#54797c'; c.lineWidth=3; c.strokeRect(x, 12, 290, 316)
      c.strokeStyle='#b0c6bc80'; c.lineWidth=1; c.strokeRect(x + 2, 14, 287, 312)
      for (const xx of [x + 13, x + 278]) for (const y of [27,310]) {
        c.fillStyle = '#b5c6ba'; c.beginPath(); c.arc(xx, y, 4, 0, Math.PI*2); c.fill()
        c.fillStyle = '#4b6566'; c.fillRect(xx-2.5, y-1, 5, 2)
      }
    }
  })
}

function gauge(f: Forms, parent: Container3D, x: number, angle: number) {
  const p = group(parent)
  p.position.set(x, 1.56, -3.82)
  const rim = f.disc(p, 0x4d6468, 0,0,0, .255,.13)
  rim.rotation.x = Math.PI / 2
  const face = f.decal(128,128,c => {
    c.fillStyle='#e6ebd9'; c.beginPath(); c.arc(64,64,61,0,Math.PI*2); c.fill()
    for (let i=0;i<11;i++) {
      const a = Math.PI * (.8 + i * .14)
      c.strokeStyle = i > 7 ? '#c58954' : '#4e6667'; c.lineWidth = i%2 === 0 ? 4 : 2
      c.beginPath(); c.moveTo(64+Math.cos(a)*43,64+Math.sin(a)*43); c.lineTo(64+Math.cos(a)*51,64+Math.sin(a)*51); c.stroke()
    }
    c.strokeStyle='#c46b43'; c.lineWidth=5
    c.beginPath(); c.moveTo(64,64); c.lineTo(64 + 39*Math.cos(angle),64 + 39*Math.sin(angle)); c.stroke()
    c.fillStyle='#3d5250'; c.beginPath(); c.arc(64,64,6,0,Math.PI*2); c.fill()
  })
  f.panel(p, face, 0,0,.07,.455,.455)
}

export function chamber(f: Forms, root: Container3D) {
  const steel = 0x607d80, shadowSteel = 0x355155, trim = 0xc1d0c4
  f.box(root, shadowSteel, 0,-.27,0, 13.65,.52,7.75)
  f.panel(root, deckSurface(f), 0,.002,0,13.45,7.62).rotation.x = -Math.PI / 2
  f.box(root, steel, 0,1.48,-3.97, 13.65,3.1,.21)
  f.panel(root, wallPanel(f), 0,1.45,-3.858, 13.45,3.05)
  for (const sign of [-1,1]) {
    f.box(root, steel, sign*6.78,.85,-.02,.18,1.8,7.75)
    f.box(root, trim, sign*6.76,1.79,-.02,.2,.06,7.8)
    f.box(root, shadowSteel, sign*6.66,.09,-.02,.08,.17,7.6)
    f.box(root, 0x748f90, sign*6.66,1.43,-3.79,.17,2.86,.2)
  }
  f.box(root, shadowSteel, 0,.09,-3.73,13.4,.16,.23)
  f.box(root, trim, 0,.21,-3.8,13.33,.065,.08)
  // Rear service panel, pressure gauges and the linear inspection lamp.
  f.box(root, shadowSteel, -.1,2.38,-3.77,7.8,.18,.25)
  f.box(root, f.ink(0xf0ffdf), -.1,2.32,-3.615,7.42,.074,.07)
  f.box(root, 0x89a3a0, -4.91,1.42,-3.77,2.08,1.17,.12)
  f.box(root, shadowSteel, -4.91,1.42,-3.685,1.84,.94,.06)
  for (let i=0;i<7;i++) f.box(root, 0x8aaba9,-4.91,1.04+i*.123,-3.62,1.7,.055,.105)
  for (const x of [3.57,4.18]) gauge(f,root,x,x===3.57 ? -1.92 : -1.12)
  for (const x of [3.57,4.18]) {
    f.box(root, 0x728c85,x,.85,-3.76,.085,.92,.1)
    f.box(root, 0xc59a66,x,1.15,-3.72,.18,.13,.15)
  }
  const pilot = f.oval(root,f.ink(0x99f4c6),5.32,1.61,-3.72,.075,.075,.043)
  f.box(root, shadowSteel,5.81,1.61,-3.78,.69,.165,.07)
  f.box(root, f.ink(0xc9dbbb),5.81,1.61,-3.728,.45,.045,.02)
  // Front retaining sill and the two sealed entry ports frame the observation window.
  f.box(root, 0x476469,0,-.25,3.89,13.66,.53,.23)
  f.box(root, 0xa9c1b6,0,.04,3.85,13.58,.07,.2)
  for (const side of [-1,1]) {
    const port = group(root)
    port.position.set(side * 3.76,.14,3.75)
    port.rotation.x = 1
    f.disc(port,0x50696b,0,0,0,.73,.19)
    f.disc(port,0xb3c4bb,0,.105,0,.66,.06)
    f.disc(port,0x2f464b,0,.149,0,.555,.058)
    for (let i=0;i<8;i++) {
      const a=i*Math.PI/4
      f.disc(port,0x617779,Math.sin(a)*.608,.148,Math.cos(a)*.608,.035,.025)
    }
  }
  return pilot
}

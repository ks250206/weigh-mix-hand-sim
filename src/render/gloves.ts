import { type Container3D } from '@pixi/3d'
import { Forms, group, type Point3 } from './forms'
import { sleeve } from './sleeve'
import type { WristPose } from './toolGrip'
import { ANCHOR_HEIGHT, glovePort } from './chamber'

export function glove(f: Forms, parent: Container3D, side: -1 | 1) {
  const cuff = glovePort(side)
  const rubber = f.material(0x1c2028, 0.22),
    fingerRubber = f.material(0xf4e1a2, 0.12)
  const updateSleeve = sleeve(f, parent, rubber, cuff)
  const hand = group(parent)
  f.oval(hand, fingerRubber, 0, 0.015, 0.66, 0.259, 0.144, 0.365)
  f.oval(hand, fingerRubber, -side * 0.085, 0.005, 0.51, 0.17, 0.132, 0.21)
  const finger = f.profile(
    [
      [0, 0],
      [0.66, 0],
      [0.9, 0.08],
      [1, 0.2],
      [0.94, 0.4],
      [0.89, 0.58],
      [0.88, 0.66],
      [0.76, 0.86],
      [0.6, 0.95],
      [0.3, 0.993],
      [0, 1],
    ],
    20,
  )
  const digits = [
    { x: -0.135, z: 0.48, dx: -0.026, l: 0.438, r: 0.076 },
    { x: -0.015, z: 0.414, dx: 0.005, l: 0.442, r: 0.078 },
    { x: 0.115, z: 0.45, dx: 0.035, l: 0.396, r: 0.072 },
    { x: 0.223, z: 0.516, dx: 0.055, l: 0.306, r: 0.063 },
  ].map((d) => {
    const node = group(hand)
    node.position.set(d.x * side, 0.003, d.z)
    node.rotation.y = -d.dx * side * 3
    const shape = f.mesh(node, finger, fingerRubber, 0, 0, 0, d.r, d.l, d.r * 0.88)
    return { node, shape }
  })
  const thumb = group(hand)
  thumb.position.set(-side * 0.16, -0.02, 0.68)
  thumb.rotation.y = side * 0.81
  const thumbMesh = f.mesh(thumb, finger, fingerRubber, 0, 0, 0, 0.093, 0.385, 0.086)
  // The rolled overglove cuff overlaps the black gauntlet at the wrist.
  const cuffLip = f.mesh(
    hand,
    f.profile([
      [0.208, 0],
      [0.22, 0.04],
      [0.211, 0.16],
      [0.224, 0.24],
      [0.22, 0.27],
    ]),
    fingerRubber,
    0,
    0.022,
    0.76,
  )
  cuffLip.rotation.x = Math.PI / 2
  const wristBand = f.mesh(hand, f.ring, f.material(0xd0b674, 0.18), 0, 0.025, 1.025, 0.207, 0.135, 0.21)
  wristBand.rotation.x = Math.PI / 2
  const shadow = f.shadow(parent, 0.72, 1.36)
  return (x: number, z: number, yaw: number, tilt: number, grip: number, t: number, height = ANCHOR_HEIGHT, toolWrist?: WristPose) => {
    hand.visible = !toolWrist
    shadow.visible = !toolWrist
    if (toolWrist) {
      updateSleeve(toolWrist.position, yaw, toolWrist.tangent)
      return
    }
    const lift = 0.019 * Math.sin(t * 1.9 + side)
    hand.position.set(x, height, z)
    hand.rotation.set(lift, yaw, tilt * 0.32)
    digits.forEach(({ shape }, i) => {
      shape.rotation.x = -1.55 - grip * 0.65 + 0.032 * Math.sin(t * 2.0 + i * 0.7)
    })
    thumbMesh.rotation.x = -1.51 - grip * 0.58
    const wrist: Point3 = {
      x: x + Math.sin(yaw) * 0.91,
      y: height + 0.025 + lift,
      z: z + Math.cos(yaw) * 0.91,
    }
    updateSleeve(wrist, yaw)
    shadow.position.set(x + 0.04, 0.022, z + 0.4)
    shadow.rotation.set(-Math.PI / 2, 0, yaw)
  }
}

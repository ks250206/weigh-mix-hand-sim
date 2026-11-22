import { type Container3D } from '@pixi/3d'
import { Forms, group, segment, type Point3 } from './forms'
import { ANCHOR_HEIGHT } from './chamber'

export function glove(f: Forms, parent: Container3D, side: -1 | 1) {
  const cuff = { x: side*3.76, y: .29, z: 3.76 }
  const rubber=f.material(0xc68b47,.19), fingerRubber=f.material(0xd69a52,.21)
  // Circumferential folds are part of a single molded rubber sleeve.
  const sleeveForm=f.profile([[0,-.5],[.86,-.5],[.94,-.48],[.95,-.44],[.87,-.405],
    [.82,-.37],[.88,-.335],[.90,-.31],[.82,-.27],[.76,-.23],[.81,-.2],[.83,-.17],
    [.76,-.135],[.68,-.10],[.72,-.07],[.73,-.045],[.66,.01],[.57,.08],
    [.60,.12],[.59,.16],[.52,.21],[.48,.28],[.50,.32],[.47,.36],[.43,.46],[.42,.5],[0,.5]],32)
  const sleeve = f.mesh(parent,sleeveForm,rubber)
  const hand=group(parent)
  f.oval(hand,rubber,0,.015,.66,.259,.144,.365)
  f.oval(hand,fingerRubber,-side*.085,.005,.51,.17,.132,.21)
  const finger = f.profile([[0,0],[.66,0],[.90,.08],[1,.2],[.94,.40],[.89,.58],[.88,.66],[.76,.86],[.6,.95],[.30,.993],[0,1]],20)
  const digits = [
    { x:-.135,z:.48,dx:-.026,l:.438,r:.076 },
    { x:-.015,z:.414,dx:.005,l:.442,r:.078 },
    { x:.115,z:.45,dx:.035,l:.396,r:.072 },
    { x:.223,z:.516,dx:.055,l:.306,r:.063 },
  ].map(d => {
    const node=group(hand)
    node.position.set(d.x*side,.003,d.z)
    node.rotation.y=-d.dx*side*3
    const shape=f.mesh(node,finger,fingerRubber,0,0,0,d.r,d.l,d.r*.88)
    return {node,shape}
  })
  const thumb=group(hand)
  thumb.position.set(-side*.16,-.02,.68)
  thumb.rotation.y=side*.81
  const thumbMesh=f.mesh(thumb,finger,fingerRubber,0,0,0,.093,.385,.086)
  // A darker wrist bead distinguishes the palm from the concertina sleeve.
  const wristBand=f.mesh(hand,f.ring,f.material(0xae753d,.16),0,.025,.905,.207,.135,.21)
  wristBand.rotation.x=Math.PI/2
  const shadow=f.oval(parent,f.ink(0x284d40,.16),0,.021,0,.34,.011,.63)
  return (x:number,z:number,yaw:number,tilt:number,grip:number,t:number) => {
    const lift=.019*Math.sin(t*1.9+side)
    hand.position.set(x,ANCHOR_HEIGHT,z)
    hand.rotation.set(lift, yaw, tilt*.32)
    digits.forEach(({shape},i) => {shape.rotation.x=-1.55-grip*.65+.032*Math.sin(t*2.0+i*.7)})
    thumbMesh.rotation.x=-1.51-grip*.58
    const wrist: Point3={x:x+Math.sin(yaw)*.91,y:ANCHOR_HEIGHT+.025+lift,z:z+Math.cos(yaw)*.91}
    segment(sleeve,cuff,wrist,.49,.49)
    shadow.position.set(x+.04,.022,z+.40)
    shadow.rotation.y=yaw
  }
}

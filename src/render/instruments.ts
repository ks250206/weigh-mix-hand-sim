import { Container3D, Geometry3D, type Mesh3D } from '@pixi/3d'
import type { ObjectId, TableObject } from '../contract'
import { Forms, group } from './forms'

const WHITE = 0xe1e5cf, METAL = 0xa5b8b5, CHARCOAL = 0x304541
const POWDER_A = 0xffdc80, POWDER_B = 0xa6d7dd

export interface Instrument {
  root: Container3D
  radius: number
  height: number
  update?: (obj: TableObject, mass: number, mixed: number) => void
}

function powder(f: Forms, p: Container3D, x: number, y: number, z: number, radius: number) {
  const holder = group(p)
  holder.position.set(x,y,z)
  const lump = f.oval(holder,POWDER_A,0,0,0,radius,.12,radius*.94)
  const second = f.oval(holder,POWDER_B,.10*radius,.025,0,radius*.80,.09,radius*.88)
  const granules: Mesh3D[] = []
  for (let i=0;i<9;i++) {
    const theta=i*2.4, r=Math.sqrt((i+.5)/10)*radius*.8
    granules.push(f.oval(holder,i%2===0?POWDER_A:POWDER_B,Math.cos(theta)*r,.095*(1-r/radius),Math.sin(theta)*r,.038,.033,.045))
  }
  return (obj: TableObject, mixed: number) => {
    const weight = obj.a+obj.b
    holder.visible = weight > .00001
    if (!holder.visible) return
    const fraction = obj.b / weight
    const amount = Math.min(1,.26+Math.cbrt(weight)*.46)
    holder.scale.set(amount,.32+amount*.68,amount)
    lump.material = f.material(fraction > .96 ? POWDER_B : POWDER_A)
    second.visible = fraction > .02 && fraction < .96
    second.scale.x = radius * Math.sqrt(fraction) * (1 - .006 * mixed)
    granules.forEach((grain,i) => { grain.material=f.material(i/9 < fraction ? POWDER_B : POWDER_A) })
  }
}

function bottleLabel(f: Forms, letter: string, color: string) {
  return f.decal(256,150,c=>{
    c.fillStyle='#eeeddb'; c.fillRect(0,0,256,150)
    c.fillStyle=color; c.fillRect(0,0,26,150)
    c.fillStyle='#243a35'; c.font='bold 91px Helvetica,Arial,sans-serif'; c.fillText(letter,37,103)
    c.fillStyle=color; c.fillRect(40,116,97,8)
    c.fillStyle='#445751'; c.font='bold 15px monospace'; c.fillText('REAGENT',123,62)
    c.fillRect(124,77,90,4); c.fillRect(124,87,62,4)
    for (let i=0;i<22;i++) c.fillRect(125+i*3.6,104,1+i%3,16)
  })
}

// A cylindrical label patch hugs the bottle and follows its motion and tilt.
function wrap(f: Forms, radius: number, height: number, arc: number) {
  const positions: number[]=[], normals: number[]=[], uvs: number[]=[], indices: number[]=[]
  for(let i=0;i<=20;i++){
    const u=i/20, a=(u-.5)*arc, x=Math.sin(a), z=Math.cos(a)
    positions.push(radius*x,-height/2,radius*z,radius*x,height/2,radius*z)
    normals.push(x,0,z,x,0,z); uvs.push(u,1,u,0)
    if(i<20){ const k=i*2; indices.push(k,k+2,k+1,k+2,k+3,k+1) }
  }
  return f.geometry(new Geometry3D({positions:Float32Array.from(positions),normals:Float32Array.from(normals),uvs:Float32Array.from(uvs),indices:Uint16Array.from(indices)}))
}

function jar(f: Forms, root: Container3D, a: boolean): Instrument {
  const glass=f.material(a?0xbd773e:0x497e81,.30)
  f.mesh(root, f.profile([[0,0],[.38,0],[.46,.045],[.49,.11],[.49,.86],[.475,.94],[.37,1.04],[.335,1.07],[.335,1.19],[.35,1.21],[.35,1.25],[.29,1.25],[.29,1.10]]),glass)
  f.disc(root,0x35413b,0,1.078,0,.30,.035)
  const contents=f.disc(root,a?POWDER_A:POWDER_B,0,1.107,0,.282,.021)
  f.mesh(root,wrap(f,.494,.53,2.66),bottleLabel(f,a?'A':'B',a?'#c38a45':'#5c9a9d'),0,.50,0)
  const lid=group(root)
  f.mesh(lid,f.profile([[0,0],[.35,0],[.397,.03],[.397,.195],[.373,.224],[0,.224]]),a?0xaf683a:0x44747a)
  f.disc(lid,a?0xd59d62:0x80aaa7,0,.222,0,.338,.018)
  for(let i=0;i<24;i++){
    const t=i*Math.PI/12
    const rib=f.box(lid,a?0xc3834b:0x638d8e,.393*Math.sin(t),.113,.393*Math.cos(t),.032,.15,.015)
    rib.rotation.y=t
  }
  return {root,radius:.51,height:1.45, update(obj) {
    lid.position.set(obj.open?.67:0,obj.open?.02:1.185,obj.open?-.12:0)
    lid.rotation.z=obj.open?-.15:0
    contents.visible=obj.a+obj.b>.00001
  }}
}

function sheetGeometry(f: Forms, folded: boolean) {
  const pos:number[]=[], normals:number[]=[]
  function point(i:number,j:number): [number,number,number] {
    const x=i/6*2-1,z=j/5*2-1
    const edge=Math.max(Math.abs(x),Math.abs(z))
    const ripple=Math.sin(i*2.32+j*1.59)*.028 + Math.cos(i*3.63-j)*.023
    return [x*(folded?.43:.7)+ripple*.24,.028 + (folded?.38*x*x:.10*edge**4) + ripple*(.2+.8*edge),z*.44 + ripple*.22]
  }
  function tri(a:number[],b:number[],c:number[]){
    const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],ex=c[0]-a[0],ey=c[1]-a[1],ez=c[2]-a[2]
    const nx=dy*ez-dz*ey,ny=dz*ex-dx*ez,nz=dx*ey-dy*ex,n=Math.hypot(nx,ny,nz)
    pos.push(...a,...b,...c); for(let k=0;k<3;k++) normals.push(nx/n,ny/n,nz/n)
  }
  for(let i=0;i<6;i++)for(let j=0;j<5;j++){
    const a=point(i,j),b=point(i+1,j),c=point(i,j+1),d=point(i+1,j+1)
    tri(a,c,b); tri(b,c,d)
  }
  return f.geometry(new Geometry3D({positions:Float32Array.from(pos),normals:Float32Array.from(normals)}))
}

export function instrument(f: Forms, parent: Container3D, id: ObjectId): Instrument {
  const root=group(parent)
  if(id==='jarA'||id==='jarB') return jar(f,root,id==='jarA')
  if(id==='foil'||id==='foil2'){
    const paper=group(root); paper.rotation.y=id==='foil'?-.13:.19
    const mat=f.material(id==='foil'?0xd8e1db:0xbacfd0,.8)
    const flat=f.mesh(paper,sheetGeometry(f,false),mat)
    const folded=f.mesh(paper,sheetGeometry(f,true),mat)
    const dust=powder(f,paper,0,.055,0,.37)
    return {root,radius:.66,height:.16,update(obj,mixMass,mixed){void mixMass; flat.visible=!obj.folded; folded.visible=obj.folded; dust(obj,mixed)}}
  }
  if(id==='scale'){
    f.box(root,CHARCOAL,0,.075,0,1.55,.12,1.37)
    f.box(root,0xb5c9c1,0,.165,0,1.59,.16,1.40)
    f.box(root,0xe0e7d9,0,.268,-.025,1.55,.12,1.32)
    f.disc(root,0x667e7a,0,.375,-.165,.565,.104)
    f.mesh(root,f.profile([[0,0],[.51,0],[.60,.035],[.61,.072],[.58,.09],[0,.09]]),f.material(METAL,.48),0,.408,-.165)
    f.box(root,CHARCOAL,-.13,.337,.462,.85,.039,.27)
    let ctx: CanvasRenderingContext2D | undefined
    let previous = ''
    const readout = f.decal(384,88,c=>{ctx=c})
    const face=f.panel(root,readout,-.13,.358,.462,.81,.23)
    face.rotation.x=-Math.PI/2
    for(let i=0;i<2;i++) f.disc(root,i===0?0x71a99a:0x90a8a1,.42+i*.18,.34,.465,.062,.034)
    return {root,radius:.8,height:.5,update(_obj,mass){
      const value=mass.toFixed(3)+' g'
      if(value===previous||!ctx) return
      previous=value; ctx.fillStyle='#213e3c';ctx.fillRect(0,0,384,88);ctx.fillStyle='#beffb7';ctx.font='bold 66px monospace';ctx.textAlign='center';ctx.fillText(value,192,67)
      ;readout.textures.baseColor?.source.update()
    }}
  }
  if(id==='mortar'){
    f.mesh(root,f.profile([[0,0],[.31,0],[.35,.04],[.35,.12],[.32,.15],[.48,.23],[.63,.40],[.7,.61],[.70,.71],[.67,.75],[.608,.72],[.594,.61],[.49,.43],[.35,.34],[.14,.29],[0,.29]]),f.material(WHITE,.22))
    f.oval(root,WHITE,.62,.68,-.03,.135,.065,.14)
    const dust=powder(f,root,0,.345,0,.45)
    return {root,radius:.72,height:.75,update(obj,_mass,mixed){dust(obj,mixed)}}
  }
  if(id==='pestle'||id==='spatula'){
    const tool=group(root); tool.rotation.set(1.43,0,id==='pestle'?-.75:.83)
    if(id==='pestle'){
      tool.position.set(-.45,.13,-.34)
      f.mesh(tool,f.profile([[0,0],[.08,.02],[.095,.08],[.087,.72],[.123,.84],[.164,1.02],[.15,1.12],[.1,1.17],[0,1.20]]),f.material(WHITE,.24))
      return {root,radius:.57,height:.24}
    }
    tool.position.set(.42,.09,-.4)
    f.mesh(tool,f.profile([[0,0],[.057,0],[.067,.04],[.055,.61],[.037,.64],[.035,1.13],[0,1.15]]),f.material(0x849c96,.5))
    f.oval(tool,f.material(0xdbe4d8,.72),0,1.16,0,.114,.215,.045)
    const dust=powder(f,tool,0,1.15,-.047,.1)
    return {root,radius:.56,height:.16,update(obj,_mass,mixed){dust(obj,mixed)}}
  }
  if(id==='vial'){
    const wall=f.ink(0xb8dada,.32)
    f.mesh(root,f.profile([[.24,.02],[.26,.06],[.26,.52],[.214,.62],[.214,.70],[.225,.72],[.225,.75],[.184,.75],[.184,.66]]),wall)
    f.disc(root,0x779d99,0,.035,0,.242,.068)
    f.mesh(root,wrap(f,.262,.21,2.4),f.ink(0xeee8d5),0,.36,0)
    f.mesh(root,f.ring,0xb2c6ba,0,.748,0,.209)
    const dust=powder(f,root,0,.098,0,.20)
    const closed=f.disc(root,CHARCOAL,0,.755,0,.236,.16)
    return {root,radius:.28,height:.8,update(obj,_mass,mixed){dust(obj,mixed); closed.visible=!obj.open}}
  }
  f.mesh(root,f.profile([[0,0],[.224,0],[.248,.02],[.248,.14],[.23,.158],[0,.158]]),CHARCOAL)
  f.disc(root,0x78908a,0,.159,0,.205,.009)
  return {root,radius:.26,height:.16}
}

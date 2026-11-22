// Register the 3D renderer pipes before Pixi initializes the WebGL backend.
import { AmbientLight, DirectionalLight, Plane, Vector3, View3D, type Mesh3D } from '@pixi/3d'
import { Application } from 'pixi.js'
import { HOME, LABELS, type GameState, type ObjectId, type Station } from './contract'
import { ANCHOR_HEIGHT, chamber, TABLE_DEPTH, TABLE_WIDTH, worldX, worldZ } from './render/chamber'
import { Forms } from './render/forms'
import { glove } from './render/gloves'
import { instrument } from './render/instruments'

const ids = Object.keys(HOME) as ObjectId[]
const limit = (v: number) => Math.max(0, Math.min(1,v))
const styles = `
.gb-window {position:absolute;inset:0;overflow:hidden;pointer-events:none;box-shadow:inset 0 0 0 3px #344e4d,inset 0 0 0 5px #95aaa05e,inset 0 7px 16px #17303355,inset 0 -4px 10px #1c383650;z-index:1}
.gb-window::after {content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(119deg,transparent 2%,#defff70c 2.15%,#defff708 5%,transparent 5.2%,transparent 88%,#e7fff50a 88.15%,transparent 91%);}
.gb-station {position:absolute;left:0;top:0;width:8px;height:8px;margin:-4px;pointer-events:none;z-index:1}
.gb-station > span {position:absolute;left:50%;top:50%;transform:translate(-50%,var(--offset));white-space:nowrap;color:#253d36;background:#d7e2d5de;border:1px solid #869e90;border-radius:3px;padding:2px 5px;font:700 var(--label-size, 11px)/1.2 "Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;letter-spacing:.025em;box-shadow:0 1px 2px #1e38352b;pointer-events:auto;cursor:crosshair;}
.gb-station[data-focus] {z-index:3}
.gb-station[data-focus] > span {color:#f4fae4;background:#2b4940;border-color:#d1e7b3}
.gb-station[data-goal] {z-index:4}
.gb-station[data-goal] > span {color:#28301c;background:#e4f45e;border-color:#5a6a36}
.gb-cursor {position:absolute;top:0;left:0;width:15px;height:15px;margin:-7.5px;border:1.5px solid #f6ffe5;border-radius:50%;box-shadow:0 0 0 1px #27433cc4;pointer-events:none;z-index:2}
.gb-cursor::after {content:"";position:absolute;left:50%;top:50%;width:3px;height:3px;background:#26463c;border:1px solid #f7ffe8;box-sizing:content-box;border-radius:50%;transform:translate(-50%,-50%)}
`
export async function createScene(host: HTMLElement): Promise<{
  draw(state: GameState): void
  pick(clientX: number, clientY: number): Station
  destroy(): void
}> {
  const app = new Application()
  await app.init({
    preference:'webgl',width:Math.max(1,host.clientWidth),height:Math.max(1,host.clientHeight),
    autoStart:false,autoDensity:true,resolution:Math.min(2,window.devicePixelRatio || 1),
    background:0x415e60,antialias:true,powerPreference:'high-performance',
  })
  const view = new View3D({width:1,height:1,composite:true,environment:null,toneMapping:'none',cull:'cpu',resolution:Math.min(1.5,window.devicePixelRatio || 1)})
  view.eventMode='none'
  app.stage.addChild(view)
  const f=new Forms(), root=view.root
  root.addChild(new AmbientLight({color:0xe0eee7,intensity:.93}))
  const key=new DirectionalLight({color:0xfff0d1,intensity:1.72})
  root.addChild(key); key.position.set(-6,10,5); key.lookAt({x:0,y:0,z:0})
  const fill=new DirectionalLight({color:0xc8e8f7,intensity:.70})
  root.addChild(fill); fill.position.set(7,5,-3); fill.lookAt({x:0,y:0,z:0})
  const pilot=chamber(f,root)
  const left=glove(f,root,-1), right=glove(f,root,1)
  const skin=document.createElement('div'), style=document.createElement('style'), cursor=document.createElement('span')
  skin.className='gb-window'; style.textContent=styles; cursor.className='gb-cursor'; skin.append(style,cursor)
  const position=host.style.position
  if(getComputedStyle(host).position==='static') host.style.position='relative'
  app.canvas.style.display='block'
  app.canvas.setAttribute('aria-hidden','true')
  host.append(app.canvas,skin)
  const models=ids.map(id=>{
    const model=instrument(f,root,id)
    const shadow=f.oval(root,f.ink(0x365647,.17),0,.013,0,model.radius*1.1,.009,model.radius*.82)
    const marker=document.createElement('span'), caption=document.createElement('span')
    marker.className='gb-station'; marker.dataset.station=id; caption.textContent=LABELS[id]
    marker.appendChild(caption); skin.appendChild(marker)
    return {id,model,marker,caption,shadow}
  })
  const goal=f.mesh(root,f.ring,f.ink(0xd8e845),0,.034,0,1)
  const particles: Mesh3D[]=[]
  const plane=new Plane(new Vector3(0,1,0),-ANCHOR_HEIGHT)
  const point=new Vector3()
  let width=1,height=1,last:GameState | undefined
  let hovering:ObjectId | null=null
  const resize=()=>{
    width=Math.max(1,host.clientWidth); height=Math.max(1,host.clientHeight)
    app.renderer.resize(width,height)
    view.width=width; view.height=height
    view.camera.mode='perspective'
    view.camera.near=.1; view.camera.far=90
    view.camera.position.set(0,12.5,15.7)
    view.camera.lookAt({x:0,y:.49,z:0})
    const halfH=Math.max(3.55,6.75*height/width)
    view.camera.fov=2*Math.atan(halfH/19.7)*180/Math.PI
    skin.style.setProperty('--label-size',width<480?'9px':width<850?'10px':'12px')
    if(last) draw(last)
  }
  const ro=new ResizeObserver(resize); ro.observe(host); resize()

  function pick(clientX:number,clientY:number):Station {
    // Captions can be selected directly; every other pixel is a real ray/plane intersection.
    const label=document.elementFromPoint(clientX,clientY)?.closest<HTMLElement>('.gb-station')
    const id=label?.dataset.station as ObjectId | undefined
    if(id && label && skin.contains(label) && last) {
      const {x,y}=last.objects[id]
      return {x,y}
    }
    const rect=app.canvas.getBoundingClientRect()
    const hit=view.screenToWorld({x:(clientX-rect.left)*width/(rect.width||1),y:(clientY-rect.top)*height/(rect.height||1)},plane,point)
    return hit ? {x:limit(hit.x/TABLE_WIDTH+.5),y:limit(hit.z/TABLE_DEPTH+.5)} : {x:.5,y:.5}
  }
  function pointer(e:PointerEvent) {
    if(!last) return
    const p=pick(e.clientX,e.clientY)
    let best=.106
    hovering=null
    for(const id of ids) {
      const o=last.objects[id], d=Math.hypot(o.x-p.x,o.y-p.y)
      if(d<best) {best=d;hovering=id}
    }
  }
  const leave=()=>{hovering=null}
  host.addEventListener('pointermove',pointer);host.addEventListener('pointerleave',leave)
  function draw(s:GameState) {
    last=s
    const t=performance.now()/1000
    const goalId=s.status==='playing'?s.target:null
    const held=s.hand.held
    const project=(x:number,y:number,z:number)=>view.worldToScreen({x,y,z})
    for(const {id,model,marker,caption,shadow} of models) {
      const o=s.objects[id], x=worldX(o.x), z=worldZ(o.y)
      const dockedFoil=id==='foil' && id!==held && Math.hypot(o.x-s.objects.scale.x,o.y-s.objects.scale.y)<.055
      const sealedCap=id==='cap'&&!s.objects.vial.open&&Math.hypot(o.x-s.objects.vial.x,o.y-s.objects.vial.y)<.03
      const y=id===held?.50:dockedFoil?.515:0
      model.root.visible=!sealedCap
      model.root.position.set(x, y + (o.toppled?model.radius*.75:0), z)
      model.root.rotation.z = o.toppled ? -Math.sign(o.tilt || 1)*1.36 : -o.tilt
      model.update?.(o,s.scaleMass,s.mixed)
      shadow.position.set(x+.09,.013,z+.065);shadow.visible=!dockedFoil&&!sealedCap
      const anchor=project(x,ANCHOR_HEIGHT,z)
      const tag=project(x,.022,z+model.radius*.70+.15)
      if(anchor && tag){
        const transform='translate('+anchor.x.toFixed(2)+'px,'+anchor.y.toFixed(2)+'px)'
        if(marker.style.transform!==transform) marker.style.transform=transform
        const offset=Math.round(tag.y-anchor.y+2)+'px'
        if(marker.style.getPropertyValue('--offset')!==offset) marker.style.setProperty('--offset',offset)
      }
      marker.hidden=sealedCap || (id==='scale' && s.objects.foil.x===o.x && s.objects.foil.y===o.y && goalId!=='scale')
      marker.toggleAttribute('data-goal',id===goalId)
      marker.toggleAttribute('data-focus',id===hovering||id===held)
      if(width<500) caption.style.padding='1px 3px'
      else if(caption.style.padding) caption.style.removeProperty('padding')
      if(id===goalId) {
        goal.position.set(x,.036,z)
        const r=model.radius*(1.25+.035*Math.sin(t*4))
        goal.scale.set(r,.45,r)
      }
    }
    goal.visible=goalId!==null
    const title=s.status==='title'
    const hx=worldX(s.hand.x), hz=worldZ(s.hand.y)
    const idle=title?.10:0
    right(hx,hz,Math.atan2(3.76-hx,Math.max(.50,3.76-hz))*.76,s.hand.tilt,held?.78:0,t)
    left(-3.1+Math.sin(t*.91)*.06,2.35+Math.sin(t*1.13)*(.035+idle),-.44,.11,.15,t+.83)
    const target=project(hx,ANCHOR_HEIGHT,hz)
    cursor.hidden=s.status!=='playing'
    if(target) cursor.style.transform='translate('+target.x.toFixed(2)+'px,'+target.y.toFixed(2)+'px)'
    pilot.scale.y=.070+.009*Math.sin(t*2.5)
    for(let i=0;i<Math.max(particles.length,s.particles.length);i++){
      const grain=s.particles[i]
      if(!grain){particles[i].visible=false;continue}
      const mesh=particles[i]??(particles[i]=f.mesh(root,f.ball,0xe3d099))
      mesh.visible=true
      mesh.material=f.material(grain.kind==='a'?0xffda80:0x92c6d2)
      const age=limit(1-grain.life/.6)
      mesh.position.set(worldX(grain.x),.06+.4*Math.sin(age*Math.PI)+.20*(1-age),worldZ(grain.y))
      mesh.scale.set(.034,.025,.038)
    }
    app.render()
  }
  return {draw,pick,destroy(){
    ro.disconnect();host.removeEventListener('pointermove',pointer);host.removeEventListener('pointerleave',leave)
    skin.remove();host.style.position=position
    view.destroy({children:true});f.destroy();app.destroy({removeView:true},{children:true})
  }}
}

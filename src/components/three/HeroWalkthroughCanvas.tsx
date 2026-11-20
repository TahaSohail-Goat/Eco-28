import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment } from "@react-three/drei/core/Environment";
import { useEnvironment } from "@react-three/drei/core/useEnvironment";
import { useGLTF } from "@react-three/drei/core/Gltf";
import { useTexture } from "@react-three/drei/core/Texture";
import { AgXToneMapping, DefaultLoadingManager, Group, MathUtils, MeshStandardMaterial, PCFShadowMap, PCFSoftShadowMap, PerspectiveCamera, Vector3 } from "three";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { cameraBeats, sampleCamera, chapterAt, residenceChapters, residenceCallouts, type Tuple3 } from "../../content/heroWalkthrough";
import { buildResidence, type Residence } from "./ResidenceModel";
import { residenceMaterials, residenceTextureUrls } from "./ResidenceMaterials";
import { residenceAssetUrls, useResidenceAssets } from "./ResidenceAssets";
import { liteResidence } from "./residenceQuality";
import { ResidenceFinish } from "./ResidenceFinish";

type Props = {
  progress: RefObject<number>;
  redraw: RefObject<(() => void) | null>;
  overlay: RefObject<HTMLDivElement | null>;
  onReady: () => void;
  onFailure: () => void;
  onProgress?: (fraction: number) => void;
};
const smooth = (p: number) => { const x=MathUtils.clamp(p,0,1);return x*x*(3-2*x); };
const reducedMotion=typeof window!=="undefined"&&matchMedia("(prefers-reduced-motion: reduce)").matches;
const sky=`/media/residence-realism${liteResidence?"/lite":""}/garden-sky.hdr`;
// Phones start sharp (antialiased, up to 1.5x) and step down only if frames run slow.
const liteDpr=typeof window!=="undefined"?Math.max(1,Math.min(1.5,window.devicePixelRatio||1)):1;
// Report download progress before the preloads below start. Totals grow as
// models reveal their textures, so the reported fraction never moves backwards.
let assetProgress=0;
const progressListeners=new Set<(fraction:number)=>void>();
const reportProgress=(fraction:number)=>{assetProgress=Math.max(assetProgress,fraction);progressListeners.forEach(listener=>listener(assetProgress));};
DefaultLoadingManager.onProgress=(_url,loaded,total)=>reportProgress(total?loaded/total:0);
DefaultLoadingManager.onLoad=()=>reportProgress(1);
// Start every independent asset group together; the sky otherwise waits until
// the models resolve, adding a full extra download to the reveal.
useGLTF.preload(residenceAssetUrls);
useTexture.preload(residenceTextureUrls);
useEnvironment.preload({files:sky});
RectAreaLightUniformsLib.init();
function Walkthrough({progress,redraw,overlay,onReady,onFailure}:Props) {
  const { camera,gl,invalidate,size }=useThree();
  const mobile=size.width<768;
  const sliding=useRef<Group>(null);
  const lastChapter=useRef(-1);
  const ready=useRef(false), readyFrame=useRef(0);
  const prepared=useRef(false);
  const point=useMemo(()=>new Vector3(),[]);
  const assets=useResidenceAssets();
  const maps=useTexture(residenceTextureUrls);
  const surfaces=useMemo(()=>residenceMaterials(maps,Math.min(8,gl.capabilities.getMaxAnisotropy()),liteResidence),[maps,gl]);
  const [residence,setResidence]=useState<Residence|null>(null);
  // Build in ~8ms slices across frames so the page and its loader keep animating.
  useEffect(()=>{
    const steps=buildResidence(surfaces.materials,assets.library);
    let frame=0,built:Residence|null=null;
    const run=()=>{
      const budget=performance.now()+8;
      let step=steps.next();
      while(!step.done&&performance.now()<budget)step=steps.next();
      if(step.done){built=step.value;setResidence(built);}
      else frame=requestAnimationFrame(run);
    };
    frame=requestAnimationFrame(run);
    return ()=>{cancelAnimationFrame(frame);built?.dispose();setResidence(null);};
  },[surfaces,assets]);
  useEffect(()=>()=>{surfaces.dispose();assets.dispose();},[surfaces,assets]);
  useEffect(()=>{
    redraw.current=invalidate;
    gl.shadowMap.autoUpdate=false;gl.shadowMap.needsUpdate=true;
    const lost=(event:Event)=>{event.preventDefault();onFailure();};
    gl.domElement.addEventListener("webglcontextlost",lost);invalidate();
    return ()=>{redraw.current=null;cancelAnimationFrame(readyFrame.current);ready.current=false;gl.domElement.removeEventListener("webglcontextlost",lost);};
  },[redraw,invalidate,gl,onFailure]);
  useEffect(()=>{gl.shadowMap.needsUpdate=true;invalidate();},[size.width,size.height,gl,invalidate]);
  const introStart=useRef(0);
  const pointerGoal=useMemo(()=>({x:0,y:0}),[]), pointerNow=useMemo(()=>({x:0,y:0}),[]);
  useEffect(()=>{
    if(liteResidence||!matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches)return;
    const move=(event:PointerEvent)=>{pointerGoal.x=event.clientX/innerWidth*2-1;pointerGoal.y=event.clientY/innerHeight*2-1;invalidate();};
    window.addEventListener("pointermove",move,{passive:true});
    return ()=>window.removeEventListener("pointermove",move);
  },[pointerGoal,invalidate]);
  const setDpr=useThree(state=>state.setDpr);
  const pace=useMemo(()=>({last:0,gaps:[] as number[],scale:liteDpr}),[]);
  useFrame((_,delta)=>{
    if(liteResidence) {
      // Renders while scrolling or gliding reveal the GPU's real pace; the median
      // ignores idle pauses. Slow devices step resolution down until it's fluid.
      const now=performance.now(),gap=now-pace.last;pace.last=now;
      if(gap<1000)pace.gaps.push(gap);
      if(pace.gaps.length>=20) {
        const median=pace.gaps.sort((a,b)=>a-b)[10];pace.gaps.length=0;
        if(median>24&&pace.scale>.85){pace.scale=pace.scale>1.3?1.25:pace.scale>1.1?1:.85;setDpr(pace.scale);}
      }
    }
    const p=progress.current,pose=sampleCamera(p);
    // Move the EXTERIOR camera back in portrait; retain eye-height interior routing.
    const exterior = 1-smooth(p/.17) + smooth((p-.85)/.12);
    const widen=mobile ? .3*exterior : 0;
    if(mobile)pose.target[1]-=2.3*exterior;
    pose.position=pose.position.map((v,i)=>pose.target[i]+(v-pose.target[i])*(1+widen)) as Tuple3;
    // Opening only: an establishing glide from a wider orbit, then pointer parallax.
    const opening=1-smooth(p/.05);
    const intro=introStart.current?Math.min(1,(performance.now()-introStart.current)/2800):0;
    const away=(1-(1-(1-intro)**3)*(introStart.current?1:0))*opening*(reducedMotion?0:1);
    const follow=Math.min(1,Math.min(delta,.05)*4);
    pointerNow.x+=(pointerGoal.x-pointerNow.x)*follow;pointerNow.y+=(pointerGoal.y-pointerNow.y)*follow;
    const yaw=away*.42+pointerNow.x*.07*opening, dolly=1+away*.22;
    const dx=pose.position[0]-pose.target[0], dz=pose.position[2]-pose.target[2];
    pose.position=[pose.target[0]+(dx*Math.cos(yaw)-dz*Math.sin(yaw))*dolly,
      pose.target[1]+(pose.position[1]-pose.target[1])*dolly+away*4.5-pointerNow.y*.9*opening,
      pose.target[2]+(dx*Math.sin(yaw)+dz*Math.cos(yaw))*dolly];
    const settling=Math.abs(pointerGoal.x-pointerNow.x)+Math.abs(pointerGoal.y-pointerNow.y)>.001;
    if(opening>0&&((introStart.current&&intro<1)||settling))invalidate();
    const c=camera as PerspectiveCamera;
    c.position.fromArray(pose.position);c.lookAt(...pose.target);
    c.fov=pose.fov+(mobile?14-4*exterior:0);c.updateProjectionMatrix();c.updateMatrixWorld();
    if(sliding.current) sliding.current.position.x=-2.9*smooth((p-.145)/.052);
    const data=gl.domElement.dataset;
    data.camera=c.position.toArray().map(v=>v.toFixed(3)).join(",");
    data.progress=p.toFixed(4);
    const hud=overlay.current;
    if(hud) {
      const chapter=chapterAt(p), index=residenceChapters.indexOf(chapter);
      const changed=lastChapter.current!==index;
      if(changed) {
        lastChapter.current=index;
        hud.querySelector("[data-residence-title]")!.textContent=chapter.title;
        hud.querySelector("[data-residence-subtitle]")!.textContent=chapter.subtitle;
        hud.querySelectorAll<HTMLElement>("[data-residence-title], [data-residence-subtitle]").forEach(el=>{
          el.getAnimations().forEach(animation=>animation.cancel());
          el.animate([{opacity:0,transform:"translateY(7px)"},{opacity:1,transform:"translateY(0)"}],{duration:320,easing:"cubic-bezier(.2,.65,.3,1)"});
        });
        hud.querySelector("[data-residence-index]")!.textContent=`0${index+1} — 08`;
        hud.querySelector("[data-residence-level]")!.textContent=chapter.level<0?"EXTERIOR":`LEVEL 0${chapter.level}`;
        hud.dataset.level=String(chapter.level);hud.dataset.chapter=String(index);
        hud.querySelectorAll<HTMLElement>("[data-level]").forEach(el=>{el.dataset.active=String(Number(el.dataset.level)===chapter.level);});
      }
      (hud.querySelector("[data-residence-progress]") as HTMLElement).style.transform=`scaleX(${p})`;
      residenceCallouts.forEach((callout,i)=>{
        const el=hud.querySelector(`[data-callout="${i}"]`)!;
        point.fromArray(callout.anchor).project(c);
        const x=(point.x*.5+.5)*size.width,y=(-point.y*.5+.5)*size.height;
        const visible=p>callout.from&&p<callout.to&&Math.abs(point.x)<.97&&Math.abs(point.y)<.82&&point.z<1;
        const alpha=visible?Math.min(smooth((p-callout.from)/.008),smooth((callout.to-p)/.008)):0;
        el.setAttribute("opacity",String(alpha));
        if(!visible)return;
        const right=x<size.width*.58;
        const tx=MathUtils.clamp(x+(right?45:-45),24,size.width-(mobile?170:205));
        const ty=MathUtils.clamp(y-38,140,size.height-215);
        const circle=el.querySelector("circle")!,path=el.querySelector("path")!,text=el.querySelector("text")!;
        circle.setAttribute("cx",String(x));circle.setAttribute("cy",String(y));
        path.setAttribute("d",`M${x} ${y} L${tx-10} ${ty+8} H${tx+(mobile?145:175)}`);
        text.setAttribute("x",String(tx));text.setAttribute("y",String(ty));
      });
    }
    if(prepared.current&&!ready.current){gl.shadowMap.needsUpdate=true;ready.current=true;introStart.current=performance.now();invalidate();readyFrame.current=requestAnimationFrame(onReady);}
  });
  const m=surfaces.materials;
  return <>
    <color attach="background" args={["#bfc6bf"]}/>
    {/* Aerial haze matched to the horizon melts the open field into the sky. */}
    <fog attach="fog" args={["#8e9698",55,320]}/>
    <Environment files={sky} background backgroundBlurriness={0} backgroundIntensity={1.2} environmentIntensity={.6}/>
    <hemisphereLight args={["#dbe4ec","#74674f",.36]}/>
    {/* Late-afternoon sun: warmer and lower, for longer modelling shadows. */}
    <directionalLight position={[-21,21,17]} color="#ffd8a8" intensity={2.9} castShadow
      shadow-mapSize={[1024,1024]}
      shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={22} shadow-camera-bottom={-14}
      shadow-camera-near={1} shadow-camera-far={75} shadow-normalBias={.035} shadow-bias={-.0002}
      target-position={[0,5,0]}/>
    {/* A single broad window-side fill approximates bounced daylight across
        the four levels without compiling eight lights into every material.
        Skipped on lite devices: area lights evaluate a per-pixel LTC lookup
        that is disproportionately costly on mobile GPUs. */}
    {liteResidence
      ? <directionalLight position={[16,8,2]} intensity={1.1} color="#ffead2" target-position={[0,5,0]}/>
      : <rectAreaLight position={[9,7,0]} rotation={[0,Math.PI/2,0]} width={10} height={15} intensity={3.2} color="#ffead2"/>}
    {residence&&<primitive object={residence.root}/>}
    {residence&&<ResidenceFinish prepared={prepared} onFailure={onFailure}/>}
    <group ref={sliding}>
      <mesh position={[0,1.55,5.45]} material={m.glass}><boxGeometry args={[2.75,3.1,.025]}/></mesh>
      {[-1.37,1.37].map(x=><mesh key={x} position={[x,1.55,5.46]} material={m.bronze}><boxGeometry args={[.045,3.1,.065]}/></mesh>)}
      <mesh position={[1.15,1.2,5.5]} material={m.bronze}><boxGeometry args={[.025,.65,.08]}/></mesh>
    </group>
    {/* Upper terrace door leaves are set open; all floor paths use real openings. */}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.51,0]} receiveShadow material={m.ground as MeshStandardMaterial}>
      <planeGeometry args={[2000,2000]} onUpdate={geometry=>{
        const uv=geometry.getAttribute("uv"),position=geometry.getAttribute("position");
        for(let i=0;i<uv.count;i++)uv.setXY(i,position.getX(i),position.getY(i));
        uv.needsUpdate=true;
      }}/>
    </mesh>
  </>;
}
export default function HeroWalkthroughCanvas(props:Props) {
  const {onProgress}=props;
  useEffect(()=>{
    if(!onProgress)return;
    onProgress(assetProgress);progressListeners.add(onProgress);
    return ()=>{progressListeners.delete(onProgress);};
  },[onProgress]);
  return <Canvas camera={{position:cameraBeats[0].position,fov:43,near:.06,far:1000}}
    frameloop="demand" shadows dpr={liteResidence?liteDpr:[1,1.25]}
    gl={{antialias:true,alpha:false,powerPreference:"high-performance"}}
    // The shadow map renders once, so phones only pay a hard-edged lookup per pixel.
    onCreated={({gl})=>{gl.toneMapping=AgXToneMapping;gl.toneMappingExposure=1.05;gl.shadowMap.type=liteResidence?PCFShadowMap:PCFSoftShadowMap;}}>
    <Walkthrough {...props}/>
  </Canvas>;
}

import { useEffect, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/** Compile the scene before revealing it and render only when requested. */
export function ResidenceFinish({prepared,onFailure}:{prepared:RefObject<boolean>;onFailure:()=>void}) {
  const {gl,scene,camera,invalidate}=useThree();
  useEffect(()=>{
    let active=true;
    prepared.current=false;
    void gl.compileAsync(scene,camera).then(()=>{
      if(active){prepared.current=true;invalidate();}
    }).catch(()=>{if(active)onFailure();});
    return ()=>{active=false;prepared.current=false;};
  },[gl,scene,camera,invalidate,prepared,onFailure]);
  useFrame(()=>{
    if(!prepared.current)return;
    gl.info.autoReset=false;gl.info.reset();
    gl.render(scene,camera);
    gl.domElement.dataset.calls=String(gl.info.render.calls);
    gl.domElement.dataset.triangles=String(gl.info.render.triangles);
  },1);
  return null;
}

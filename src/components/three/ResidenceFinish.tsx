import { useEffect, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Mesh, Texture } from "three";

/** Compile the scene before revealing it and render only when requested. */
export function ResidenceFinish({prepared,onFailure}:{prepared:RefObject<boolean>;onFailure:()=>void}) {
  const {gl,scene,camera,invalidate}=useThree();
  useEffect(()=>{
    let active=true,frame=0;
    prepared.current=false;
    void gl.compileAsync(scene,camera).then(()=>{
      if(!active)return;
      // Upload textures in small per-frame batches rather than all inside the
      // first render, so the page (and its loader) never freezes for long.
      const textures=new Set<Texture>();
      scene.traverse(node=>{
        if(!(node instanceof Mesh))return;
        for(const material of Array.isArray(node.material)?node.material:[node.material])
          for(const value of Object.values(material))if(value instanceof Texture)textures.add(value);
      });
      const queue=[...textures];
      // Then draw a few meshes per frame into a 1px scissor of the (still hidden)
      // canvas. Without parallel shader compilation, the first full render would
      // otherwise block on every program link and buffer upload at once.
      const meshes:Mesh[]=[];
      scene.traverse(node=>{if(node instanceof Mesh&&node.visible)meshes.push(node);});
      const pending=[...meshes];
      const warm=()=>{
        const shadows=gl.shadowMap.needsUpdate;
        gl.shadowMap.needsUpdate=false;
        gl.setScissorTest(true);gl.setScissor(0,0,1,1);
        const budget=performance.now()+8;
        do{
          const batch=pending.splice(0,10);
          meshes.forEach(mesh=>{mesh.visible=false;});
          const culled=batch.map(mesh=>mesh.frustumCulled);
          batch.forEach(mesh=>{mesh.visible=true;mesh.frustumCulled=false;});
          gl.render(scene,camera);
          batch.forEach((mesh,i)=>{mesh.frustumCulled=culled[i];});
        }while(pending.length&&performance.now()<budget);
        meshes.forEach(mesh=>{mesh.visible=true;});
        gl.setScissorTest(false);
        gl.shadowMap.needsUpdate=shadows;
      };
      const upload=()=>{
        if(!active)return;
        const budget=performance.now()+6;
        if(queue.length)do{const texture=queue.shift();if(texture)gl.initTexture(texture);}while(queue.length&&performance.now()<budget);
        else warm();
        if(queue.length||pending.length){frame=requestAnimationFrame(upload);return;}
        prepared.current=true;invalidate();
      };
      upload();
    }).catch(()=>{if(active)onFailure();});
    return ()=>{active=false;cancelAnimationFrame(frame);prepared.current=false;};
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

"use client";
import { useEffect, useRef } from "react";
import type { SceneController, View } from "./create-driving-scene";
import type { Theme } from "./theme-transition";
interface Props { sceneLabel:string; theme:Theme; view:View; progress:number; reduced:boolean; onReady:()=>void; onSettled:(v:View)=>void; onError:(message:string)=>void; }
export default function CarStage(props:Props){
  const host=useRef<HTMLDivElement>(null);
  const controller=useRef<SceneController|null>(null);
  const latest=useRef(props);
  useEffect(()=>{latest.current=props;},[props]);
  useEffect(()=>{
    let cancelled=false;
    import("./create-driving-scene").then(({createDrivingScene})=>{
      if(cancelled||!host.current)return;
      const p=latest.current;
      controller.current=createDrivingScene(host.current,{
        theme:p.theme,view:p.view,reducedMotion:p.reduced,paused:false,
        onReady:()=>{if(!cancelled)latest.current.onReady();},
        onProgress:()=>{},onPhase:()=>{},
        onViewSettled:v=>{if(!cancelled&&v===latest.current.view)latest.current.onSettled(v);},
        onError:message=>{if(!cancelled)latest.current.onError(message);},
      });
      controller.current.setStoryProgress(p.progress);
    }).catch(()=>{if(!cancelled)latest.current.onError("3D 场景暂时无法加载，请刷新后重试。");});
    return()=>{cancelled=true;controller.current?.dispose();controller.current=null;};
  },[]);
  useEffect(()=>controller.current?.setTheme(props.theme),[props.theme]);
  useEffect(()=>controller.current?.setView(props.view),[props.view]);
  useEffect(()=>controller.current?.setStoryProgress(props.progress),[props.progress]);
  useEffect(()=>controller.current?.setReducedMotion(props.reduced),[props.reduced]);
  return <div className="car-stage" ref={host} role="img" aria-label={props.sceneLabel} data-testid="persistent-car-scene" />;
}

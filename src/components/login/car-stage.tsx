"use client";
import { useI18n } from "@/features/i18n/provider";
import { useEffect, useRef, useState } from 'react';
import type { SceneController, View } from './create-driving-scene';
import type { Theme } from './theme-transition';
interface Props {theme:Theme;view:View;paused:boolean;reducedMotion:boolean;onViewSettled:(view:View)=>void;}
export default function CarStage(props:Props){
  const { t: tr } = useI18n();
  const host=useRef<HTMLDivElement>(null),controller=useRef<SceneController|null>(null),initial=useRef(props);
  const [progress,setProgress]=useState(0),[ready,setReady]=useState(false),[error,setError]=useState('');
  useEffect(()=>{ initial.current={theme:props.theme,view:props.view,paused:props.paused,reducedMotion:props.reducedMotion,onViewSettled:props.onViewSettled}; },[props.theme,props.view,props.paused,props.reducedMotion,props.onViewSettled]);
  useEffect(()=>{
    if(!host.current)return;
    let cancelled=false;
    import('./create-driving-scene').then(({createDrivingScene})=>{
      if(cancelled||!host.current)return;
      controller.current=createDrivingScene(host.current,{...initial.current,onProgress:setProgress,onReady:()=>setReady(true),onPhase:()=>{},onViewSettled:(view)=>{if(initial.current.view===view)initial.current.onViewSettled(view);},onError:(message)=>{setError(message);initial.current.onViewSettled(initial.current.view);}});
    }).catch(e=>{if(cancelled)return;console.error(e);setError('当前浏览器无法启动 3D 渲染。你仍可体验登录交互，或使用支持 WebGL 2 的浏览器。');initial.current.onViewSettled(initial.current.view);});
    return ()=>{cancelled=true;controller.current?.dispose();controller.current=null;};
  },[]);
  useEffect(()=>controller.current?.setTheme(props.theme),[props.theme]);
  const { view, onViewSettled } = props;
  useEffect(()=>{if(error)onViewSettled(view);else controller.current?.setView(view);},[view,onViewSettled,error]);
  useEffect(()=>controller.current?.setPaused(props.paused),[props.paused]);
  useEffect(()=>controller.current?.setReducedMotion(props.reducedMotion),[props.reducedMotion]);
  return <><div ref={host} className={'car-stage'+(ready?' is-ready':'')} data-testid="car-stage" />
    {!ready&&!error&&<div className="scene-loader" role="status"><span className="loader-orbit"/><span>{tr("正在准备下一程 ")}<b>{progress}%</b></span></div>}
    {error&&<div className="scene-error" role="status"><span>{tr(error)}</span><button onClick={()=>window.location.reload()}>{tr("重新加载")}</button></div>}
  </>;
}


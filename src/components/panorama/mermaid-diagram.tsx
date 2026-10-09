'use client';
import { useI18n } from "@/features/i18n/provider";
/* eslint-disable @next/next/no-img-element -- SVG is deliberately isolated as an inert image, not injected into app DOM. */
import { useEffect, useState } from 'react';
import { createUuid } from '@/lib/uuid';
import { assertSafeUcDiagram } from '@/features/panorama/mermaid-safety';
let renderQueue:Promise<void>=Promise.resolve();
export function MermaidDiagram({code,attemptId}:{code:string;attemptId?:string|null}){
  const { t: tr } = useI18n();
  const [image,setImage]=useState<{code:string;url:string}|null>(null),[failure,setFailure]=useState<{code:string;message:string}|null>(null);
  useEffect(()=>image?()=>URL.revokeObjectURL(image.url):undefined,[image]);
  useEffect(()=>{
    if(attemptId===null)return;
    let cancelled=false;
    const render=async()=>{
      let host:HTMLDivElement|undefined;
      try{
        const text=assertSafeUcDiagram(code);
        const {default:mermaid}=await import('mermaid');
        if(cancelled)return;
        mermaid.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,maxTextSize:100000,maxEdges:500,flowchart:{htmlLabels:false},theme:'neutral'});
        host=document.createElement('div');host.style.cssText='position:fixed;left:-100000px;top:0;width:1200px;visibility:hidden';document.body.append(host);
        const result=await mermaid.render('uc-graph-'+createUuid(),text,host);
        if(cancelled)return;
        const url=URL.createObjectURL(new Blob([result.svg],{type:'image/svg+xml'}));
        setImage({code,url});setFailure(null);
      }catch(e){if(!cancelled)setFailure({code,message:e instanceof Error?e.message:'图形渲染失败'});}
      finally{host?.remove();}
    };
    renderQueue=renderQueue.then(render,render);
    return()=>{cancelled=true;};
  },[code,attemptId]);
  return <div className='uc-mermaid-render' aria-label={tr("UC图形")}>
    {failure?.code===code&&<p role='alert'>{tr("图形渲染失败：")}{tr(failure.message)}。{image?tr("仍显示上次成功的图，当前图并非最新结果。"):tr("可展开代码检查；不会执行图中的交互。")}</p>}
    {image?<img src={image.url} alt={tr("基于已确认UC生成的用例关系图")}/>:failure?.code!==code&&<p role='status'>{tr("正在绘制UC图…")}</p>}
    {image&&image.code!==code&&failure?.code!==code&&<p role='status'>{tr("正在绘制新版UC图，当前保留上次成功结果。")}</p>}
  </div>;
}

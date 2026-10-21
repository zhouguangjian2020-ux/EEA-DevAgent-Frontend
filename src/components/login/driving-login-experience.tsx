"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { BrandLockup } from "@/components/brand/brand-lockup";
import type { View } from "./create-driving-scene";
import { useTheme } from "@/features/theme/use-theme";
import { useI18n } from "@/features/i18n/provider";
import { LoadingIllustration } from "@/components/feedback/loading";
import "./driving-homepage.css";
import CarStage from "./car-stage";
import { useChapterScroll } from "./use-chapter-scroll";
import DrivingLoginPanel from "./driving-login-panel";

function DetailIcon({kind}:{kind:number}){
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind===0?<><path d="M8 3h11l6 6v20H8zM19 3v7h6M12 16h9M12 21h7"/><circle cx="6" cy="25" r="3"/></>:kind===1?<><path d="m16 3 13 7-13 7L3 10zM3 16l13 7 13-7M3 22l13 7 13-7"/></>:<><circle cx="8" cy="8" r="4"/><circle cx="24" cy="9" r="4"/><circle cx="16" cy="25" r="4"/><path d="m11 10 9-1M10 12l4 9M22 13l-4 8"/></>}
  </svg>;
}
const chapters=["产品概览","想法回应","细节追溯"];
const heroItems=[["需求洞察","理解目标 · 洞察约束"],["智能协同","多域知识 · 共创方案"],["工程可追溯","连接设计 · 贯通验证"]];
const responseItems=[["意图建模","对齐目标 · 澄清约束"],["架构推演","划分边界 · 协同设计"],["工程协同","连接专业 · 支撑决策"]];
const traceItems=[["全链关联","目标 · 架构 · 设计 · 验证"],["演进脉络","记录决策 · 理解变化"],["影响洞察","跨域关联 · 分析影响"]];

export default function DrivingLoginExperience(){
  const { t: tr } = useI18n();
  const [ready,setReady]=useState(false),[error,setError]=useState("");
  const [theme,setTheme]=useTheme();
  const [view,setView]=useState<View>("home");
  const [settled,setSettled]=useState<View | null>("home"),[progress,setProgress]=useState(0),[reduced,setReduced]=useState(false);
  const entry=useRef<HTMLButtonElement>(null),savedScroll=useRef(0),viewRef=useRef<View>("home"),returningHome=useRef(false);
  const {goTo}=useChapterScroll(ready && view==="home",reduced);
  const active=Math.min(2,Math.max(0,Math.round(progress)));
  const onReady=useCallback(()=>setReady(true),[]);
  const onError=useCallback((message:string)=>{setError(message);setReady(true);setSettled(viewRef.current);},[]);
  const onSettled=useCallback((value:View)=>{
    setSettled(value);
    if(value==="home")entry.current?.focus({preventScroll:true});
  },[]);
  useEffect(()=>{
    const media=window.matchMedia("(prefers-reduced-motion: reduce)");
    const update=()=>setReduced(media.matches);update();media.addEventListener("change",update);
    return()=>media.removeEventListener("change",update);
  },[]);
  useEffect(()=>{
    let frame=0;
    const update=()=>{frame=0;if(viewRef.current==="home")setProgress(Math.min(2,window.scrollY/window.innerHeight));};
    const schedule=()=>{if(!frame)frame=window.requestAnimationFrame(update);};
    update();window.addEventListener("scroll",schedule,{passive:true});window.addEventListener("resize",schedule);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener("scroll",schedule);window.removeEventListener("resize",schedule);};
  },[]);
  useEffect(()=>{
    const previous=document.documentElement.style.overflow;
    if(view==="login")document.documentElement.style.overflow="hidden";
    return()=>{document.documentElement.style.overflow=previous;};
  },[view]);
  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content",theme==="dark"?"#111923":"#f7f9fc");
  },[theme]);
  useEffect(()=>{
    const root=document.documentElement;
    root.dataset.drivingHomepage="true";
    return()=>{delete root.dataset.drivingHomepage;};
  },[]);
  const enter=()=>{if(!ready||view==="login")return;savedScroll.current=window.scrollY;viewRef.current="login";setSettled(error?"login":null);setView("login");};
  const back=()=>{returningHome.current=true;viewRef.current="home";setSettled(error?"home":null);setView("home");requestAnimationFrame(()=>window.scrollTo({top:savedScroll.current,behavior:"instant"}));};
  const go=(index:number)=>{if(view==="home")goTo(index);};
  const homeVisible=ready&&view==="home"&&settled==="home";
  useEffect(()=>{if(homeVisible&&returningHome.current){returningHome.current=false;entry.current?.focus({preventScroll:true});}},[homeVisible]);
  const panelStyle=(index:number):CSSProperties=>{
    const distance=Math.abs(progress-index);
    return {opacity:homeVisible?Math.max(0,Math.min(1,(.67-distance)/.35)):0,transform:`translateY(${homeVisible?(index-progress)*48:20}px)`,pointerEvents:homeVisible&&active===index?"auto":"none"};
  };
  return <main className="driving-homepage" data-theme={theme} data-view={view} data-section={active} data-ready={ready} data-scene-ready={ready} data-home-settled={settled==="home"} aria-busy={!ready} data-reduced-motion={reduced}>
    <a className="skip-link" href="#story-copy">{tr("跳转到产品介绍")}</a>
    <CarStage sceneLabel={tr("同一辆 3D 概念车，流动轨道与延迟灯光")} theme={theme} view={view} progress={progress} reduced={reduced} onReady={onReady} onSettled={onSettled} onError={onError}/>
    <div className="scene-vignette" aria-hidden="true"/>
    {!ready&&<div className="loading-gate"><LoadingIllustration kind="orbit" label={tr("正在准备下一程")}/></div>}
    <header className="topbar" inert={!ready}>
      <a href="#" className="brand-home" aria-label={tr("天枢首页")} onClick={e=>{e.preventDefault();if(view==="login")back();else go(0);}}><BrandLockup/></a>
      <div className="header-actions"><button className="theme-toggle" type="button" role="switch" aria-checked={theme==="dark"} aria-label={theme==="light"?tr("切换为深色模式"):tr("切换为明亮模式")} onClick={()=>setTheme(theme==="light"?"dark":"light")}><svg viewBox="0 0 24 24" aria-hidden="true">{theme==="light"?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/></>:<path d="M20 15.8A9 9 0 0 1 8.2 4 9 9 0 1 0 20 15.8Z"/>}</svg></button><button className="primary-button header-entry" ref={entry} type="button" disabled={!ready} onClick={view==="login"?back:enter}>{view==="login"?tr("返回首页"):tr("进入工作空间")}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></div>
    </header>
    <div className="story-overlays" id="story-copy" tabIndex={-1}>
      <section className="story-copy hero-copy" style={panelStyle(0)} aria-hidden={!(homeVisible&&active===0)} inert={!(homeVisible&&active===0)}>
        <div className="eyebrow"><span/> IDEAS INTO ENGINEERING</div>
        <h1>{tr("从意图，")}<br/>{tr("驶向工程。")}</h1>
        <p className="hero-description">{tr("少一点重复，多一点创造。")}<br/>{tr("把复杂留给智能，把方向握在手中。")}</p>
        <div className="detail-list">{heroItems.map(([title,description],i)=><div className="detail-item" key={title}><DetailIcon kind={i}/><div><h3>{tr(title)}</h3><span>{tr(description)}</span></div></div>)}</div>
      </section>
      <section className="story-copy response-copy" style={panelStyle(1)} aria-hidden={!(homeVisible&&active===1)} inert={!(homeVisible&&active===1)}>
        <div className="eyebrow"><span/> FROM AN IDEA TO AN ANSWER</div>
        <h2>{tr("你的每一个想法，")}<br/>{tr("都有回应。")}</h2>
        <p>{tr("从一句想法出发，让工程逻辑逐步清晰。")}<br/>{tr("将文字描述，连接到可审核的工程成果。")}</p>
        <div className="detail-list">{responseItems.map(([title,description],i)=><div className="detail-item" key={title}><DetailIcon kind={i}/><div><h3>{tr(title)}</h3><span>{tr(description)}</span></div></div>)}</div>
      </section>
      <section className="story-copy trace-copy" style={panelStyle(2)} aria-hidden={!(homeVisible&&active===2)} inert={!(homeVisible&&active===2)}>
        <div className="eyebrow"><span/> EVERY DETAIL HAS A STORY</div>
        <h2>{tr("辅助你追溯")}<br/>{tr("每一个细节的变化。")}</h2>
        <p>{tr("贯通目标、架构、设计与验证，")}<br/>{tr("让每一次决策与变更都有迹可循。")}</p>
        <div className="detail-list">{traceItems.map(([title,description],i)=><div className="detail-item" key={title}><DetailIcon kind={i===0?2:i===2?0:1}/><div><h3>{tr(title)}</h3><span>{tr(description)}</span></div></div>)}</div>
      </section>
    </div>
    <aside className={`chapter-indicator${!homeVisible?" is-away":""}`} aria-label={tr("章节导航")} inert={!homeVisible}><span className="chapter-number">0{active+1}<small>/ 03</small></span>{chapters.map((title,i)=><button key={title} className={active===i?"active":""} onClick={()=>go(i)} aria-label={tr("第{0}屏：{1}",{0:i+1,1:tr(title)})} aria-pressed={active===i}/>)}</aside>
    <DrivingLoginPanel active={ready&&view==="login"&&settled==="login"}/>
    <footer className="bottom-bar"><span>{tr("让下一程，从这里开始")}</span><button className="scroll-cue" aria-label={active===2?tr("回到首屏"):tr("向下探索")} onClick={()=>go(active===2?0:active+1)} hidden={view==="login"}><span>{active===2?tr("回到开端"):tr("向下探索")}</span><svg viewBox="0 0 24 24" aria-hidden="true" style={{transform:active===2?"rotate(180deg)":undefined}}><path d="M12 3v17m-6-6 6 6 6-6"/></svg></button><span className="footer-caption">BUILT FOR WHAT&apos;S NEXT.</span></footer>
    {error&&<div className="scene-error" role="status">{tr(error)}<button onClick={()=>window.location.reload()}>{tr("重新加载")}</button></div>}
    <div className="scroll-track" aria-hidden="true"><div/><div/><div/></div>
    <span className="sr-only">3D model: Car Concept. <a href="/MODEL-LICENSE.txt">{tr("模型许可")}</a></span>
  </main>;
}

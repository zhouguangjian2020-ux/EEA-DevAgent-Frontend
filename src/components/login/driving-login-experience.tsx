"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { View } from "./create-driving-scene";
import type { LightPhase } from "./theme-transition";
import { useTheme } from "@/features/theme/use-theme";
import CarStage from "./car-stage";
import DrivingLoginPanel from "./driving-login-panel";

const slogans = [["让需求，", "更快落地。"], ["从意图，", "驶向工程。"], ["与智能，", "共赴下一程。"]] as const;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export default function DrivingLoginExperience() {
  const [theme, setTheme] = useTheme();
  const [view, setView] = useState<View>("home");
  const [paused, setPaused] = useState(false);
  const reducedMotion = useReducedMotion();
  const [slogan, setSlogan] = useState(0);
  const [phase, setPhase] = useState<LightPhase>("settled");
  const [lamps, setLamps] = useState(theme === "dark" ? 1 : 0);
  const [credits, setCredits] = useState(false);
  const enter = useRef<HTMLButtonElement>(null);
  const creditDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#111923" : "#f7f9fc");
  }, [theme]);

  useEffect(() => {
    if (paused || reducedMotion || view !== "home") return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setSlogan((current) => (current + 1) % slogans.length);
    }, 4800);
    return () => window.clearInterval(timer);
  }, [paused, reducedMotion, view]);

  useEffect(() => {
    if (credits) creditDialog.current?.showModal();
    else if (creditDialog.current?.open) creditDialog.current.close();
  }, [credits]);

  const onPhase = useCallback((next: LightPhase, value: number) => {
    setPhase(next);
    setLamps(value);
  }, []);

  const back = () => {
    setView("home");
    window.setTimeout(() => enter.current?.focus({ preventScroll: true }), reducedMotion ? 120 : 1350);
  };

  const lightStatus = phase === "environment" ? "环境渐变中" : phase === "delay" ? (theme === "dark" ? "准备开启车灯" : "准备关闭车灯") : phase === "lights" ? (theme === "dark" ? "车灯缓缓亮起" : "车灯缓缓熄灭") : (lamps > 0.5 ? "夜间 · 车灯已开启" : "日间 · 车灯已关闭");

  return (
    <main className="driving-login-experience" data-theme={theme} data-view={view} data-reduced-motion={reducedMotion}>
      <CarStage theme={theme} view={view} paused={paused} reducedMotion={reducedMotion} onPhase={onPhase} />
      <header className="topbar">
        <div className="wordmark" aria-label="天枢 · 工程体验"><span className="brand-symbol"><i /><i /></span><span>天枢<span className="brand-divider">/</span><span className="brand-en">ENGINEERING IN MOTION</span></span></div>
        <div className="top-controls">
          <span className="prototype-label">LOGIN EXPERIENCE <span>01</span></span>
          <button type="button" className="motion-toggle icon-button" onClick={() => setPaused((current) => !current)} aria-label={paused ? "播放动效" : "暂停动效"} title={paused ? "播放动效" : "暂停动效"} aria-pressed={paused}>{paused ? "▶" : "Ⅱ"}</button>
          <button type="button" className="theme-toggle" role="switch" aria-checked={theme === "dark"} aria-label={theme === "light" ? "切换为深色模式" : "切换为明亮模式"} onClick={() => setTheme(theme === "light" ? "dark" : "light")}><span className="theme-thumb" /><span aria-hidden="true">☼</span><span aria-hidden="true">☾</span></button>
        </div>
      </header>

      <section className={"hero-copy" + (view === "login" ? " is-away" : "")} aria-hidden={view !== "home"} inert={view !== "home"}>
        <div className="eyebrow"><span className="live-dot" /> IDEAS INTO ENGINEERING</div>
        <h1 className="slogan-window" aria-label={slogans[slogan].join("")}>
          {slogans.map((lines, index) => <span key={index} className={"slogan" + (index === slogan ? " is-active" : "")} aria-hidden={index !== slogan}><span>{lines[0]}</span><span>{lines[1]}</span></span>)}
        </h1>
        <p className="hero-description">少一点重复，多一点创造。<br />把复杂留给智能，把方向握在手中。</p>
        <div className="capability-line"><span>需求洞察</span><i /><span>智能协同</span><i /><span>工程可追溯</span></div>
        <div className="slogan-pagination" aria-label="切换标语">{slogans.map((_, index) => <button type="button" key={index} aria-label={"第 " + (index + 1) + " 条标语"} aria-pressed={slogan === index} onClick={() => setSlogan(index)} className={index === slogan ? "active" : ""} />)}</div>
      </section>

      <DrivingLoginPanel active={view === "login"} onBack={back} />
      <div className={"entry-action" + (view === "login" ? " is-away" : "")} aria-hidden={view !== "home"} inert={view !== "home"}><button type="button" ref={enter} className="primary-button enter-button" onClick={() => setView("login")}>前往工作区 <span aria-hidden="true">→</span></button><span className="entry-hint">让下一程，从这里开始</span></div>

      <footer className="bottom-bar"><button type="button" className="credits-button" onClick={() => setCredits(true)}>3D 登录体验 ↗</button><span className={"lighting-status " + (lamps > 0.5 ? "is-on" : "")} aria-live="polite"><i />{lightStatus}</span><span className="footer-caption">BUILT FOR WHAT&apos;S NEXT.</span></footer>
      <dialog ref={creditDialog} className="credits-dialog" onCancel={() => setCredits(false)} onClose={() => setCredits(false)}><button type="button" className="dialog-close icon-button" onClick={() => setCredits(false)} aria-label="关闭说明">×</button><div className="eyebrow">ABOUT THIS LOGIN</div><h2>先体验，再启程。</h2><p>这是正式前端登录页的 3D 视觉层，登录仍使用既有认证接口，不改变 Cookie 会话、Mock 模式和登录失败处理。</p><p>同一份 3D 车型贯穿明亮、深色、首页和登录页；环境渐变完成后，车灯与车底灯稍后再渐亮或渐灭。</p><h3>模型来源</h3><p>本页面使用 Car Concept 作为授权的交互车型，资产标注 CC BY 4.0。此车型仅用于登录界面视觉，不代表业务车辆。</p><a href="/MODEL-LICENSE.txt" target="_blank" rel="noreferrer">查看模型来源与许可说明 ↗</a><button type="button" className="primary-button" onClick={() => setCredits(false)}>继续体验 <span aria-hidden="true">→</span></button></dialog>
    </main>
  );
}

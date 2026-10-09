"use client";
import { useI18n } from "@/features/i18n/provider";

import { useCallback, useEffect, useRef, useState } from "react";
import type { View } from "./create-driving-scene";
import { BrandLockup } from "@/components/brand/brand-lockup";
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
  const { t: tr } = useI18n();
  const [theme, setTheme] = useTheme();
  const [view, setView] = useState<View>("home");
  const [homeSettled, setHomeSettled] = useState(true);
  const reducedMotion = useReducedMotion();
  const [slogan, setSlogan] = useState(0);
  const enter = useRef<HTMLButtonElement>(null);
  const returningHome = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#111923" : "#f7f9fc");
  }, [theme]);

  useEffect(() => {
    if (reducedMotion || view !== "home" || !homeSettled) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setSlogan((current) => (current + 1) % slogans.length);
    }, 4800);
    return () => window.clearInterval(timer);
  }, [homeSettled, reducedMotion, view]);

  const onViewSettled = useCallback((settled: View) => {
    if (settled !== "home") return;
    setHomeSettled(true);
  }, []);

  const back = () => {
    returningHome.current = true;
    setHomeSettled(false);
    setView("home");
  };
  const homeVisible = view === "home" && homeSettled;
  useEffect(() => {
    if (!homeVisible || !returningHome.current) return;
    returningHome.current = false;
    enter.current?.focus({ preventScroll: true });
  }, [homeVisible]);

  return (
    <main className="driving-login-experience" data-theme={theme} data-view={view} data-reduced-motion={reducedMotion} data-home-settled={homeSettled}>
      <CarStage theme={theme} view={view} paused={false} reducedMotion={reducedMotion} onViewSettled={onViewSettled} />
      <header className="topbar">
        <BrandLockup />
        <div className="top-controls">
          <button type="button" className="theme-toggle" role="switch" aria-checked={theme === "dark"} aria-label={theme === "light" ? tr("切换为深色模式") : tr("切换为明亮模式")} onClick={() => setTheme(theme === "light" ? "dark" : "light")}><span className="theme-thumb" /><span aria-hidden="true">☼</span><span aria-hidden="true">☾</span></button>
        </div>
      </header>

      <section className={"hero-copy" + (!homeVisible ? " is-away" : "")} aria-hidden={!homeVisible} inert={!homeVisible}>
        <div className="eyebrow"><span className="live-dot" /> IDEAS INTO ENGINEERING</div>
        <h1 className="slogan-window" aria-label={slogans[slogan].map(line => tr(line)).join("")}>
          {slogans.map((lines, index) => <span key={index} className={"slogan" + (index === slogan ? " is-active" : "")} aria-hidden={index !== slogan}><span>{tr(lines[0])}</span><span>{tr(lines[1])}</span></span>)}
        </h1>
        <p className="hero-description">{tr("少一点重复，多一点创造。")}<br />{tr("把复杂留给智能，把方向握在手中。")}</p>
        <div className="capability-line"><span>{tr("需求洞察")}</span><i /><span>{tr("智能协同")}</span><i /><span>{tr("工程可追溯")}</span></div>
        <div className="slogan-pagination" aria-label={tr("切换标语")}>{slogans.map((_, index) => <button type="button" key={index} aria-label={tr("第 ") + (index + 1) + tr(" 条标语")} aria-pressed={slogan === index} onClick={() => setSlogan(index)} className={index === slogan ? "active" : ""} />)}</div>
      </section>

      <DrivingLoginPanel active={view === "login"} onBack={back} />
      <div className={"entry-action" + (!homeVisible ? " is-away" : "")} aria-hidden={!homeVisible} inert={!homeVisible}><button type="button" ref={enter} className="primary-button enter-button" onClick={() => setView("login")}>{tr("前往工作区 ")}<span aria-hidden="true">→</span></button></div>

      <footer className="bottom-bar"><span className={"entry-hint home-footer-copy" + (!homeVisible ? " is-away" : "")} aria-hidden={!homeVisible}>{tr("让下一程，从这里开始")}</span><span className="footer-caption">BUILT FOR WHAT&apos;S NEXT.</span></footer>
      <span className="sr-only">3D model: Car Concept. <a href="/MODEL-LICENSE.txt" target="_blank" rel="noreferrer">Model source and license</a></span>
    </main>
  );
}

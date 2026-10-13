"use client";
import { useI18n } from "@/features/i18n/provider";
import { ModuleIcon } from "@/components/icons/module-icon";

export type LoadingKind = "prd" | "uc" | "fr" | "allocation" | "workspace" | "orbit";
export function LoadingIcon({ label, className = "" }: { label?: string; className?: string }) {
  return <span className={`loading-icon ${className}`} role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
export function LoadingDots() {
  return <span className="loading-dots" aria-hidden="true"><span /><span /><span /></span>;
}
const blueprintSteps = {
  uc: [{ name: "PRD", icon: "requirements" }, { name: "UC", icon: "architecture" }],
  fr: [{ name: "UC", icon: "architecture" }, { name: "FR", icon: "requirements" }],
  allocation: [{ name: "FR", icon: "requirements" }, { name: "子系统", icon: "product" }],
} as const;

/** Presentational only: never starts requests, timers, navigation, or retries. */
export function LoadingIllustration({ kind, label, compact = false }: { kind: LoadingKind; label?: string; compact?: boolean }) {
  const { t: tr } = useI18n();
  const defaults = { prd: "正在生成 PRD…", uc: "正在生成 UC…", fr: "正在生成 FR…", allocation: "正在生成 FR 分配…", workspace: "正在进入工作空间…", orbit: "正在准备工作空间" };
  return <div className={`loading-illustration${compact ? " is-compact" : ""}`} data-loading-kind={kind} role="status" aria-live="polite">
    <div className="loading-illustration-art" aria-hidden="true">
      {kind === "orbit" ? <><span className="loading-orbit outer" /><span className="loading-orbit" /><svg className="loading-orbit-core" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z" /><path d="M20 2v4M18 4h4" /></svg></> : kind === "prd" ? <><div className="loading-document loading-document-back" /><div className="loading-document"><ModuleIcon name="requirements" size={22} /><span className="loading-document-line" /><span className="loading-document-line" /><span className="loading-document-line" /><span className="loading-document-scan" /></div></> : kind === "workspace" ? <><div className="loading-car-road" /><span className="loading-car-beam left" /><span className="loading-car-beam right" /><svg className="loading-car" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="m3 8 2 2 1.5-3.7A2 2 0 0 1 8.35 5h7.3a2 2 0 0 1 1.85 1.3L19 10l2-2M5 10h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2ZM5 18v2M19 18v2M7 14h.01M17 14h.01" /></svg></> : <><div className="loading-blueprint-grid" /><div className="loading-blueprint-wire" />{blueprintSteps[kind].map((step, index) => <div key={step.name} className={`loading-blueprint-node node-${index}`}><ModuleIcon name={step.icon} size={24} /><span>{tr(step.name)}</span></div>)}</>}
    </div>
    <span className="loading-illustration-label">{label ?? tr(defaults[kind])}</span>
  </div>;
}

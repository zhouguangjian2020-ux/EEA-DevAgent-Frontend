"use client";
import { useEffect, useRef, useState } from "react";
import { LoadingIllustration } from "@/components/feedback/loading";
import { useI18n } from "@/features/i18n/provider";
import { requestRequirementDiagram, type RequirementDiagramResult } from "@/features/workbench/requirement-diagram-api";
import { createUuid } from "@/lib/uuid";
import { requirementCacheKey, type RequirementDiagramCache } from "@/features/panorama/requirement-cache";
import { DiagramEmptyState } from "@/components/feedback/diagram-empty-state";
import { MermaidDiagram } from "./mermaid-diagram";

type Props = { projectId: string; functionId: string; subsystemId: string; active: boolean; hasConfirmedAllocations: boolean; sourceKey?: string; cache?: RequirementDiagramCache };
export function RequirementDiagram({ projectId, functionId, subsystemId, active, hasConfirmedAllocations, sourceKey = "", cache }: Props) {
  const { t: tr } = useI18n();
  const cacheKey = requirementCacheKey(projectId, functionId, subsystemId, sourceKey);
  const [result, setResult] = useState<RequirementDiagramResult | null>(() => cache?.get(cacheKey) ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const completed = useRef<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const key = `${cacheKey}:${attempt}`;
  useEffect(() => {
    if (!active || !hasConfirmedAllocations || completed.current === key || (attempt === 0 && cache?.has(cacheKey))) return;
    const controller = new AbortController();
    pending.current = controller;
    // Deferring also avoids a duplicate Agent call during React StrictMode's setup probe.
    const timer = setTimeout(async () => {
      setBusy(true); setError("");
      try {
        const next = await requestRequirementDiagram({ projectId, functionId, subsystemId, clientRequestId: createUuid() }, controller.signal);
        if (!controller.signal.aborted) { setResult(next); cache?.set(cacheKey, next); completed.current = key; }
      } catch (e) {
        if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "需求图生成失败"); completed.current = key; }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
        if (pending.current === controller) pending.current = null;
      }
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [active, hasConfirmedAllocations, projectId, functionId, subsystemId, key, attempt, cache, cacheKey]);
  function stop() {
    pending.current?.abort(); pending.current = null; completed.current = key;
    setBusy(false); setError("已停止等待需求图；已发出的Agent推理不保证随之取消。");
  }
  if (!hasConfirmedAllocations) return <section className="workspace-card uc-agent-diagram" aria-label={tr("子系统需求图")}><header className="workspace-card-header uc-agent-diagram-header"><h2 className="workspace-card-title">{tr("子系统需求图")}</h2></header><DiagramEmptyState kind="requirement" /></section>;
  return <section className="workspace-card uc-agent-diagram" aria-label={tr("子系统需求图")}>
    <header className="workspace-card-header uc-agent-diagram-header"><div><h2 className="workspace-card-title">{tr("子系统需求图")}{result ? ` · ${result.source.subsystem_name}` : ""}</h2>
      <p>{tr("只读取所选子系统的已保存分配和对应FR版本；待确认分配不会被自动确认。")}</p></div>
      <div className="uc-agent-diagram-actions"><button type="button" className="button-secondary" disabled={busy || !active} onClick={() => setAttempt(value => value + 1)}>{tr(result ? "刷新需求图" : "重试生成")}</button>
        {busy && <button type="button" className="button-danger" onClick={stop}>{tr("停止")}</button>}</div>
    </header>
    {!busy && <div role="status" aria-live="polite" className="uc-agent-diagram-status">
      {result?.status === "empty" ? tr("此子系统在当前功能下没有已保存的FR分配。") : result ? tr("已生成需求图：{0}条FR，{1}条分配", { "0": result.source.fr_count, "1": result.source.allocation_count }) : tr("尚未取得需求图")}
    </div>}
    {error && <p role="alert">{tr(error)}{result?.diagram_code && tr("当前保留上次成功图，不代表最新结果。")}</p>}
    {busy && !result?.diagram_code && <LoadingIllustration kind="allocation" label={tr("正在请求Agent生成子系统需求图…")} compact />}
    {result?.diagram_code && <MermaidDiagram kind="requirement" code={result.diagram_code} attemptId={busy ? null : result.generation_id} label="子系统需求图" />}
  </section>;
}

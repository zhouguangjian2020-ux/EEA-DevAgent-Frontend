"use client";
import { DiagramEmptyState } from "@/components/feedback/diagram-empty-state";
import { LoadingIllustration, LoadingIcon } from "@/components/feedback/loading";
import { useI18n } from "@/features/i18n/provider";
import { useEffect, useRef } from 'react';
import { PanoramaHeader } from "./panorama-header";
import { hasConfirmedSubsystemAllocation, requirementSourceKey, type RequirementDiagramCache } from "@/features/panorama/requirement-cache";
import { RequirementDiagram } from "./requirement-diagram";
import { MermaidDiagram } from './mermaid-diagram';
import type { ReactNode } from "react";
import { panoramaTitle, type DiagramRow } from "@/features/panorama/model";
import { allocationSubsystemName, type PanoramaWork } from "@/features/workbench/model";
import type { FrContent } from "@/features/fr/model";
import { UcDiagram } from "./uc-diagram";
import { SubsystemSelect } from "./subsystem-select";
import "./panorama.css";

type Props = {
  projectId?: string;
  requirementCache?: RequirementDiagramCache;
  generating?: boolean;
  workflowActions?: ReactNode;
  headerActions?: ReactNode;
  ucActions?: ReactNode;
  reviewContent?: ReactNode;
  allocationReview?: ReactNode;
  ucTotalCount?: number;
  diagramSourceKey?: string;
  diagramBusy?: boolean;
  onRefreshDiagram?: (force?: boolean) => void;
  onStopDiagram?: () => void;
  work: PanoramaWork;
  ucs: DiagramRow[];
  frs: { workId: string; content: FrContent }[];
  active: boolean;
  onAssign: (frId: string, ids: string[]) => void;
};

function RemoteUcDiagram({ state, onRefresh, onStop, disabled }: { disabled?: boolean; state: Extract<PanoramaWork, { kind: "UC_OVERVIEW" }>["ucDiagram"]; onRefresh: () => void; onStop?: () => void }) {
  const { t: tr } = useI18n();
  const count = state.ucCount === null ? "待查询" : String(state.ucCount) + " 个";
  const actionLabel = state.status === "idle" ? "生成 UC 图" : "刷新 UC 图";
  const statusText = state.status === "loading" ? "正在读取已确认 UC 并请求 Agent 生成图代码…"
    : state.status === "error" ? (state.message ?? "UC 图生成失败，可重试。")
    : null;
  return <section className="uc-agent-diagram" aria-label={tr("UC 全景图")}>
    <header className="uc-agent-diagram-header">
      <div><strong>{tr("UC 全景图")}</strong><p>{tr("后端只发送当前功能下已确认的 UC；草稿和未确认候选不会进入图请求。")}</p></div>
      <div className="uc-agent-diagram-actions"><span className="uc-agent-count">{count}{tr(" 已确认 UC")}</span><button className="button-secondary" type="button" onClick={onRefresh} disabled={disabled || state.status === "loading" || state.status === "empty"}>{state.status === "loading" ? <><LoadingIcon />{tr("生成中…")}</> : tr(actionLabel)}</button>{state.status === "loading" && onStop && <button className="button-danger" type="button" onClick={onStop}>{tr("停止")}</button>}</div>
    </header>
    {statusText && (state.status !== "loading" || state.diagramCode) && <p className="uc-agent-diagram-feedback" role={state.status === "error" ? "alert" : "status"}>{state.status === "loading" && <LoadingIcon />}{tr(statusText)}</p>}
    {state.status === "loading" && !state.diagramCode && <LoadingIllustration kind="uc" label={tr(statusText!)} compact />}
    {state.diagramCode ? <><MermaidDiagram code={state.diagramCode} attemptId={state.status==='loading'?null:state.requestId}/>{state.status==='error'&&<p role='alert'>{tr("当前仍显示上次成功的图，尚未获取最新结果。")}</p>}</> : state.status==='empty'?<DiagramEmptyState kind="uc" />:null}

  </section>;
}

export function PanoramaWorkspace({ projectId, requirementCache, generating = false, work, ucs, frs, active, onAssign, ucActions, headerActions, onRefreshDiagram, onStopDiagram, workflowActions, reviewContent, ucTotalCount, diagramSourceKey, diagramBusy, allocationReview }: Props) {
  const { t: tr } = useI18n();
  const refreshRef=useRef(onRefreshDiagram);
  useEffect(()=>{refreshRef.current=onRefreshDiagram;},[onRefreshDiagram]);
  const lastDiagramSource = useRef<string | null>(null);
  const diagramStatus = work.kind === "UC_OVERVIEW" ? work.ucDiagram.status : null;
  useEffect(() => {
    if (!active) { lastDiagramSource.current = null; return; }
    if (work.kind !== "UC_OVERVIEW" || diagramBusy || diagramSourceKey === "") return;
    const source = work.id + "/" + (diagramSourceKey ?? "");
    if (diagramStatus === "loading") { if (lastDiagramSource.current === null) lastDiagramSource.current = source; return; }
    if (lastDiagramSource.current === source) return;
    lastDiagramSource.current = source; refreshRef.current?.(false);
  }, [active, work.id, work.kind, diagramSourceKey, diagramBusy, diagramStatus]);
  const uc = work.kind === "UC_OVERVIEW", title = panoramaTitle(work.kind), stage = uc ? "用例生成" : "功能分配", readOnly = Boolean(work.readOnly);
  const remoteDiagram = uc && Boolean(onRefreshDiagram);
  const diagramState = work.kind === "UC_OVERVIEW" && diagramSourceKey === "" ? {
    ...work.ucDiagram, status: "empty" as const, ucCount: 0, diagramCode: null, diagramFormat: null, sourceVersion: null,
  } : work.kind === "UC_OVERVIEW" ? work.ucDiagram : null;
  const count = uc ? (ucTotalCount ?? ucs.length) : frs.length;
  const allocation = work.kind === "FR_ALLOCATION_OVERVIEW" ? work : null;
  const isSubsystem = Boolean(allocation?.selectedSubsystemId && allocation.selectedSubsystemId !== "__empty__");
  const subsystemName = allocation?.selectedSubsystemId ? allocationSubsystemName(allocation, allocation.selectedSubsystemId, tr("子系统名称暂不可用")) : "";
  return <section className="panorama-workspace document-only" data-testid={uc ? "uc-overview-workspace" : "fr-allocation-workspace"}>
    <section className="panorama-main" aria-label={tr(title)}>
      <PanoramaHeader title={tr(isSubsystem ? "子系统全景" : title)} context={isSubsystem ? <>{work.featureName} / {subsystemName}</> : <>{work.featureName} / {tr(stage)} · {count} {uc ? tr("个 UC") : tr("条 FR")}</>} actions={headerActions} />
      {uc && generating && count > 0 && <p className="loading-result-status" role="status"><LoadingIcon />{tr("正在生成 UC…")}</p>}
      {uc && ucActions}
      {!isSubsystem && workflowActions}
      <div className={"panorama-body" + (uc && reviewContent ? " uc-review-layout" : allocation ? " allocation-review-layout" : "")}>
        {uc && generating && !count ? <LoadingIllustration kind="uc" /> : allocation && projectId ? (isSubsystem ? <><RequirementDiagram
          key={`${projectId}:${allocation.featureId}:${allocation.selectedSubsystemId}:${requirementSourceKey(allocation)}`}
          projectId={projectId} functionId={allocation.featureId} subsystemId={allocation.selectedSubsystemId!} active={active}
          hasConfirmedAllocations={hasConfirmedSubsystemAllocation(allocation)} sourceKey={requirementSourceKey(allocation)} cache={requirementCache} />{allocationReview}</>
          : allocationReview ?? <p role="status">{tr("正在读取分配清单…")}</p>) : remoteDiagram ? <RemoteUcDiagram state={diagramState!} disabled={diagramBusy} onRefresh={() => onRefreshDiagram?.(true)} onStop={onStopDiagram} /> : uc && !ucs.length ? <DiagramEmptyState kind="uc" /> : !count ? <div className="panorama-empty" role="status"><strong>{uc ? tr("还没有可展示的 UC") : tr("还没有可分配的 FR")}</strong><p>{uc ? tr("确认 UC 后，用例图将在此显示；待确认用例请在下方清单审阅。") : tr("请先在功能设计中生成 FR，再在这里选择预置子系统。")}</p></div> : <>
          <div className="panorama-status" role="status"><span>{uc ? tr("✓ 已根据当前业务功能下的 ") + count + tr(" 条 UC 自动生成") : count + tr(" 条 FR · 支持分配至多个子系统")}</span><small>{uc ? tr("无需手动绘制") : tr("仅下拉框可修改")}</small></div>
          {uc ? <UcDiagram featureName={work.featureName} rows={ucs} /> : <div className="allocation-table-scroll" tabIndex={0} aria-label={tr("FR 分配表格滚动区域")}><table className="allocation-table"><caption className="sr-only">{work.featureName}{tr(" · FR 分配清单；仅子系统名称可修改")}</caption><colgroup><col style={{ width: "14.76%" }} /><col style={{ width: "20.24%" }} /><col style={{ width: "37.86%" }} /><col style={{ width: "27.14%" }} /></colgroup><thead><tr><th scope="col">{tr("需求编号")}</th><th scope="col">{tr("需求来源")}</th><th scope="col">{tr("需求描述")}</th><th scope="col">{tr("子系统名称")}</th></tr></thead><tbody>{frs.map(({ workId, content }) => <tr key={workId} data-fr-id={workId}><td>{content.id}</td><td>{content.source}</td><td>{content.description}</td><td>{work.kind === "FR_ALLOCATION_OVERVIEW" && readOnly ? <span className="allocation-targets">{(work.assignments[workId] ?? []).map(id => allocationSubsystemName(work, id, tr("子系统名称暂不可用"))).join("、") || tr("未分配")}</span> : <SubsystemSelect number={content.id} value={work.kind === "FR_ALLOCATION_OVERVIEW" ? work.assignments[workId] ?? [] : []} onChange={ids => onAssign(workId, ids)} active={active} />}</td></tr>)}</tbody></table></div>}
          <footer className="panorama-notes">{uc ? <><div><span>{tr("实线：参与者与用例的关联")}</span><span>{tr("仅查看 · 节点不可编辑或点击")}</span></div><p>{tr("UC 生成后自动出图；修改用例内容请打开左侧 UC 对象，用例图随已保存内容同步更新。")}</p></> : <><p>{readOnly ? tr("子系统目录和 FR 分配来自数据库；当前高亮为该功能已使用的目标。") : tr("子系统来自预置清单；此处名称仅为设计演示。")}</p><p>{readOnly ? tr("当前项目子系统目录共 {0} 项；下方表格展示当前工作版本（可能待确认）；生成、调整与保存确认在上方面板操作。", { "0": work.kind === "FR_ALLOCATION_OVERVIEW" ? work.subsystems.length : 0 }) : tr("选择后更新当前行，不修改 FR 原文；无需进入编辑模式。当前选择仅在本页内保留。")}</p></>}</footer>
        </>}
        {uc && !(generating && !count) && reviewContent}
      </div>
    </section>
  </section>;
}


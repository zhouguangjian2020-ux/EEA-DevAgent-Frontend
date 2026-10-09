"use client";
import { useI18n } from "@/features/i18n/provider";
import { useEffect, useRef } from 'react';
import { MermaidDiagram } from './mermaid-diagram';
import type { ReactNode } from "react";
import { panoramaTitle, type DiagramRow } from "@/features/panorama/model";
import type { PanoramaWork } from "@/features/workbench/model";
import type { FrContent } from "@/features/fr/model";
import { UcDiagram } from "./uc-diagram";
import { SubsystemSelect } from "./subsystem-select";
import "./panorama.css";

type Props = {
  workflowActions?: ReactNode;
  headerActions?: ReactNode;
  ucActions?: ReactNode;
  onRefreshDiagram?: (force?: boolean) => void;
  onStopDiagram?: () => void;
  work: PanoramaWork;
  ucs: DiagramRow[];
  frs: { workId: string; content: FrContent }[];
  active: boolean;
  onAssign: (frId: string, ids: string[]) => void;
};

function RemoteUcDiagram({ state, onRefresh, onStop }: { state: Extract<PanoramaWork, { kind: "UC_OVERVIEW" }>["ucDiagram"]; onRefresh: () => void; onStop?: () => void }) {
  const { t: tr } = useI18n();
  const count = state.ucCount === null ? "待查询" : String(state.ucCount) + " 个";
  const actionLabel = state.status === "idle" ? "生成 UC 图" : "刷新 UC 图";
  const statusText = state.status === "loading" ? "正在读取已确认 UC 并请求 Agent 生成图代码…"
    : state.status === "empty" ? "当前功能没有已确认的 UC。"
    : state.status === "unchanged" ? "已确认 UC 未变化，沿用上次图代码。"
    : state.status === "error" ? (state.message ?? "UC 图生成失败，可重试。")
    : state.status === "succeeded" ? "UC 图代码已生成；可在下方查看图形与代码。"
    : "尚未请求 UC 图。打开本页或点击刷新后生成。";
  return <section className="uc-agent-diagram" aria-label={tr("Agent UC 图代码状态")}>
    <header className="uc-agent-diagram-header">
      <div><strong>{tr("UC 全景图")}</strong><p>{tr("后端只发送当前功能下已确认的 UC；草稿和未确认候选不会进入图请求。")}</p></div>
      <div className="uc-agent-diagram-actions"><span className="uc-agent-count">{count}{tr(" 已确认 UC")}</span><button className="button-secondary" type="button" onClick={onRefresh} disabled={state.status === "loading"}>{state.status === "loading" ? tr("生成中…") : actionLabel}</button>{state.status === "loading" && onStop && <button className="button-danger" type="button" onClick={onStop}>{tr("停止")}</button>}</div>
    </header>
    <div className={"uc-agent-diagram-status is-" + state.status} role="status" aria-live="polite"><span>{tr(statusText)}</span>{state.sourceVersion && <code title={tr("已确认 UC 来源版本")}>source_version: {state.sourceVersion}</code>}</div>
    {state.diagramCode ? <><MermaidDiagram code={state.diagramCode} attemptId={state.status==='loading'?null:state.requestId}/><details className='uc-agent-code'><summary>{tr("查看 Mermaid 图代码")}</summary><pre>{state.diagramCode}</pre></details>{state.status==='error'&&<p role='alert'>{tr("当前仍显示上次成功的图，尚未获取最新结果。")}</p>}</> : state.status==='empty'?<div className='uc-agent-no-code'>{tr("没有已确认UC，暂不生成图形。")}</div>:null}

  </section>;
}

export function PanoramaWorkspace({ work, ucs, frs, active, onAssign, ucActions, headerActions, onRefreshDiagram, onStopDiagram, workflowActions }: Props) {
  const { t: tr } = useI18n();
  const refreshRef=useRef(onRefreshDiagram);
  useEffect(()=>{refreshRef.current=onRefreshDiagram;},[onRefreshDiagram]);
  useEffect(()=>{if(active&&work.kind==='UC_OVERVIEW')refreshRef.current?.(false);},[active,work.id,work.kind]);
  const uc = work.kind === "UC_OVERVIEW", title = panoramaTitle(work.kind), stage = uc ? "用例生成" : "功能分配", readOnly = Boolean(work.readOnly);
  const remoteDiagram = uc && Boolean(onRefreshDiagram);
  const count = uc ? ucs.length : frs.length;
  const allocation = work.kind === "FR_ALLOCATION_OVERVIEW" ? work : null;
  const subsystemUsage = new Map<string, number>();
  if (allocation) {
    for (const subsystemIds of Object.values(allocation.assignments)) {
      for (const subsystemId of subsystemIds) subsystemUsage.set(subsystemId, (subsystemUsage.get(subsystemId) ?? 0) + 1);
    }
  }
  return <section className="panorama-workspace document-only" data-testid={uc ? "uc-overview-workspace" : "fr-allocation-workspace"}>
    <section className="panorama-main" aria-label={tr(title)}>
      <header className="panorama-toolbar"><div><h1>{tr(title)}</h1><p>{work.featureName} / {tr(stage)} · {remoteDiagram ? (work.kind === "UC_OVERVIEW" && work.ucDiagram.ucCount === null ? tr("待查询") : String(work.kind === "UC_OVERVIEW" ? work.ucDiagram.ucCount : count) + tr(" 个 UC")) : String(count) + " " + (uc ? tr("个 UC") : tr("条 FR"))}</p></div><span className="panorama-readonly">{readOnly ? (workflowActions ? tr("数据库 · 工程审阅") : tr("只读 · 数据库数据")) : uc ? tr("只读 · 自动生成") : tr("仅「子系统名称」可修改")}</span>{headerActions}</header>
      {uc && ucActions}
      {workflowActions}
      <div className="panorama-body">
        {remoteDiagram ? <RemoteUcDiagram state={work.ucDiagram} onRefresh={() => onRefreshDiagram?.(true)} onStop={onStopDiagram} /> : !count ? <div className="panorama-empty" role="status"><strong>{uc ? tr("还没有可展示的 UC") : tr("还没有可分配的 FR")}</strong><p>{uc ? tr("手动新建或生成 UC 后，用例图将在此自动出现，无需手动绘制。") : tr("请先在功能设计中生成 FR，再在这里选择预置子系统。")}</p></div> : <>
          <div className="panorama-status" role="status"><span>{uc ? tr("✓ 已根据当前业务功能下的 ") + count + tr(" 条 UC 自动生成") : count + tr(" 条 FR · 支持分配至多个子系统")}</span><small>{uc ? tr("无需手动绘制") : tr("仅下拉框可修改")}</small></div>
          {uc ? <UcDiagram featureName={work.featureName} rows={ucs} /> : <div className="allocation-table-scroll" tabIndex={0} aria-label={tr("FR 分配表格滚动区域")}><table className="allocation-table"><caption className="sr-only">{work.featureName}{tr(" · FR 分配清单；仅子系统名称可修改")}</caption><colgroup><col style={{ width: "14.76%" }} /><col style={{ width: "20.24%" }} /><col style={{ width: "37.86%" }} /><col style={{ width: "27.14%" }} /></colgroup><thead><tr><th scope="col">{tr("需求编号")}</th><th scope="col">{tr("需求来源")}</th><th scope="col">{tr("需求描述")}</th><th scope="col">{tr("子系统名称")}</th></tr></thead><tbody>{frs.map(({ workId, content }) => <tr key={workId} data-fr-id={workId}><td>{content.id}</td><td>{content.source}</td><td>{content.description}</td><td>{work.kind === "FR_ALLOCATION_OVERVIEW" && readOnly ? <span className="allocation-targets">{(work.assignments[workId] ?? []).map(id => work.subsystems.find(subsystem => subsystem.id === id)?.name ?? id).join("、") || tr("未分配")}</span> : <SubsystemSelect number={content.id} value={work.kind === "FR_ALLOCATION_OVERVIEW" ? work.assignments[workId] ?? [] : []} onChange={ids => onAssign(workId, ids)} active={active} />}</td></tr>)}</tbody></table></div>}
          {allocation && readOnly && <section className="subsystem-directory" aria-label={tr("项目子系统目录")}>
            <header><div><h2>{tr("项目子系统目录")}</h2><p>{tr("共 ")}{allocation.subsystems.length}{tr(" 项；高亮表示至少有一条当前 FR 已分配到该子系统。")}</p></div><span>{subsystemUsage.size}{tr(" 项已使用")}</span></header>
            <ul>{allocation.subsystems.map(subsystem => { const usage = subsystemUsage.get(subsystem.id) ?? 0; return <li key={subsystem.id} className={usage ? "is-used" : undefined}><span><strong>{subsystem.code}</strong>{subsystem.name}</span><small>{usage ? tr("已分配 {0} 条 FR", { "0": usage }) : tr("当前未使用")}</small></li>; })}</ul>
          </section>}          <footer className="panorama-notes">{uc ? <><div><span>{tr("实线：参与者与用例的关联")}</span><span>{tr("仅查看 · 节点不可编辑或点击")}</span></div><p>{tr("UC 生成后自动出图；修改用例内容请打开左侧 UC 对象，用例图随已保存内容同步更新。")}</p></> : <><p>{readOnly ? tr("子系统目录和 FR 分配来自数据库；当前高亮为该功能已使用的目标。") : tr("子系统来自预置清单；此处名称仅为设计演示。")}</p><p>{readOnly ? tr("当前项目子系统目录共 {0} 项；下方表格展示当前工作版本（可能待确认）；生成、调整与保存确认在上方面板操作。", { "0": work.kind === "FR_ALLOCATION_OVERVIEW" ? work.subsystems.length : 0 }) : tr("选择后更新当前行，不修改 FR 原文；无需进入编辑模式。当前选择仅在本页内保留。")}</p></>}</footer>
        </>}
      </div>
    </section>
  </section>;
}


"use client";
import { LoadingIllustration } from "@/components/feedback/loading";
import { useI18n } from "@/features/i18n/provider";
import { AppendFrPanel } from "./append-fr-panel";
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createUuid } from "@/lib/uuid";
import { startTaskFeedback } from "@/features/workbench/task-feedback";
import type { AllocationSubsystem } from "@/features/workbench/model";
import { getProjectWorkspace, type WorkspaceFunction } from "@/lib/api/client";
import { confirmAllocationBatch } from "@/features/workbench/batch-review";
import { workflowPost, projectPath, type Generation, type AllocationCandidate } from "@/features/workbench/workflow-api";
import { allocationPreview, mergeSavedAllocationRows,
  type AllocationRow, type AllocationPreview, type AllocationReviewTarget } from "@/features/workbench/allocation-review";
import { AllocationReviewTable } from "../panorama/allocation-review-table";
import "./workflows.css";

type AllocationProps = {
  mode: "allocation"; project: string; featureId: string; active: boolean; blockedReason?: string;
  onSaved: () => Promise<Awaited<ReturnType<typeof getProjectWorkspace>>>; getTaskThread?: () => string; onGenerated?: (originThread?: string) => void;
  onPreviewsChange?: (previews: AllocationPreview[], subsystems?: AllocationSubsystem[]) => void;
  onOpenObject?: (id: string) => void;
  render?: (actions: ReactNode, content: (visible: boolean, subsystemId?: string) => ReactNode, feedback?: ReactNode) => ReactNode;
};
function AllocationPanel({ project, featureId, active, onSaved, blockedReason, getTaskThread, onGenerated,
  onPreviewsChange, onOpenObject, render }: AllocationProps) {
  const { t: tr } = useI18n();
  const [feature, setFeature] = useState<WorkspaceFunction>(), [caps, setCaps] = useState<string[]>([]);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [generating, setGenerating] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null), running = useRef(false);
  const previewsCallback = useRef(onPreviewsChange);
  useEffect(() => { previewsCallback.current = onPreviewsChange; }, [onPreviewsChange]);
  useEffect(() => {
    // Allocation can initialize a legacy project's catalogue after the shell loaded.
    // Publish its real labels together with previews, including catalogue-only updates.
    const subsystems = feature?.subsystems.map(item => ({ id: item.id, code: item.code, name: item.name,
      domainGroup: item.domain_group, isAllocatable: item.is_allocatable }));
    previewsCallback.current?.(allocationPreview(allocations), subsystems);
  }, [allocations, feature]);
  const dirty = allocations.some(row => row.dirty);
  const path = projectPath(project) + "/functions/" + featureId;
  const applyWorkspace = useCallback((ws: Awaited<ReturnType<typeof getProjectWorkspace>>, discard = false) => {
    const f = ws.functions.find(item => item.id === featureId);
    setFeature(f); setCaps(f?.workflow_capabilities ?? ws.capabilities ?? []);
    setAllocations(current => mergeSavedAllocationRows(discard ? [] : current, f?.fr_allocations ?? []));
    return f;
  }, [featureId]);
  const reload = useCallback(async (discard = false) => applyWorkspace(await getProjectWorkspace(project), discard), [project, applyWorkspace]);
  useEffect(() => {
    let alive = true;
    if (active) getProjectWorkspace(project).then(ws => { if (alive) applyWorkspace(ws); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : "操作失败"); });
    return () => { alive = false; };
  }, [active, project, applyWorkspace]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const guard = (event: Event) => {
      const e = event as CustomEvent<{ project: string; featureId: string; mode: string }>;
      if (e.detail.project === project && e.detail.featureId === featureId && e.detail.mode === "allocation" && (dirty || busy)
        && !window.confirm(tr(busy ? "请求尚在进行，关闭会停止等待。继续？" : "关闭将丢弃未保存候选，原业务内容不变。继续？"))) event.preventDefault();
    };
    window.addEventListener("workflow-before-close", guard);
    return () => window.removeEventListener("workflow-before-close", guard);
  }, [project, featureId, dirty, busy, tr]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, busy]);
  async function task<T>(operation: () => Promise<T>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setNotice("");
    try { return await operation(); }
    catch (e) { setError(e instanceof Error && e.name === "AbortError" ? "已停止等待；已提交结果请读取已保存分配核对。" : e instanceof Error ? e.message : "操作失败"); }
    finally { running.current = false; setBusy(false); controller.current = null; setGenerating(false); }
  }
  function generate() {
    if (blockedReason) { setError(blockedReason); return; }
    if (dirty && !window.confirm(tr("重新生成将替换本页未保存候选，已有正式内容不变。继续？"))) return;
    void task(async () => {
      const c = new AbortController(); controller.current = c; setGenerating(true); const requestId = createUuid();
      const originThread = getTaskThread?.();
      const feedback = startTaskFeedback(project, originThread, requestId, "FR_ALLOCATION", featureId, feature?.name);
      try {
        const result = await workflowPost<Generation<AllocationCandidate>>(path + "/allocation-generations",
          { client_request_id: requestId, thread_id: originThread }, c.signal);
        if (c.signal.aborted) return;
        if (result.generation_id !== requestId || !Array.isArray(result.candidates) || !result.candidates.length) throw new Error("候选结果身份异常");
        feedback.complete(result.candidates.length);
        const f = await reload();
        if (c.signal.aborted) return;
        const rows = result.candidates.map(row => {
          const previous = f?.fr_allocations.find(item => item.fr_id === row.fr_id);
          return { ...row, note: row.note || row.unmatched_reason, design: result.source.subsystems[0]?.design_version_id ?? "",
            sourceVersion: result.source_version, allocationId: previous?.id ?? createUuid(), base: previous?.revision.revision_id ?? null,
            dirty: true, mutation: createUuid(), acceptId: createUuid() };
        });
        setAllocations(mergeSavedAllocationRows(rows, f?.fr_allocations ?? []));
        setNotice("分配建议已更新到FR分配全景表格；请审阅子系统后保存或批量确认。");
        onGenerated?.(originThread);
      } finally { feedback.unresolved(); }
    });
  }
  function loadExisting() {
    if (dirty && !window.confirm(tr("放弃当前未保存候选并读取已保存分配？"))) return;
    void task(async () => { await reload(true); setNotice("已读取保存的分配。"); });
  }
  const updateAllocation = (id: string, patch: Partial<AllocationRow>) => setAllocations(rows => rows.map(row => row.candidate_id === id
    ? { ...row, ...patch, dirty: true, accepted: false, mutation: createUuid() } : row));
  async function refreshSaved() {
    try { applyWorkspace(await onSaved()); }
    catch { setError("提交结果已保留，但目录刷新失败；请读取已保存分配核对。"); }
  }
  const confirmAllocations = (targets: AllocationReviewTarget[]) => task(async () => {
    const c = new AbortController(); controller.current = c;
    const result = await confirmAllocationBatch(project, featureId, targets,
      id => allocations.find(row => row.candidate_id === id), caps, (submitted, receipt) => {
        if (!receipt.saved && !receipt.accepted) return;
        setAllocations(rows => rows.map(row => row.candidate_id === submitted.candidate_id && row.mutation === submitted.mutation
          ? { ...row, base: receipt.revision_id!, savedRevision: receipt.revision_id!, dirty: false, accepted: receipt.accepted } : row));
      }, c.signal);
    if (!c.signal.aborted) await refreshSaved();
    return result;
  });
  const permitted = caps.includes("FR_ALLOCATION.create");
  const actions = <div className="allocation-generation-actions">
    <button type="button" className="button-primary" disabled={busy || !permitted || Boolean(blockedReason)}
      onClick={generate}>{busy ? tr("处理中…") : tr("一键生成FR分配")}</button>
    {generating && <button type="button" className="button-secondary" onClick={() => controller.current?.abort()}>{tr("停止等待")}</button>}
  </div>;
  const feedback = (!permitted || error || notice) ? <>
    {!permitted && <p>{tr("无生成权限或业务写入未启用；不会使用Mock替代真实结果。")}</p>}
    {error && <p role="alert">{tr(error)}{tr(" 原输入已保留；可核对后重试。")}</p>}
    {notice && <p role="status">{tr(notice)}</p>}
  </> : undefined;
  const content = (visible: boolean, subsystemId?: string) => <>
    {feedback && <div className="panorama-generation-feedback">{feedback}</div>}
    {generating && !allocations.length ? <LoadingIllustration kind="allocation" /> : <AllocationReviewTable key={subsystemId ?? "all"} subsystemId={subsystemId} rows={allocations} feature={feature} capabilities={caps} active={active && visible} busy={busy} onOpenObject={onOpenObject}
      onChangeTargets={(id, ids) => {
        const row = allocations.find(item => item.candidate_id === id);
        if (!row || busy || !caps.includes(row.base ? "FR_ALLOCATION.update" : "FR_ALLOCATION.create")) return;
        updateAllocation(id, { unmatched_reason: ids.length ? "" : row.unmatched_reason, targets: ids.map(subsystem_id => row.targets.find(target => target.subsystem_id === subsystem_id) ?? { subsystem_id, rationale: "" }) });
      }} onConfirm={confirmAllocations} onReload={loadExisting} />}
  </>;
  return render ? render(actions, content, feedback) : <>{actions}{content(active)}</>;

}
export function WorkflowPanel(props: AllocationProps | (ComponentProps<typeof AppendFrPanel> & { mode: "fr" })) {
  return props.mode === "fr" ? <AppendFrPanel {...props} /> : <AllocationPanel {...props} />;
}

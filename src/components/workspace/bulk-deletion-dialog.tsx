"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError, deleteResources, getBulkDeletionImpact, type BulkDeletionImpact, type BulkDeletionInput, type BulkDeletionResult } from "@/lib/api/client";
import { createUuid } from "@/lib/uuid";
import type { WorkspaceDeletion } from "@/features/workspace/tree";
import { deletionKey } from "@/features/workspace/deletion";
import { WorkDialog } from "../workbench/work-dialog";

export function BulkDeletionDialog({ projectId, targets, onClose, onDeleted }: {
  projectId: string; targets: WorkspaceDeletion[]; onClose: () => void; onDeleted: (result: BulkDeletionResult) => void;
}) {
  const [impact, setImpact] = useState<BulkDeletionImpact | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<BulkDeletionInput | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    let alive = true;
    void getBulkDeletionImpact(projectId, targets).then(value => { if (alive) setImpact(value); }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "批量检查失败，请重试。"); });
    return () => { alive = false; };
  }, [projectId, targets, retry]);
  async function submit() {
    if (submitting.current || !impact || impact.blocked || !impact.can_delete) return;
    const input = attempt ?? { mutation_id: createUuid(), items: impact.items.map(({ target }) => ({ id: target.id, kind: target.kind as WorkspaceDeletion["kind"], base_lock_version: target.lock_version })) };
    submitting.current = true; setAttempt(input); setBusy(true); setError("");
    try { onDeleted(await deleteResources(projectId, input)); }
    catch (cause) {
      setError((cause instanceof Error ? cause.message : "请求失败") + " 原选择和未保存输入均保留。");
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 408) { setAttempt(null); setImpact(null); }
    } finally { submitting.current = false; setBusy(false); }
  }
  const loading = !impact && !error;
  const name = (kind: string) => kind === "function" ? "功能" : kind === "FR_ALLOCATION" ? "FR分配" : kind;
  const counts = targets.reduce<Record<string, number>>((all, item) => ({ ...all, [name(item.kind)]: (all[name(item.kind)] ?? 0) + 1 }), {});
  return <WorkDialog title={impact?.blocked ? "暂不能批量删除" : "删除所选对象"} onClose={busy || attempt ? () => undefined : onClose}>
    <div className="deletion-dialog" aria-busy={busy || loading}>
      <p><strong>已选 {targets.length} 项</strong> · {Object.entries(counts).map(([type, count]) => `${type} ${count}`).join(" / ")}</p>
      <p>只删除明确选中的对象，不自动勾选功能下内容。同一事务提交；任一对象校验失败，整批不删除。</p>
      <ul className="deletion-selection">{targets.map(item => <li key={deletionKey(item)}>{name(item.kind)} · {item.label}{item.hasUnsavedChanges && <strong className="deletion-warning">（含未保存输入，成功删除将丢弃）</strong>}</li>)}</ul>
      {loading && <p role="status">正在检查整批依赖和版本…</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      {attempt && !busy && <p role="status">结果尚未核实，请重试原批次。操作标识、对象集合和版本不会改变；核实前暂不能关闭。</p>}
      {impact?.blocked && <p role="alert">存在未选中的活动依赖，整批不能删除。请返回调整选择。</p>}
      {impact && <ul className="deletion-blockers">{impact.items.filter(item => item.blocked).map(item => <li key={item.target.id}><strong>{name(item.target.kind)} · {item.target.code}：{item.blocker_count} 个批次外依赖</strong><ul>{item.blockers.map(blocker => <li key={blocker.id}>{name(blocker.kind)} · {blocker.code} — {blocker.reason}</li>)}</ul>{item.blockers_truncated && <span>其余 {item.blocker_count - item.blockers.length} 个依赖未展开，提交仍会检查全部。</span>}</li>)}</ul>}
      {impact?.items.filter(item => item.target.kind === "FR_ALLOCATION").map(item => <section key={item.target.id}><strong>FR分配 · {item.target.code} 的全部影响目标</strong><p>{item.allocation_targets.length ? item.allocation_targets.map(t => `${t.subsystem_code} · ${t.subsystem_name}`).join("、") : "未选择子系统"}</p></section>)}
      <p>分配删除会移除该分配的全部目标关系，不删除 FR 或项目子系统目录。历史保留，不提供恢复。</p>
      {impact && !impact.can_delete && <p role="alert">批次中有对象无删除权限，整批不能提交。</p>}
      <div className="dialog-actions"><button className="button-secondary" disabled={busy || Boolean(attempt)} onClick={onClose}>返回调整</button>
        {!impact && !loading && <button className="button-primary" onClick={() => { setError(""); setRetry(value => value + 1); }}>重新检查</button>}
        {impact && !impact.blocked && <button className="button-danger" disabled={busy || !impact.can_delete} onClick={() => void submit()}>{busy ? "整批删除中…" : attempt ? "重试原批次" : `确认删除 ${targets.length} 项`}</button>}
      </div>
    </div>
  </WorkDialog>;
}


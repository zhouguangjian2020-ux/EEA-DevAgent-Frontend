"use client";
import { useI18n } from "@/features/i18n/provider";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceObject } from "@/features/workspace/tree";
import type { DeletionBlocker, DeletionImpact, DeletionKind } from "@/lib/api/client";
import { ApiError, deleteResource, getDeletionImpact } from "@/lib/api/client";
import { createUuid } from "@/lib/uuid";
import { WorkDialog } from "@/components/workbench/work-dialog";

export type DeletionTarget = {
  kind: DeletionKind;
  id: string;
  lockVersion?: string;
  canDelete?: boolean;
  label: string;
  featureId?: string;
  workId?: string;
  featureName?: string;
  hasUnsavedChanges?: boolean;
};

type Props = {
  projectId: string;
  target: DeletionTarget;
  databaseMode: boolean;
  onClose: () => void;
  onDeleted: (result: { id: string; kind: DeletionKind; featureId?: string; workId?: string }) => void;
};

function typeLabel(kind: DeletionKind) {
  return kind === "project" ? "项目" : kind === "function" ? "功能" : kind === "FR_ALLOCATION" ? "FR分配" : kind;
}
function blockerLabel(blocker: DeletionBlocker) {
  return `${typeLabel(blocker.kind as DeletionKind)} ${blocker.code}`;
}

function localImpact(projectId: string, target: DeletionTarget): DeletionImpact {
  return {
    target: { id: target.id, project_id: projectId, kind: target.kind, code: target.label, name: target.label, lock_version: target.lockVersion ?? "0" },
    can_delete: Boolean(target.canDelete), blocked: false, blocker_count: 0, blockers: [], blockers_truncated: false,
    allocation_targets: [], history_preserved: true, checked_versions: [],
  };
}
export function DeletionDialog({ projectId, target, databaseMode, onClose, onDeleted }: Props) {
  const { t: tr } = useI18n();
  const [impact, setImpact] = useState<DeletionImpact | null>(() => databaseMode ? null : localImpact(projectId, target));
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState<{ id: string; version: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const alive = useRef(true);
  const submitted = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!databaseMode) return;
    let active = true;
    void getDeletionImpact(projectId, target).then(value => { if (active && alive.current) setImpact(value); }).catch(cause => { if (active && alive.current) setError(cause instanceof Error ? cause.message : "删除影响读取失败，请重试。"); });
    return () => { active = false; };
  }, [databaseMode, projectId, target, retry]);

  async function remove() {
    if (!databaseMode || submitted.current || !impact || loading || deleting || !impact.can_delete || impact.blocked) return;
    const input = attempt ?? { id: createUuid(), version: impact.target.lock_version };
    setAttempt(input); setDeleting(true); setError(""); submitted.current = true;
    try {
      const result = await deleteResource(projectId, target, input.id, input.version);
      onDeleted({ id: result.id, kind: result.kind, featureId: target.featureId, workId: target.workId });
    } catch (cause) {
      submitted.current = false; setDeleting(false);
      const message = cause instanceof ApiError && cause.status === 409 ? `${cause.message} 工作空间未刷新，原对象和未保存输入已保留。` : cause instanceof Error ? `${cause.message} 原对象和未保存输入已保留。` : "删除失败，原对象和未保存输入已保留。";
      setError(message);
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 408) { setAttempt(null); setImpact(null); }
    }
  }

  const loading = databaseMode && !impact && !error;
  const allocation = target.kind === "FR_ALLOCATION";
  const title = impact?.blocked ? "暂不能删除" : `删除${typeLabel(target.kind)}`;
  return <WorkDialog title={title} onClose={deleting || attempt ? () => undefined : onClose}>
    <div className="deletion-dialog" aria-busy={loading || deleting}>
      <p><strong>{target.label}</strong></p>
      {loading && <p role="status">{tr("正在检查引用和当前版本…")}</p>}
      {!loading && error && <div role="alert" className="error-message">{tr(error)}</div>}
      {attempt && !deleting && <p role="status">{tr("结果尚未核实。请重试原删除请求，操作标识和版本均保持不变；核实前暂不能关闭。")}</p>}
      {!loading && !impact && <div className="dialog-actions"><button className="button-secondary" onClick={onClose}>{tr("关闭")}</button><button className="button-primary" onClick={() => { setError(""); setRetry(value => value + 1); }}>{tr("重新检查")}</button></div>}
      {!loading && impact && <>
        {impact.blocked ? <>
          <p role="alert">{tr("该对象仍被其他活动对象引用，当前不能删除。请先处理下面的依赖对象。")}</p>
          <ul className="deletion-blockers">{impact.blockers.map(blocker => <li key={`${blocker.kind}-${blocker.id}`}><strong>{blockerLabel(blocker)}</strong><span>{blocker.reason}{blocker.reference_versions.length ? tr("（{0}）", { "0": blocker.reference_versions.map(v => v === "head" ? "当前工作版" : v === "accepted" ? "当前确认版" : "对象关联").join("、") }) : ""}</span></li>)}</ul>
          {impact.blockers_truncated && <p className="form-hint">{tr("还有 ")}{impact.blocker_count - impact.blockers.length}{tr(" 个依赖未展开。")}</p>}
        </> : <>
          <p>{tr("删除后将从工作空间中移除这个活动对象，历史正文和审计记录保留，当前页面不提供恢复。")}</p>
          {target.hasUnsavedChanges && <p className="deletion-warning" role="alert">{tr("当前对象有未保存输入，删除会一并丢弃这些输入。")}</p>}
          {target.kind === "PRD" && <p>{tr("删除后可以为该功能新建一份全新的 PRD。")}</p>}
          {allocation && <>
            <p>{tr("这只会删除 FR 分配对象，不会删除 FR，也不会删除项目子系统目录。")}</p>
            {!!impact.allocation_targets.length && <ul className="deletion-targets">{impact.allocation_targets.map(item => <li key={`${item.subsystem_id}-${item.subsystem_name}`}>{item.subsystem_code} · {item.subsystem_name}{item.reference_versions.length ? tr("（{0}）", { "0": item.reference_versions.map(v => v === "head" ? "当前工作版" : "当前确认版").join("、") }) : ""}</li>)}</ul>}
            {!impact.allocation_targets.length && <p className="form-hint">{tr("该分配当前未选择子系统。")}</p>}
          </>}
        </>}
        <div className="dialog-actions"><button type="button" className="button-secondary" disabled={deleting || Boolean(attempt)} onClick={onClose}>{tr("关闭")}</button>{!impact.blocked && <button type="button" className="button-danger" disabled={deleting || !impact.can_delete} title={!impact.can_delete ? tr("当前账号无删除权限或业务写入未启用") : ""} onClick={() => void remove()}>{deleting ? tr("删除中…") : attempt ? tr("重试原删除请求") : tr("确认删除")}</button>}</div>
        {!impact.can_delete && <p className="form-hint">{tr("当前账号没有删除权限或业务写入尚未启用。")}</p>}
      </>}
    </div>
  </WorkDialog>;
}

export function deletionTargetFromObject(object: WorkspaceObject): DeletionTarget | null {
  if (!object.deletion) return null;
  return { ...object.deletion, kind: object.deletion.kind as DeletionKind };
}






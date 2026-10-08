"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError, createProject, type CreateProjectInput, type ProjectSummary } from "../../lib/api/client";
import { createUuid } from "@/lib/uuid";
import { projectFormError, projectSubmission } from "../../features/projects/model";
import "./project-dialog.css";
import { ProjectInfo, type ProjectInfoGuard, type ProjectListItem } from "./project-info";
import { DeletionDialog, type DeletionTarget } from "../workspace/deletion-dialog";

type Props = {
  open: boolean;
  currentProject: string;
  items: ProjectListItem[];
  databaseMode?: boolean;
  onUpdated: (project: ProjectSummary) => void;
  canCreate: boolean;
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  onClose: () => void;
  onSwitch: (id: string) => void;
  onCreated: (project: ProjectSummary) => void;
  onDeletedProject: (projectId: string) => void;
};

export function ProjectDialog({ open, currentProject, items, canCreate, hasMore, onLoadMore, onClose, onSwitch, onCreated, onUpdated, onDeletedProject, databaseMode = false }: Props) {
  const [view, setView] = useState<"list" | "create" | "details">("list");
  const [info, setInfo] = useState<ProjectListItem | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [deletionTarget, setDeletionTarget] = useState<DeletionTarget | null>(null);
  const [infoGuard, setInfoGuard] = useState<ProjectInfoGuard>({ busy: false, dirty: false, unresolved: false });
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [attempt, setAttempt] = useState<CreateProjectInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const submitting = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    dialog.current?.focus();
    return () => { if (previousFocus instanceof HTMLElement) previousFocus.focus(); };
  }, [open]);

  // Warn before navigating away while an unresolved request/form could be lost.
  useEffect(() => {
    if (!name && !description && !attempt) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [name, description, attempt]);

  function close() {
    if (submitting.current || (view === "details" && infoGuard.busy)) return;
    if (view === "details" && (infoGuard.dirty || infoGuard.unresolved) && !window.confirm("有未保存输入或尚待核对的保存结果。关闭后请重新读取核对，确定关闭？")) return;
    if (!attempt && (name || description) && !window.confirm("关闭将放弃尚未提交的项目信息，确定关闭？")) return;
    // Uncertain requests survive closing/reopening this dialog in the same page.
    if (!attempt) { setName(""); setDescription(""); setError(""); }
    setSelected(null); setInfo(null); setMenu(null); setView("list"); setListError(""); onClose();
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (deletionTarget) return;
    if (event.key === "Escape") { event.preventDefault(); if (menu) setMenu(null); else close(); }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex='0']") ?? []);
    const first = focusable[0], last = focusable.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !canCreate) return;
    const invalid = projectFormError(name, description);
    if (!attempt && invalid) { setError(invalid); return; }
    const input = attempt ?? projectSubmission(createUuid(), name, description);
    submitting.current = true; setSaving(true); setAttempt(input); setError("");
    try {
      const project = await createProject(input);
      setName(""); setDescription(""); setAttempt(null); setView("list"); setSelected(null);
      onCreated(project);
    } catch (cause) {
      const definiteRejection = cause instanceof ApiError && [401, 403, 415, 422].includes(cause.status);
      if (definiteRejection) setAttempt(null);
      setError(cause instanceof ApiError ? cause.message : "暂时无法确认创建结果。请保留原表单并点击“重试并进入”，不会重复创建。");
    } finally { submitting.current = false; setSaving(false); }
  }

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true); setListError("");
    try { await onLoadMore(); }
    catch (cause) { setListError(cause instanceof Error ? cause.message : "加载失败，请重试"); }
    finally { setLoadingMore(false); }
  }

  if (!open) return null;
  const pendingProject = selected ?? currentProject;
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialog} className="project-dialog project-dialog-picker" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" aria-busy={saving || (view === "details" && infoGuard.busy)} tabIndex={-1} onKeyDown={keyboard}>
      <div className="project-dialog-heading">
        <h2 id="project-dialog-title">{view === "list" ? "切换项目" : view === "details" ? "项目信息" : "新增项目"}</h2>
        <div className="project-heading-actions">
          {view === "list" && canCreate && <button className="button-secondary" onClick={() => { setView("create"); setListError(""); }}>＋ 新增项目</button>}
          <button className="close-button" aria-label="关闭项目窗口" disabled={saving || (view === "details" && infoGuard.busy)} onClick={close}>×</button>
        </div>
      </div>
      {view === "list" ? <>
        <p>请选择要进入的项目，确认后将同步切换对应工作空间。</p>
        {attempt && <p role="status">有一笔创建请求待确认。点击“新增项目”可用原请求重试，不会重复创建。</p>}
        {!items.length && <p className="project-empty">暂无可访问的项目。{canCreate ? "可以新增你的第一个项目。" : "当前未开放新增权限，请联系维护人员。"}</p>}
        <div className="project-options" role="group" aria-label="项目列表">{items.map(item => <div className="project-option-row" key={item.id}>
          <button className={pendingProject === item.id ? "project-option selected" : "project-option"} aria-pressed={pendingProject === item.id} onClick={() => { setSelected(item.id); setMenu(null); }}><span className="project-mark">{Array.from(item.name)[0]}</span><span>{item.name}<small>{item.code}</small></span><span>{pendingProject === item.id ? "✓" : ""}</span></button>
          <button className="project-more" aria-label={item.name + "更多操作"} aria-expanded={menu === item.id} onClick={() => setMenu(menu === item.id ? null : item.id)}>⋯</button>
          {menu === item.id && <div className="project-row-actions"><button onClick={() => { setInfo(item); setInfoGuard({ busy: databaseMode, dirty: false, unresolved: false }); setView("details"); setMenu(null); }}>查看项目信息</button>{databaseMode && <button className="danger" disabled={!item.can_delete} title={!item.can_delete ? "当前账号无删除权限或业务写入未启用" : ""} onClick={() => { if (!item.can_delete) return; setDeletionTarget({ kind: "project", id: item.id, lockVersion: item.lock_version, canDelete: item.can_delete, label: item.name }); setMenu(null); }}>删除项目</button>}</div>}
        </div>)}</div>
        {listError && <div role="alert" className="error-message">{listError}</div>}
        {hasMore && <button className="button-secondary project-load-more" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "加载中…" : "加载更多"}</button>}
        <div className="dialog-actions"><button className="button-secondary" onClick={close}>取消</button><button className="button-primary" disabled={!pendingProject || pendingProject === currentProject} onClick={() => { setSelected(null); onSwitch(pendingProject); }}>确认切换</button></div>
      </> : view === "details" && info ? <ProjectInfo key={info.id} item={info} database={databaseMode} onUpdated={onUpdated} onGuardChange={setInfoGuard} onBack={() => { setView("list"); setInfo(null); }} /> : <form onSubmit={event => void submit(event)} noValidate>
        <label className="field-label" htmlFor="project-name">项目名称 <span aria-hidden="true">*</span><input id="project-name" autoFocus required autoComplete="off" value={name} disabled={saving || Boolean(attempt)} onChange={event => setName(event.target.value)} aria-describedby="project-name-hint" /></label>
        <p id="project-name-hint" className="project-field-hint">1～100个字符，允许重名；项目编号由系统自动生成。</p>
        <label className="field-label" htmlFor="project-description">项目简介<textarea id="project-description" rows={4} value={description} disabled={saving || Boolean(attempt)} onChange={event => setDescription(event.target.value)} aria-describedby="project-description-hint" /></label>
        <p id="project-description-hint" className="project-field-hint">选填，最多2000个字符。</p>
        <p className="project-form-note">创建后进入空项目，并初始化空子系统方案。不会复制任何已有功能、需求或子系统数据。</p>
        {error && <div role="alert" className="error-message">{error}</div>}
        {attempt && !saving && <p className="project-retry-note">原请求信息已保留。重试仅核对并完成同一次创建，不要刷新页面或另建一笔。</p>}
        <div className="dialog-actions"><button type="button" className="button-secondary" disabled={saving} onClick={() => setView("list")}>返回</button><button className="button-primary" disabled={saving || !canCreate} type="submit">{saving ? "创建中…" : attempt ? "重试并进入" : "创建并进入"}</button></div>
      </form>}
    </div>
    {deletionTarget && <DeletionDialog key={`${deletionTarget.kind}-${deletionTarget.id}`} projectId={deletionTarget.id} target={deletionTarget} databaseMode={databaseMode} onClose={() => setDeletionTarget(null)} onDeleted={result => { setDeletionTarget(null); onDeletedProject(result.id); onClose(); }} />}
  </div>;
}




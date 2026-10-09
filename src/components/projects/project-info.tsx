"use client";
import { useI18n } from "@/features/i18n/provider";
import { useEffect, useRef, useState } from "react";
import { ApiError, getProject, updateProject, type ProjectSummary } from "../../lib/api/client";
import { metadataDirty, metadataDraft, metadataError, metadataInput, type MetadataAttempt, type MetadataDraft } from "../../features/metadata/model";
import { createUuid } from "@/lib/uuid";

export type ProjectInfoGuard = { busy: boolean; dirty: boolean; unresolved: boolean };
export type ProjectListItem = Pick<ProjectSummary, "id" | "name" | "code"> & Partial<ProjectSummary>;
type Props = { item: ProjectListItem; database: boolean; onUpdated: (project: ProjectSummary) => void; onGuardChange: (guard: ProjectInfoGuard) => void; onBack: () => void };
export function ProjectInfo({ item, database, onUpdated, onGuardChange, onBack }: Props) {
  const { t: tr } = useI18n();
  const [resource, setResource] = useState<ProjectSummary | null>(null);
  const [draft, setDraft] = useState<MetadataDraft>();
  const [attempt, setAttempt] = useState<MetadataAttempt<ProjectSummary>>();
  const [loading, setLoading] = useState(database), [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false), [notice, setNotice] = useState("");
  const busy = useRef(false), callbacks = useRef({ onUpdated });
  useEffect(() => { callbacks.current = { onUpdated }; }, [onUpdated]);
  const projectId = item.id, dirty = metadataDirty(draft);
  useEffect(() => {
    if (!database) return;
    let alive = true;
    void getProject(projectId).then(value => { if (alive) { setResource(value); callbacks.current.onUpdated(value); } })
      .catch(error => { if (alive) setNotice(error instanceof Error ? error.message : "项目信息读取失败"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId, database]);
  useEffect(() => { onGuardChange({ busy: loading || saving, dirty, unresolved: Boolean(attempt) }); }, [loading, saving, dirty, attempt, onGuardChange]);
  useEffect(() => {
    if (!dirty && !attempt) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, attempt]);
  async function reload() {
    if (busy.current || (dirty && !window.confirm(tr("重新读取会放弃尚未保存的项目资料，请先复制需要保留的输入，是否继续？")))) return;
    busy.current = true; setLoading(true);
    try { const value = await getProject(projectId); setResource(value); callbacks.current.onUpdated(value); setDraft(undefined); setConflict(false); setNotice("已读取最新项目信息。"); }
    catch (error) { setNotice("读取失败，原输入保留。" + (error instanceof Error ? error.message : "请重试")); }
    finally { busy.current = false; setLoading(false); }
  }
  async function save() {
    if (busy.current || !resource?.can_update || !draft || conflict) return;
    const invalid = metadataError(draft.name, draft.description, "项目");
    if (invalid) { setNotice(invalid); return; }
    let current = attempt ?? { input: metadataInput(draft, createUuid()) };
    busy.current = true; setSaving(true); setAttempt(current); setNotice("");
    try {
      if (!current.result) {
        const value = await updateProject(projectId, current.input);
        if (value.id !== projectId) throw new Error("项目响应归属不一致");
        current = { ...current, result: value }; setAttempt(current); setResource(value); callbacks.current.onUpdated(value);
      }
      const latest = await getProject(projectId);
      setResource(latest); callbacks.current.onUpdated(latest); setAttempt(undefined); setDraft(undefined); setNotice("项目资料已保存，未切换当前项目。");
    } catch (error) {
      const rejected = !current.result && error instanceof ApiError && [401,403,404,409,415,422].includes(error.status);
      if (rejected) { setAttempt(undefined); setConflict(error.status === 409); }
      setNotice((current.result ? "资料已保存，待同步。重试同步不会再次提交修改。" : rejected ? "保存未成功，原输入保留。" : "暂无法确认保存结果，请重试同一请求；输入已保留并锁定。") + " " + (error instanceof Error ? error.message : "请稍后重试"));
    } finally { busy.current = false; setSaving(false); }
  }
  const shown = resource ?? item, locked = loading || saving || Boolean(attempt);
  return <section aria-label={tr("项目信息")} className="project-info" aria-busy={loading || saving}>
    <p className="project-field-hint">{tr("查看和修改这里的资料不会切换当前项目。")}</p>
    <p className="metadata-code">{tr("项目编号：")}{shown.code}{tr("（只读）")}</p>
    {loading && <p role="status">{tr("正在读取项目信息…")}</p>}
    {draft ? <form onSubmit={event => { event.preventDefault(); void save(); }} noValidate>
      <label className="field-label" htmlFor="project-edit-name">{tr("项目名称")}<input aria-label={tr("项目名称")} id="project-edit-name" autoFocus required value={draft.name} disabled={locked} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="field-label" htmlFor="project-edit-description">{tr("项目简介")}<textarea aria-label={tr("项目简介")} id="project-edit-description" rows={5} value={draft.description} disabled={locked} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <p className="project-field-hint">{tr("名称1～100个字符；简介选填，最多2000个字符。")}</p>
      <div className="dialog-actions"><button type="button" className="button-secondary" disabled={locked} onClick={() => { setDraft(undefined); setConflict(false); setNotice(""); }}>{tr("取消编辑")}</button><button className="button-primary" disabled={loading || saving || conflict}>{saving ? tr("正在保存/同步…") : attempt?.result ? tr("重试同步") : attempt ? tr("重试保存") : tr("保存修改")}</button></div>
    </form> : <><dl className="project-info-details"><dt>{tr("项目名称")}</dt><dd>{shown.name}</dd><dt>{tr("项目简介")}</dt><dd className="metadata-description">{shown.description || tr("暂无项目简介")}</dd></dl><div className="dialog-actions"><button className="button-secondary" disabled={loading || saving} onClick={onBack}>{tr("返回项目列表")}</button><button className="button-primary" disabled={!resource?.can_update || loading} title={!resource?.can_update ? tr("当前账号无编辑权限或业务写入未启用") : ""} onClick={() => { if (resource) { setDraft(metadataDraft(resource)); setNotice(""); } }}>{tr("编辑项目信息")}</button></div></>}
    {notice && <p className="document-feedback" role="status">{tr(notice)}</p>}
    {database && <button className="button-secondary project-reload" disabled={locked} onClick={() => void reload()}>{tr("重新读取")}</button>}
    {!database && <p className="project-field-hint">{tr("当前是Mock项目；真实项目资料编辑请使用数据库模式。")}</p>}
  </section>;
}


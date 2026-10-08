"use client";
import { useRef, useState } from "react";
import { WorkDialog } from "./work-dialog";
import { UcSourcePicker } from "./uc-source-picker";
import type { ManualCreate, SourceRef } from "@/features/workbench/manual-api";
import type { BusinessFeature } from "@/features/workbench/model";
import { ApiError } from "@/lib/api/client";
import { createUuid } from "@/lib/uuid";
export type CreateTarget = { project: string; projectLabel?: string; kind: ManualCreate["kind"]; feature?: BusinessFeature; prdRevision?: string; candidates: NonNullable<BusinessFeature["acceptedUcs"]> };
export function ManualCreateDialog({ target, contextValid = true, onCreate, onClose }: { target: CreateTarget; contextValid?: boolean; onCreate: (input: ManualCreate) => Promise<void>; onClose: () => void }) {
  const [fields, setFields] = useState<Record<string, string>>({}), [sources, setSources] = useState<SourceRef[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [retry, setRetry] = useState(false);
  const locked = useRef(false), attempt = useRef<ManualCreate | null>(null);
  const title = "手动新建" + (target.kind === "function" ? "功能" : " " + target.kind);
  function input(name: string, label: string, required = false, maxLength = 2000, multiline = true) {
    const props = { id: "manual-" + name, name, value: fields[name] ?? "", required, maxLength, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields(old => ({ ...old, [name]: e.target.value })) };
    return <label className="manual-field" htmlFor={props.id}><span>{label}{required ? <b> *</b> : <small>选填</small>}</span>{multiline ? <textarea {...props} rows={3} /> : <input {...props} autoFocus={required} />}</label>;
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (locked.current || !contextValid) return;
    const name = fields.name?.trim() ?? "", description = fields.description?.trim() ?? "";
    if (!retry && (target.kind === "FR" ? !description : !name)) { setError("必填内容不能仅包含空格。"); return; }
    if (!retry) {
      const creation_id = createUuid();
      attempt.current = target.kind === "function" ? { kind: "function", creation_id, name, description }
        : target.kind === "PRD" ? { kind: "PRD", creation_id, name }
        : target.kind === "UC" ? { kind: "UC", creation_id, name, description, prd_revision_id: target.prdRevision ?? "", actors: fields.actors ?? "", preconditions: fields.preconditions ?? "", main_flow: fields.main_flow ?? "", postconditions: fields.postconditions ?? "" }
        : { kind: "FR", creation_id, description, acceptance_criteria: fields.acceptance_criteria ?? "", sources };
    }
    locked.current = true; setBusy(true); setError("");
    try { await onCreate(attempt.current!); onClose(); }
    catch (error) {
      const uncertain = !(error instanceof ApiError) || error.status >= 500;
      setRetry(uncertain); setError((error instanceof Error ? error.message : "创建失败") + (uncertain ? " 请重试原请求，避免重复创建。" : " 原输入已保留。"));
    } finally { locked.current = false; setBusy(false); }
  }
  return <WorkDialog title={title} onClose={() => { if (!locked.current) onClose(); }}><form className="manual-create-form" onSubmit={submit}>
    <p>所属项目：<strong>{target.projectLabel || target.project}</strong></p>
    {!contextValid && <p className="manual-error" role="alert">当前项目已切换。此表单仍属于原项目，不能提交；请关闭后在目标项目重新打开。</p>}
    {target.feature && <p>所属功能：<strong>{target.feature.name}</strong></p>}
    <fieldset disabled={busy || retry || !contextValid} className="manual-fields">
      {target.kind !== "FR" && input("name", target.kind === "function" ? "功能名称" : target.kind + " 名称", true, 100, false)}
      {target.kind !== "PRD" && input("description", target.kind === "FR" ? "需求描述" : target.kind === "UC" ? "用例描述" : "功能描述", target.kind === "FR", target.kind === "function" ? 2000 : 20000)}
      {target.kind === "UC" && <><p className="manual-hint">自动引用当前已确认 PRD（版本 {target.prdRevision?.slice(0, 8)}）。创建后为待确认草稿，确认前需补齐描述与主事件流。</p>{input("actors", "参与者")}{input("preconditions", "前置条件")}{input("main_flow", "主事件流", false, 20000)}{input("postconditions", "后置条件")}</>}
      {target.kind === "FR" && <>{input("acceptance_criteria", "验收标准", false, 20000)}<UcSourcePicker candidates={target.candidates} value={sources} onChange={setSources} /></>}
    </fieldset>
    {error && <p className="manual-error" role="alert">{error}</p>}
    <p className="manual-hint">{target.kind === "function" ? "仅创建功能，不生成 PRD、UC、FR 或分配数据。" : "创建成功后自动打开正文预览；编辑、保存和确认是独立步骤。"}</p>
    <div className="dialog-actions"><button type="button" className="button-secondary" disabled={busy} onClick={onClose}>取消</button><button className="button-primary" disabled={busy || !contextValid || target.kind === "UC" && !target.prdRevision} aria-busy={busy}>{busy ? "创建中…" : retry ? "重试原请求" : "创建"}</button></div>
  </form></WorkDialog>;
}


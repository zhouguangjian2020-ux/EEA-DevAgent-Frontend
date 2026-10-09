"use client";
import { useI18n } from "@/features/i18n/provider";
import { DocumentStatus } from "../workbench/document-status";
import { DatabaseReview, type Persistence } from "../workbench/database-review";
import { ObjectReview } from "../workbench/object-review";
import { EXCEPTION_NAMES, UC_FIELDS, canReviewUc, type UcContent, type UcSession, type UcAction } from "@/features/uc/model";

type Props = { session: UcSession; featureName: string; number: string; sourceName: string; onSource: () => void; onAction: (action: UcAction) => void; referenceTargets: Record<string, string>; onOpenReference: (id: string) => void; persistence?: Persistence; acceptedPrdRevisionId?: string | null; readOnly?: boolean };
type SimpleField = Exclude<keyof UcContent, "branches" | "exceptions">;
const topFields: SimpleField[] = ["name", "description", "number", "actors", "preconditions"];
const bottomFields: SimpleField[] = ["postconditions", "extensions", "hmi", "regulations", "performance", "nonfunctional"];
function UcTable({ content, editing, onChange, referenceTargets, onOpenReference }: { content: UcContent; editing: boolean; onChange: (value: UcContent) => void; referenceTargets: Record<string, string>; onOpenReference: (id: string) => void }) {
  const { t: tr } = useI18n();
  function value(key: SimpleField | "branches" | "exceptions", label: string, index?: number) {
    const text = index === undefined ? content[key] as string : (content[key] as string[])[index];
    return editing && key !== "number" ? <textarea className="uc-cell-editor" aria-label={tr("编辑{0}", { "0": label })} rows={Math.max(2, text.split("\n").length)} value={text} onChange={e => {
      if (index === undefined) onChange({ ...content, [key]: e.target.value });
      else { const values = [...content[key] as string[]]; values[index] = e.target.value; onChange({ ...content, [key]: values }); }
    }} /> : <div className={`uc-cell-content${text === "N/A" ? " not-applicable" : ""}`}>{text ? text.split(/(UC-[A-Z0-9]+-[A-Z0-9]+-\d+)/g).map((part, i) => referenceTargets[part] ? <button type="button" key={i} className="uc-reference-link" title={tr("打开用例 {0}", { "0": part })} onClick={() => onOpenReference(referenceTargets[part])}>{part}</button> : part) : "—"}</div>;
  }
  return <table className="uc-table" aria-label={tr("UC 用例详情（表7）")}><caption className="sr-only">{tr("12 个字段；场景包含主事件流、可变数量的分支和异常事件流")}</caption><colgroup><col className="uc-field-col" /><col className="uc-flow-col" /><col className="uc-exception-col" /><col /></colgroup><tbody>
    {topFields.map((field, i) => <tr key={field} data-uc-field={field}><th scope="row">{tr(UC_FIELDS[i])}</th><td colSpan={3}>{value(field, UC_FIELDS[i])}</td></tr>)}
    <tr data-uc-field="scenario"><th rowSpan={1 + content.branches.length + content.exceptions.length} scope="rowgroup">{tr("场景")}</th><th scope="row">{tr("主事件流")}</th><td colSpan={2}>{value("mainFlow", "主事件流")}</td></tr>
    {content.branches.map((_, i) => <tr key={`b${i}`}><th scope="row">{tr("分支事件流 ")}{i + 1}</th><td colSpan={2}>{value("branches", `分支事件流 ${i + 1}`, i)}</td></tr>)}
    {content.exceptions.map((_, i) => { const label = EXCEPTION_NAMES[i] ?? `异常事件流 ${i + 1}`; return <tr key={`e${i}`}>{i === 0 && <th rowSpan={content.exceptions.length || 1} scope="rowgroup">{tr("异常事件流")}</th>}<th scope="row">{tr(label)}</th><td>{value("exceptions", label, i)}</td></tr>; })}
    {bottomFields.map((field, i) => <tr key={field} data-uc-field={field}><th scope="row">{tr(UC_FIELDS[i + 6])}</th><td colSpan={3}>{value(field, UC_FIELDS[i + 6])}</td></tr>)}
  </tbody></table>;
}
export function UcWorkspace({ session, featureName, number, sourceName, onSource, onAction, referenceTargets, onOpenReference, readOnly = false, persistence, acceptedPrdRevisionId }: Props) {
  const { t: tr } = useI18n();
  const doc = session.document, editing = !readOnly && Boolean(session.editDraft), reviewable = !readOnly && canReviewUc(session);
  return <section className="uc-workspace document-only" data-testid="uc-workspace" onKeyDown={e => { if (e.key === "Escape" && session.confirmDiscard) onAction({ type: "cancel-discard" }); }}>
    <section className="uc-document" aria-label={tr("UC 正文区")}>
      <div className="prd-document-toolbar uc-document-toolbar"><span className="document-type uc">UC</span><strong title={featureName}>{featureName}</strong><DocumentStatus status={doc?.status} editing={editing} /><span className="uc-document-title" title={doc?.content.name}>{doc?.content.name ?? tr("用例草稿已放弃")}</span><span className="document-toolbar-spacer" aria-hidden="true" />
        {!readOnly && !persistence && <ObjectReview kind="UC" label={number} status={doc?.status} selected={session.selected} reviewable={reviewable} confirming={session.confirmDiscard} onSelect={selected => onAction({ type: "select", selected })} onAccept={() => onAction({ type: "accept" })} onConfirmDiscard={() => onAction({ type: "confirm-discard" })} onCancelDiscard={() => onAction({ type: "cancel-discard" })} onDiscard={() => onAction({ type: "discard" })} />}
        {persistence && <DatabaseReview persistence={persistence} status={doc?.status} editing={editing} selected={session.selected} onSelect={selected => onAction({ type: "select", selected })} onAccept={() => onAction({ type: "accept" })} />}
        {editing ? <><button className="button-secondary" disabled={persistence?.saving} onClick={() => onAction({ type: "cancel-edit" })}>{tr("取消编辑")}</button><button className="button-primary" disabled={persistence?.saving} onClick={() => onAction({ type: "save" })}>{tr("保存草稿")}</button></> : <button className="button-secondary" disabled={persistence ? persistence.saving || !persistence.canUpdate : !reviewable || session.confirmDiscard} onClick={() => onAction({ type: "edit" })}>{tr("编辑")}</button>}
      </div>
      <div className="uc-document-meta"><span>{number}</span></div>
      <div className="uc-table-scroll">{doc ? <><div className="uc-table-caption"><h1>{tr("用例详情")}</h1><span>{tr("表 7 · 12 个字段")}</span></div><UcTable referenceTargets={referenceTargets} onOpenReference={onOpenReference} content={session.editDraft ?? doc.content} editing={editing && !persistence?.saving} onChange={value => onAction({ type: "edit-content", value })} /></> : <div className="work-empty"><h2>{tr("UC 草稿已放弃")}</h2><p>{tr("项目对话保留，关闭标签不等于删除对象。")}</p></div>}</div>
      {session.notice && <p className="document-feedback" role="status">{tr(session.notice)}</p>}
      <div className="uc-source"><span>{tr("来源 PRD")}</span><button onClick={onSource}>{sourceName} →</button>{persistence && editing && acceptedPrdRevisionId && acceptedPrdRevisionId !== session.editDraft?.sourcePrdRevisionId && <button className="uc-source-update" title={tr("当前来源已过期；仅修改编辑草稿，保存后仍需单独确认")} disabled={persistence.saving} onClick={() => onAction({ type: "edit-content", value: { ...session.editDraft!, sourcePrdRevisionId: acceptedPrdRevisionId } })}>{tr("明确改用当前已确认 PRD")}</button>}</div>
    </section>
  </section>;
}

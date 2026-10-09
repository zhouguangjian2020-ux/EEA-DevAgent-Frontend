"use client";
import { useI18n } from "@/features/i18n/provider";
import { DocumentStatus } from "../workbench/document-status";
import { DatabaseReview, type Persistence } from "../workbench/database-review";
import { UcSourcePicker } from "../workbench/uc-source-picker";
import type { BusinessFeature } from "@/features/workbench/model";
import { canReviewFr, type FrAction, type FrSession } from "@/features/fr/model";

export type FrWorkspaceProps = {
  featureName: string;
  number: string;
  session: FrSession;
  onAction: (action: FrAction) => void;
  onBack: () => void;
  readOnly?: boolean;
  persistence?: Persistence;
  candidates?: NonNullable<BusinessFeature["acceptedUcs"]>;
};

export function FrWorkspace({ featureName, number, session, onAction, onBack, readOnly = false, persistence, candidates = [] }: FrWorkspaceProps) {
  const { t: tr } = useI18n();
  const doc = session.document; const editing = !readOnly && Boolean(session.editDraft); const content = session.editDraft ?? doc?.content;
  return <section className="fr-workspace document-only" data-testid="fr-workspace">
    <section className="fr-detail-main" aria-label={tr("FR 正文区")}>
      <div className="fr-document-toolbar"><button type="button" className="button-secondary" onClick={onBack}>{tr("← FR 全景视图")}</button><div className="fr-document-identity"><span className="document-type">FR</span><strong>{number}</strong><small>{featureName}</small><DocumentStatus status={doc?.status} editing={editing} /></div><span className="document-toolbar-spacer" aria-hidden="true" />
        {!readOnly && !persistence && doc && <label className="document-toolbar-review fr-review-selection"><input type="checkbox" aria-label={tr("选择产物 {0}", { "0": number })} checked={session.selected} disabled={!canReviewFr(session)} onChange={e => onAction({ type: "select", selected: e.target.checked })} /><span>{tr("已审阅当前版本")}</span></label>}
        {persistence && <DatabaseReview persistence={persistence} status={doc?.status} editing={editing} selected={session.selected} onSelect={selected => onAction({ type: "select", selected })} onAccept={() => onAction({ type: "accept" })} />}
        {editing ? <div className="fr-toolbar-actions"><button type="button" className="button-secondary" disabled={persistence?.saving} onClick={() => onAction({ type: "cancel-edit" })}>{tr("取消")}</button><button type="button" className="button-primary" disabled={persistence?.saving} onClick={() => onAction({ type: "save" })}>{tr("保存草稿")}</button></div> : readOnly ? <span className="document-readonly">{tr("只读")}</span> : <div className="fr-toolbar-actions"><button type="button" className="button-secondary" disabled={persistence ? persistence.saving || !persistence.canUpdate : !canReviewFr(session)} onClick={() => onAction({ type: "edit" })}>{tr("编辑")}</button>{!persistence && <button type="button" className="button-primary" disabled={!canReviewFr(session) || !session.selected} onClick={() => onAction({ type: "accept" })}>{tr("确认")}</button>}</div>}
      </div>
      {content ? <div className="fr-detail-card"><div className="fr-detail-row"><span>{tr("需求编号")}</span>{editing ? <input aria-label={tr("需求编号")} value={content.id} readOnly /> : <strong>{content.id}</strong>}</div><div className="fr-detail-row"><span>{tr("需求来源")}</span>{editing && (persistence || content.sources) ? <UcSourcePicker candidates={candidates} value={content.sources ?? []} onChange={sources => { if (!persistence?.saving) onAction({ type: "edit-content", value: { ...content, sources, source: sources.map(s => candidates.find(c => c.uc_id === s.uc_id)?.uc_code ?? s.uc_id).join("、") || "无来源" } }); }} /> : editing ? <input aria-label={tr("需求来源")} value={content.source} onChange={e => onAction({ type: "edit-content", value: { ...content, source: e.target.value } })} /> : <span>{content.source}</span>}</div><div className="fr-detail-row fr-detail-description"><span>{tr("需求描述")}</span>{editing ? <textarea disabled={persistence?.saving} aria-label={tr("需求描述")} value={content.description} onChange={e => onAction({ type: "edit-content", value: { ...content, description: e.target.value } })} /> : <p>{content.description}</p>}</div><div className="fr-detail-row fr-detail-description"><span>{tr("验收标准（选填）")}</span>{editing ? <textarea aria-label={tr("验收标准")} disabled={persistence?.saving} value={content.acceptanceCriteria ?? ""} onChange={e => onAction({ type: "edit-content", value: { ...content, acceptanceCriteria: e.target.value } })} /> : <p>{content.acceptanceCriteria || "—"}</p>}</div></div> : <div className="fr-empty-detail"><strong>{tr("该 FR 暂无可展示正文")}</strong><p>{tr("请返回 FR 全景视图，选择一条已有需求。")}</p></div>}
      {session.notice && <p className="fr-feedback" role="status">{tr(session.notice)}</p>}
    </section>
  </section>;
}

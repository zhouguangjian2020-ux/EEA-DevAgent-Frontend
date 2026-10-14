"use client";
import { useI18n } from "@/features/i18n/provider";
import type { BusinessFeature, FeatureWork } from "@/features/workbench/model";
import { metadataDirty } from "@/features/metadata/model";

type Props = { feature: BusinessFeature; work: FeatureWork; databaseMode: boolean; hasPrd: boolean; canCreate: boolean; canEdit: boolean; onCreatePrd: () => void; onEdit: () => void; onField: (field: "name" | "description", value: string) => void; onCancel: () => void; onSave: () => void; onReload: () => void };
export function FeatureOverview({ feature, work, databaseMode, hasPrd, canCreate, canEdit, onCreatePrd, onEdit, onField, onCancel, onSave, onReload }: Props) {
  const { t: tr } = useI18n();
  const draft = work.metadataDraft, locked = work.saving || Boolean(work.metadataAttempt);
  function reload() {
    if (metadataDirty(draft) && !window.confirm(tr("重新读取会放弃尚未保存的功能资料。请先复制需要保留的输入，是否继续？"))) return;
    onReload();
  }
  return <section className="feature-overview" data-testid="feature-overview" aria-busy={work.saving}>
    <header className="panorama-toolbar"><div><h1>{tr("功能全景视图")}</h1><p>{tr("各工作空间共用同一功能信息")}</p></div><button className="button-primary" disabled={hasPrd || !canCreate} title={hasPrd ? tr("该功能已有 PRD，不可重复创建") : !canCreate ? tr("当前账号无创建权限或业务写入未启用") : ""} onClick={onCreatePrd}>{tr("手动创建 PRD")}</button></header>
    <section className="workspace-card feature-metadata" aria-label={tr("功能资料")}>
      <div className="workspace-card-header metadata-heading"><h2 className="workspace-card-title">{tr("功能资料")}</h2><div className="metadata-actions">
        {databaseMode && <button className="button-secondary" disabled={locked} onClick={reload}>{tr("重新读取")}</button>}
        {!draft && <button className="button-secondary" disabled={!canEdit || work.saving} title={!canEdit ? tr("当前账号无编辑权限或业务写入未启用") : ""} onClick={onEdit}>{tr("编辑功能资料")}</button>}
      </div></div>
      {draft ? <form onSubmit={event => { event.preventDefault(); onSave(); }} noValidate>
        <p className="metadata-code">{tr("功能编号：")}{feature.code ?? "—"}{tr("（只读）")}</p>
        <label className="field-label" htmlFor={work.id + "-name"}>{tr("功能名称")}<input aria-label={tr("功能名称")} id={work.id + "-name"} autoFocus required value={draft.name} disabled={locked} onChange={event => onField("name", event.target.value)} /></label>
        <label className="field-label" htmlFor={work.id + "-description"}>{tr("功能描述")}<textarea aria-label={tr("功能描述")} id={work.id + "-description"} rows={4} value={draft.description} disabled={locked} onChange={event => onField("description", event.target.value)} /></label>
        <p className="project-field-hint">{tr("名称1～100个字符；描述选填，最多2000个字符。修改资料不改写PRD正文。")}</p>
        <div className="metadata-actions"><button type="button" className="button-secondary" disabled={locked} onClick={onCancel}>{tr("取消编辑")}</button><button className="button-primary" disabled={work.saving || work.metadataConflict || !canEdit}>{work.saving ? tr("正在保存/同步…") : work.metadataAttempt?.result ? tr("重试同步") : work.metadataAttempt ? tr("重试保存") : tr("保存修改")}</button></div>
      </form> : <dl className="feature-details"><div><dt>{tr("功能编号")}</dt><dd>{feature.code ?? "—"}</dd></div><div><dt>{tr("功能名称")}</dt><dd>{feature.name}</dd></div><div><dt>{tr("功能描述")}</dt><dd className="metadata-description">{feature.description || tr("暂无描述")}</dd></div></dl>}
      {work.session.notice && <p className="document-feedback" role="status">{tr(work.session.notice)}</p>}
    </section>
    {hasPrd && <p className="document-feedback">{tr("该功能已有 PRD，请在产品工程工作空间打开。")}</p>}
  </section>;
}

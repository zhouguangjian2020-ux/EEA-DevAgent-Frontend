import type { BusinessFeature, FeatureWork } from "@/features/workbench/model";
import { metadataDirty } from "@/features/metadata/model";

type Props = { feature: BusinessFeature; work: FeatureWork; databaseMode: boolean; hasPrd: boolean; canCreate: boolean; canEdit: boolean; onCreatePrd: () => void; onEdit: () => void; onField: (field: "name" | "description", value: string) => void; onCancel: () => void; onSave: () => void; onReload: () => void };
export function FeatureOverview({ feature, work, databaseMode, hasPrd, canCreate, canEdit, onCreatePrd, onEdit, onField, onCancel, onSave, onReload }: Props) {
  const draft = work.metadataDraft, locked = work.saving || Boolean(work.metadataAttempt);
  function reload() {
    if (metadataDirty(draft) && !window.confirm("重新读取会放弃尚未保存的功能资料。请先复制需要保留的输入，是否继续？")) return;
    onReload();
  }
  return <section className="feature-overview" data-testid="feature-overview" aria-busy={work.saving}>
    <header className="panorama-toolbar"><div><h1>功能全景视图</h1><p>各工作空间共用同一功能信息</p></div><button className="button-primary" disabled={hasPrd || !canCreate} title={hasPrd ? "该功能已有 PRD，不可重复创建" : !canCreate ? "当前账号无创建权限或业务写入未启用" : ""} onClick={onCreatePrd}>手动创建 PRD</button></header>
    <section className="feature-metadata" aria-label="功能资料">
      <div className="metadata-heading"><h2>功能资料</h2><div className="metadata-actions">
        {databaseMode && <button className="button-secondary" disabled={locked} onClick={reload}>重新读取</button>}
        {!draft && <button className="button-secondary" disabled={!canEdit || work.saving} title={!canEdit ? "当前账号无编辑权限或业务写入未启用" : ""} onClick={onEdit}>编辑功能资料</button>}
      </div></div>
      {draft ? <form onSubmit={event => { event.preventDefault(); onSave(); }} noValidate>
        <p className="metadata-code">功能编号：{feature.code ?? "—"}（只读）</p>
        <label className="field-label" htmlFor={work.id + "-name"}>功能名称<input aria-label="功能名称" id={work.id + "-name"} autoFocus required value={draft.name} disabled={locked} onChange={event => onField("name", event.target.value)} /></label>
        <label className="field-label" htmlFor={work.id + "-description"}>功能描述<textarea aria-label="功能描述" id={work.id + "-description"} rows={4} value={draft.description} disabled={locked} onChange={event => onField("description", event.target.value)} /></label>
        <p className="project-field-hint">名称1～100个字符；描述选填，最多2000个字符。修改资料不改写PRD正文。</p>
        <div className="metadata-actions"><button type="button" className="button-secondary" disabled={locked} onClick={onCancel}>取消编辑</button><button className="button-primary" disabled={work.saving || work.metadataConflict || !canEdit}>{work.saving ? "正在保存/同步…" : work.metadataAttempt?.result ? "重试同步" : work.metadataAttempt ? "重试保存" : "保存修改"}</button></div>
      </form> : <dl className="feature-details"><div><dt>功能编号</dt><dd>{feature.code ?? "—"}</dd></div><div><dt>功能名称</dt><dd>{feature.name}</dd></div><div><dt>功能描述</dt><dd className="metadata-description">{feature.description || "暂无描述"}</dd></div></dl>}
      {work.session.notice && <p className="document-feedback" role="status">{work.session.notice}</p>}
    </section>
    {hasPrd && <p className="document-feedback">该功能已有 PRD，请在产品工程工作空间打开。</p>}
  </section>;
}

"use client";

import { useId, useState, type ReactNode } from "react";
import { useI18n } from "@/features/i18n/provider";
import { proposalBlockedReason, proposalFields, proposalNeedsReview, type ObjectProposal } from "@/features/workbench/object-proposals";
import { workLabel, type ObjectWork, type ProjectWorks } from "@/features/workbench/model";
import { AgentMarkdown } from "./agent-markdown";
import { WorkDialog } from "./work-dialog";
import "./object-ai-preview.css";

type Actions = {
  onConfirm: (proposal: ObjectProposal) => void;
  onRecover: (proposal: ObjectProposal) => void;
  onRefresh: (proposal: ObjectProposal) => void;
  onDiscard: (proposal: ObjectProposal) => void;
};
type PreviewProps = Actions & { proposal: ObjectProposal; work: ObjectWork; state: ProjectWorks; writeLocked?: boolean };

export function ObjectAiPreview({ proposal, work, state, onConfirm, onRecover, onRefresh, onDiscard, writeLocked }: PreviewProps) {
  const { t: tr } = useI18n();
  const [full, setFull] = useState(false);
  const [dialog, setDialog] = useState<"confirm" | "discard" | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const blocked = writeLocked ? "同一对象已有正在保存或结果待核实的操作，请先在原会话核验结果。" : proposalBlockedReason(proposal, work, state);
  const fields = proposalFields(proposal.original_content, proposal.content);
  const changed = fields.filter(field => field.changed);
  const pending = proposal.status === "pending";
  const source = proposal.content.kind === "UC" ? proposal.content.prd_revision_id : proposal.content.kind === "FR" ? proposal.content.sources.map(item => item.uc_revision_id).join("、") : null;
  return <section className="object-ai-preview" aria-label={tr("AI 修改建议审查")} aria-busy={proposal.status === "saving"}>
    <section className="workspace-card ai-preview-summary" aria-label={tr("AI 修改预览")}>
      <header className="workspace-card-header ai-preview-heading">
        <div><span className="ai-preview-eyebrow">{tr("AI 修改预览")}</span><h2 className="workspace-card-title">{workLabel(work, tr)}</h2></div>
        <span className={"ai-preview-status " + proposal.status}>{tr(proposal.status === "saved" ? "已确认并保存" : proposal.status === "saving" ? "正在保存" : proposal.status === "uncertain" ? "保存结果待核实" : "尚未写入对象")}</span>
      </header>
      <dl className="ai-preview-version">
        <div><dt>{tr("生成基准工作版本")}</dt><dd>{proposal.base_revision_id}</dd></div>
        <div><dt>{tr("当前已确认版本")}</dt><dd>{work.database?.acceptedRevisionId || tr("尚未确认")}</dd></div>
        {source && <div><dt>{tr("建议引用的来源版本")}</dt><dd>{source}</dd></div>}
      </dl>
      <p className="ai-preview-memory">{tr("未采纳预览仅保留在当前页面内存中，刷新或离开页面将丢失；切换对象和会话不会丢弃。")}</p>
      {proposal.message && <p role={proposal.status === "saved" ? "status" : "alert"} className={"ai-preview-feedback " + (proposal.status === "saved" ? "success" : "")}>{tr(proposal.message)}</p>}
      {pending && blocked && <p role="alert" className="ai-preview-feedback">{tr(blocked)}</p>}
      {proposal.status === "uncertain" && <p className="ai-preview-feedback">{tr("请求未返回可靠回执，可能已保存。请先核验原操作，不要重新提交或手动重复保存。核验前请勿刷新或离开页面，否则本次回执核验入口将丢失，已保存的数据不会因此撤销。")}</p>}
      {proposal.status === "saved" && <p className="ai-preview-feedback success" role="status">{tr("该对象已保存并确认，其他对象的建议仍需分别审查。")}{proposal.savedRevisionId && <code>{proposal.savedRevisionId}</code>}</p>}
    </section>
    <section className="workspace-card ai-preview-content" aria-label={tr("修改内容")}>
      <header className="workspace-card-header ai-preview-toolbar">
        <h3 className="workspace-card-title">{tr("修改内容")}<span className="ai-preview-change-count">{changed.length} {tr("项差异")}</span></h3>
        <div role="group" aria-label={tr("预览方式")}><button type="button" aria-pressed={!full} disabled={!proposal.original_content} onClick={() => setFull(false)}>{tr("逐字段对比")}</button><button type="button" aria-pressed={full || !proposal.original_content} onClick={() => setFull(true)}>{tr("完整建议")}</button></div>
      </header>
      {!full && proposal.original_content ? <div className="ai-preview-diff" role="table" aria-label={tr("原内容与 AI 建议对比")}>
        <div className="ai-preview-diff-head" role="row"><span role="columnheader">{tr("字段")}</span><span role="columnheader">{tr("生成时的原内容")}</span><span role="columnheader">{tr("AI 建议内容")}</span></div>
        {changed.length ? changed.map(field => <div key={field.key} className="ai-preview-diff-row" role="row"><strong role="rowheader">{tr(field.label)}</strong><pre role="cell">{field.before}</pre><pre role="cell">{field.after}</pre></div>) : <p className="ai-preview-empty">{tr("建议与原始内容没有差异，无需再次保存。")}</p>}
      </div> : <div className="ai-preview-full">{proposal.content.kind === "PRD" ? <AgentMarkdown>{proposal.content.markdown_body}</AgentMarkdown> : fields.map(field => <section key={field.key}><h3>{tr(field.label)}</h3><pre>{field.after}</pre></section>)}</div>}
    </section>
    <footer className="workspace-card ai-preview-actions">
      <p>{tr("仅此对象 · 人工确认后新增已确认版本，保留历史")}</p>
      <div className="ai-preview-action-buttons">
        {pending && <><button type="button" className="button-secondary" onClick={() => setDialog("discard")}>{tr("丢弃此建议")}</button><button type="button" className="button-primary" disabled={Boolean(blocked) || !changed.length} title={blocked || undefined} onClick={() => { setReviewed(false); setDialog("confirm"); }}>{tr("确认并保存")}</button></>}
        {proposal.status === "saving" && <span role="status">{tr("正在核验版本并保存，请勿重复操作…")}</span>}
        {proposal.status === "uncertain" && <button type="button" className="button-primary" onClick={() => onRecover(proposal)}>{tr("核验保存回执")}</button>}
        {proposal.status === "saved" && proposal.refreshFailed && <button type="button" className="button-secondary" disabled={proposal.refreshing} onClick={() => onRefresh(proposal)}>{tr("仅重新读取对象")}</button>}
      </div>
    </footer>
    {dialog && <WorkDialog title={dialog === "confirm" ? tr("确认此对象的 AI 修改") : tr("丢弃此对象的建议？")} onClose={() => setDialog(null)}><p><strong>{workLabel(work, tr)}</strong></p>{dialog === "confirm" ? <><p>{tr("将基于上述版本新增修订并确认为正式版本，保留历史；不会确认其他对象，也不会修改关联范围。保存前服务端会再次校验对象、来源版本和权限。")}</p><label className="ai-preview-ack"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />{tr("我已检查修改内容与来源，确认保存此对象。")}</label>{blocked && <p role="alert">{tr(blocked)}</p>}<div className="dialog-actions"><button type="button" className="button-secondary" onClick={() => setDialog(null)}>{tr("取消")}</button><button type="button" className="button-primary" disabled={!reviewed || Boolean(blocked) || !pending} onClick={() => { setDialog(null); onConfirm(proposal); }}>{tr("确认并保存")}</button></div></> : <><p>{tr("丢弃后，对话中保留此条建议的记录并标为已丢弃，不再允许打开预览；原对象、历史版本和其他建议保持不变。")}</p><div className="dialog-actions"><button type="button" className="button-secondary" onClick={() => setDialog(null)}>{tr("保留建议")}</button><button type="button" className="button-danger" onClick={() => { setDialog(null); onDiscard(proposal); }}>{tr("丢弃此建议")}</button></div></>}</WorkDialog>}
  </section>;
}

export function ObjectProposalWorkspace({ proposals, selectedId, onSelect, work, state, children, locked, ...actions }: Actions & { proposals: ObjectProposal[]; locked?: boolean; selectedId?: string; onSelect: (id?: string) => void; work: ObjectWork; state: ProjectWorks; children: ReactNode }) {
  const { t: tr } = useI18n(), id = useId();
  const visible = proposals.filter(item => item.status !== "discarded");
  const selected = visible.find(item => item.candidate_id === selectedId);
  if (!visible.length && !locked) return children;
  const pending = visible.filter(proposalNeedsReview).length;
  return <div className="ai-review-workspace"><nav className="ai-review-nav" aria-label={tr("对象内容视图")}><button type="button" aria-pressed={!selected} onClick={() => onSelect()}>{tr("当前内容")}</button><button type="button" disabled={!visible.length} aria-pressed={Boolean(selected)} onClick={() => onSelect(visible.find(proposalNeedsReview)?.candidate_id ?? visible[visible.length - 1]?.candidate_id)}>{tr("AI 修改预览")}{pending > 0 && <span>{pending}</span>}</button>{selected && visible.length > 1 && <><label className="sr-only" htmlFor={id}>{tr("选择建议版本")}</label><select id={id} value={selected.candidate_id} onChange={event => onSelect(event.target.value)}>{visible.map((item, index) => <option key={item.candidate_id} value={item.candidate_id}>{tr("建议")} {index + 1} · {tr(item.status === "saved" ? "已确认" : item.status === "uncertain" ? "结果待核实" : "待审查")}</option>)}</select></>}</nav><div hidden={Boolean(selected)}>{locked && <p role="status" className="ai-preview-feedback">{tr("该对象的 AI 修改正在保存或结果待核实，暂时不能人工编辑。请在原会话的 AI 预览中核验结果。")}</p>}<div inert={locked ? true : undefined}>{children}</div></div>{selected && <ObjectAiPreview key={selected.candidate_id} proposal={selected} work={work} state={state} writeLocked={locked} {...actions} />}</div>;
}

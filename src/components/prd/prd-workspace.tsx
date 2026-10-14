"use client";
import { LoadingIllustration, LoadingIcon } from "@/components/feedback/loading";
import { useI18n } from "@/features/i18n/provider";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./prd-workspace.css";
import { DocumentStatus } from "../workbench/document-status";
import { DatabaseReview, type Persistence } from "../workbench/database-review";
import { canReviewPrd, type PrdAction, type PrdSession } from "@/features/prd/model";
import type { PrdGeneration } from "@/features/prd/generation";
import type { UcGenerationCandidate } from "@/features/workbench/uc-generation-api";
import { ObjectReview } from "../workbench/object-review";
type Props = {
  session: PrdSession; onAction: (action: PrdAction) => void; featureName: string;
  onGenerateUcs: () => void; ucGenerating: boolean; ucGenerated: boolean; canGenerateUcs: boolean;
  onStopUcs: () => void; generatedUcs: { id: string; label: string }[]; onOpenUc: (id: string) => void; generatedCandidates?: UcGenerationCandidate[];
  readOnly?: boolean; persistence?: Persistence;
  generation?: { state?: PrdGeneration; onStop: () => void };
};
function MarkdownPreview({ content }: { content: string }) {
  const { t: tr } = useI18n();
  return <div className="prd-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ table: ({ children }) => <div className="prd-table-scroll" role="region" aria-label={tr("PRD 表格")} tabIndex={0}><table>{children}</table></div>, img: ({ alt }) => <span>{tr("[图片：")}{alt || tr("未加载")}]</span>, a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{content}</Markdown></div>;
}

function GeneratedUcCandidates({ candidates }: { candidates: UcGenerationCandidate[] }) {
  const { t: tr } = useI18n();
  if (!candidates.length) return null;
  const text = (value: string) => value.trim() || "—";
  return <section className="generated-uc-candidates" aria-label={tr("UC生成候选")}>
    <header><div><strong>{tr("UC 生成候选")}</strong><span>{tr("仅供审阅 · 尚未创建、保存或确认正式 UC")}</span></div><small>{candidates.length}{tr(" 条")}</small></header>
    <div className="generated-uc-candidate-list">
      {candidates.map(candidate => <article key={candidate.candidate_id} className="generated-uc-candidate">
        <div className="generated-uc-candidate-title"><strong>{tr("候选 ")}{candidate.ordinal} · {candidate.name}</strong><span>{tr("用例编号：正式保存时由后端生成")}</span></div>
        <dl>
          <div><dt>{tr("用例描述")}</dt><dd>{text(candidate.description)}</dd></div>
          <div><dt>{tr("参与者")}</dt><dd>{text(candidate.actors)}</dd></div>
          <div><dt>{tr("前置条件")}</dt><dd>{text(candidate.preconditions)}</dd></div>
          <div><dt>{tr("场景 · 主事件流")}</dt><dd>{text(candidate.scenario.main_flow)}</dd></div>
          <div><dt>{tr("场景 · 分支事件流")}</dt><dd>{candidate.scenario.branches.length ? <ol>{candidate.scenario.branches.map((item, index) => <li key={`${candidate.candidate_id}-branch-${index}`}>{item}</li>)}</ol> : tr("无适用分支")}</dd></div>
          <div><dt>{tr("场景 · 异常事件流")}</dt><dd>{candidate.scenario.exceptions.length ? <ol>{candidate.scenario.exceptions.map((item, index) => <li key={`${candidate.candidate_id}-exception-${index}`}>{item}</li>)}</ol> : tr("无适用异常")}</dd></div>
          <div><dt>{tr("后置条件")}</dt><dd>{text(candidate.postconditions)}</dd></div>
          <div><dt>{tr("扩展用例")}</dt><dd>{text(candidate.extensions)}</dd></div>
          <div><dt>{tr("HMI 交互逻辑")}</dt><dd>{text(candidate.hmi)}</dd></div>
          <div><dt>{tr("法规需求")}</dt><dd>{text(candidate.regulations)}</dd></div>
          <div><dt>{tr("性能需求")}</dt><dd>{text(candidate.performance)}</dd></div>
          <div><dt>{tr("非功能需求")}</dt><dd>{text(candidate.nonfunctional)}</dd></div>
        </dl>
      </article>)}
    </div>
  </section>;
}

export function PrdWorkspace({ session, onAction, featureName, onGenerateUcs, ucGenerating, ucGenerated, canGenerateUcs, onStopUcs, generatedUcs, onOpenUc, generatedCandidates = [], readOnly = false, persistence, generation }: Props) {
  const { t: tr } = useI18n();
  const [livePreview, setLivePreview] = useState(false);
  const [originalFor, setOriginalFor] = useState<string | null>(null);
  const paper = useRef<HTMLDivElement>(null), stick = useRef(true);
  const state = generation?.state, generating = state?.status === "streaming";
  const hasPreview = state?.status === "streaming" || state?.status === "succeeded";
  const showPreview = hasPreview && originalFor !== state.id;
  const doc = session.document, editing = !readOnly && session.editDraft !== null;
  useEffect(() => {
    if (showPreview && stick.current && paper.current) paper.current.scrollTop = paper.current.scrollHeight;
  }, [showPreview, state?.text]);
  return <section className="prd-workspace prd-reading-surface with-document document-only" data-testid="prd-workspace" onKeyDown={e => { if (e.key === "Escape" && session.confirmDiscard) onAction({ type: "cancel-discard" }); }}>
    <section className="prd-document" aria-label={tr("PRD 正文区")}>
      <div className="prd-document-toolbar">
        <span className="document-type">PRD</span><strong>{featureName}</strong>
        {showPreview ? <span className="object-status document-toolbar-status pending" role="status" aria-label={tr("文档状态")}>{generating ? tr("生成中") : tr("未保存")}</span> : <DocumentStatus status={doc?.status} editing={editing} />}
        <span className="document-toolbar-spacer" aria-hidden="true" />
        {!readOnly && !showPreview && !generating && <>
          <button type="button" className="button-primary" disabled={!canGenerateUcs} aria-busy={ucGenerating} onClick={onGenerateUcs}>{ucGenerating ? tr("正在生成 UC…") : ucGenerated ? tr("已生成 UC") : tr("生成 UC")}</button>
          {ucGenerating && <button type="button" className="button-secondary" onClick={onStopUcs}>{tr("停止")}</button>}
        </>}
        {generating && generation && <button type="button" className="button-secondary" onClick={generation.onStop}>{tr("停止生成")}</button>}
        {!showPreview && !generating && <>
          {!readOnly && !persistence && <ObjectReview kind="PRD" label={featureName} status={doc?.status} selected={session.selected} reviewable={!ucGenerating && canReviewPrd(session)} confirming={session.confirmDiscard} onSelect={selected => onAction({ type: "select", selected })} onAccept={() => onAction({ type: "accept" })} onConfirmDiscard={() => onAction({ type: "confirm-discard" })} onCancelDiscard={() => onAction({ type: "cancel-discard" })} onDiscard={() => onAction({ type: "discard" })} />}
          {persistence && <DatabaseReview persistence={persistence} status={doc?.status} editing={editing} selected={session.selected} onSelect={selected => onAction({ type: "select", selected })} onAccept={() => onAction({ type: "accept" })} />}
          {editing ? <><button className="button-secondary" disabled={persistence?.saving} onClick={() => onAction({ type: "cancel-edit" })}>{tr("取消编辑")}</button><button className="button-primary" disabled={persistence ? Boolean(persistence.saving) : !session.editDraft?.trim()} onClick={() => onAction({ type: "save" })}>{tr("保存草稿")}</button></> : readOnly ? <span className="document-readonly">{tr("只读")}</span> : <button className="button-secondary" disabled={persistence ? persistence.saving || !persistence.canUpdate : ucGenerating || !canReviewPrd(session) || session.confirmDiscard} onClick={() => onAction({ type: "edit" })}>{tr("编辑")}</button>}
        </>}
      </div>
      {hasPreview && <div className="prd-generation-bar">
        <div role="group" aria-label={tr("PRD 内容视图")}>
          <button type="button" aria-pressed={!showPreview} onClick={() => setOriginalFor(state.id)}>{tr("原 PRD")}</button>
          <button type="button" aria-pressed={showPreview} onClick={() => { stick.current = true; setOriginalFor(null); }}>{tr("生成预览（未保存）")}</button>
        </div>
        <span role="status">{generating ? <><LoadingIcon />{tr("正在接收生成内容…")}</> : tr("生成完成 · 未保存、未确认")}</span>
      </div>}
      {state?.status === "failed" && <p className="prd-generation-message error" role="alert">{tr(state.error ?? "")}</p>}
      {state?.status === "cancelled" && <p className="prd-generation-message" role="status">{tr("已停止接收，原 PRD 未修改。远端 Agent 推理不保证同时取消。")}</p>}
      <div className={"prd-paper" + (editing && !showPreview ? " is-editing" : "")} ref={paper} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.clientHeight - el.scrollTop < 80; }}>
        {showPreview ? <article className="workspace-card prd-content-card" aria-label={tr("PRD 生成预览")} aria-busy={generating}>
          {state.text ? <MarkdownPreview content={state.text} /> : <>{generating ? doc?.content ? <MarkdownPreview content={doc.content} /> : <LoadingIllustration kind="prd" /> : <p role="status">{tr("暂无生成内容")}</p>}</>}
        </article> : doc ? editing ? <><label className="document-feedback"><input type="checkbox" checked={livePreview} onChange={e => setLivePreview(e.target.checked)} />{tr(" 显示 Markdown 实时预览")}</label><textarea className="prd-editor" aria-label={tr("编辑 PRD 正文")} disabled={persistence?.saving} value={session.editDraft!} onChange={e => onAction({ type: "edit-text", value: e.target.value })} />{livePreview && <div className="markdown-edit-preview"><MarkdownPreview content={session.editDraft!} /></div>}</> : <article className="workspace-card prd-content-card" aria-label={tr("PRD 正文预览")}><MarkdownPreview content={doc.content} /></article> : <div className="work-empty"><h2>{tr("PRD 草稿已放弃")}</h2><p>{tr("功能目录和项目对话保留，可从工作台重新生成。")}</p></div>}
      </div>
      {showPreview && <p className="prd-generation-message">{tr("生成预览仅保留在当前页面，刷新后丢失；不会覆盖原 PRD，也不会自动保存或确认。")}</p>}
      {!showPreview && session.notice && <p className="document-feedback" role="status">{tr(session.notice)}</p>}
      {!readOnly && !showPreview && !generating && ucGenerated && (generatedCandidates.length > 0 || generatedUcs.length > 0) && <div className="prd-downstream">{generatedCandidates.length > 0 && ucGenerated && <GeneratedUcCandidates candidates={generatedCandidates} />}{generatedUcs.length > 0 && ucGenerated && <div className="generated-uc-list" aria-label={tr("已生成用例")}><span>{tr("已模拟生成 ")}{generatedUcs.length}{tr(" 条 UC")}</span>{generatedUcs.map(uc => <button key={uc.id} onClick={() => onOpenUc(uc.id)}>{uc.label} →</button>)}</div>}</div>}
    </section>
  </section>;
}

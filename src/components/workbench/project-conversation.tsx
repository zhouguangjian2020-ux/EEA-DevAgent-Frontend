"use client";
import { useI18n } from "@/features/i18n/provider";
import { AgentMarkdown } from "./agent-markdown";
import { ConversationAttachments } from "./conversation-attachments";
import { CurrentOperationObjects } from "./current-operation-objects";
import { LiveProjectConversation } from "./live-project-conversation";
import { useEffect, useId, useRef } from "react";
import { ChatComposer } from "../workspace/chat-composer";
import { conversationFeatures, featureDisabledReason, type GenerationMode, type ConversationAction } from "../../features/conversation/model";
import type { ProjectWorks } from "../../features/workbench/model";
import type { PrdCreationSession } from "@/features/prd/creation";

import type { ObjectProposal } from "@/features/workbench/object-proposals";
import type { Modification } from "@/features/workbench/workflow-api";

export type ProjectConversationProps = {
  proposals?: ObjectProposal[];
  onProposals?: (threadId: string, requestId: string, changes: Modification[]) => void;
  onOpenProposal?: (proposal: ObjectProposal) => void;
  onCreateFunction?: () => void;
  createFunctionDisabled?: boolean;
  createFunctionDisabledReason?: string;
  onOpenTaskResult?: (artifactId: string) => Promise<void>;
  onThreadChange?: (threadId: string) => void;
  onSaved?: () => Promise<unknown>;
  project: string; state: ProjectWorks; visible: boolean; docked: boolean; readOnly?: boolean;
  onAction: (action: ConversationAction) => void;
  onMode: (mode: GenerationMode | null) => void;
  onSend: (kind?: "send" | "expand", retry?: boolean, fail?: boolean) => void;
  onPrdSubmit?: (prompt: string, targetFunctionId?: string, newFunctionName?: string) => void;
  onGenerateUcs?: (prdWorkId: string) => void;
  prdCreation?: PrdCreationSession;
  onPrdModeExit?: () => void;
  onStop: () => void; onOpenWork: (id: string) => void; onOpenObject: (id: string) => void;
};
function MockProjectConversation({ project, state, visible, docked, readOnly = false, onAction, onMode, onSend, onStop, onOpenObject, onCreateFunction, createFunctionDisabled, createFunctionDisabledReason }: ProjectConversationProps) {
  const { t: tr } = useI18n();
  const c = state.conversation, id = useId(), output = useRef<HTMLDivElement>(null), stick = useRef(true);
  const features = conversationFeatures(project, state, !readOnly), busy = Boolean(c.operation);
  const invalidFeature = c.mode === "UC" ? !c.featureId ? "请先选择业务功能，再提交。" : featureDisabledReason(state, c.mode, c.featureId) : "";
  const sendDisabledReason = readOnly
    ? "当前项目暂不支持发送"
    : invalidFeature || undefined;
  useEffect(() => { if (visible && stick.current && output.current) output.current.scrollTop = output.current.scrollHeight; }, [c.messages.length, c.operation?.id, c.notice, c.error?.message, visible, docked]);
  return <section id={`panel-${project}-home`} role={docked ? "complementary" : "tabpanel"} aria-labelledby={docked ? undefined : `tab-${project}-home`} hidden={!visible} className={`project-conversation${docked ? " docked" : " centered"}`} aria-label={tr("项目{0}对话", { "0": project })} data-testid="project-conversation">
    <div className="conversation-output" role="log" tabIndex={0} aria-label={tr("项目对话记录")} aria-live="polite" aria-relevant="additions text" ref={output} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.clientHeight - el.scrollTop < 72; }}>
      {!c.messages.length && <div className="conversation-welcome"><span className="conversation-eyebrow">{tr("从一个问题开始")}</span><h1>{docked ? tr("对话始终在这里") : tr("今天，我们一起梳理什么？")}</h1><p>{tr("直接提问，或选择下方快捷任务。")}<br />{tr("对象可以切换，思路不必重新开始。")}</p></div>}
      {c.messages.map(message => <div key={message.id} className="live-chat-turn"><ConversationAttachments items={message.references ?? []} /><article className={`conversation-message ${message.role}`}>{message.role === "assistant" ? <AgentMarkdown>{message.content}</AgentMarkdown> : <p>{message.content}</p>}{message.result && <span className="conversation-result"><span>▤</span><span>{message.result.label}<small>{tr("查看生成结果")}</small></span><span>↗</span></span>}</article></div>)}
      {busy && c.operation?.kind !== "expand" && <div className="conversation-loading" role="status"><span className="loading-icon" />{c.operation?.mode ? tr("正在模拟生成{0}…", { "0": c.operation.mode === "PRD" ? " PRD" : "用例" }) : tr("正在组织模拟回复…")}</div>}
      {c.notice && <p className="conversation-notice" role="status">{tr(c.notice)}</p>}
      {c.error && <div className="conversation-error" role="alert"><strong>{tr("本次请求未完成")}</strong><p>{tr(c.error.message)}</p><small>{tr("重试使用原请求快照，不会重复添加用户消息。")}</small></div>}
    </div>
    <div className="conversation-composer-area">
      <CurrentOperationObjects state={state} compact={docked} disabled={busy} suspended={Boolean(c.mode)} onOpen={onOpenObject} onRemove={objectId=>onAction({type:"remove-attachment",objectId})} onClear={()=>onAction({type:"clear-operation-objects"})}/>

      {c.error && <button className="button-secondary" disabled={busy} onClick={() => onSend(c.error!.request.kind, true)}>{tr("重试本次请求")}</button>}
      <ChatComposer label={tr("项目对话输入")} placeholder={c.mode === "PRD" ? tr("输入新功能名称与需求，例如：AEB自动紧急制动…") : c.mode === "UC" ? tr("描述本次用例的场景与要求…") : tr("直接提问，或要求修改当前关联对象…")} value={c.expansionPreview ?? c.prompt} onChange={value => onAction({ type: "prompt", value })} onSend={() => onSend()} onExpand={() => onSend("expand")} onCancel={onStop} busy={c.operation ? c.operation.kind === "expand" ? "expand" : "generate" : null} compact={docked} sendDisabledReason={sendDisabledReason}  />
      <div className="conversation-shortcuts" aria-label={tr("快捷生成")}>{(["PRD", "UC"] as const).filter(mode => !c.mode || c.mode === mode).map(mode => <button key={mode} aria-pressed={c.mode === mode} className={c.mode === mode ? "selected" : ""} disabled={busy} onClick={() => onMode(c.mode === mode ? null : mode)}><span aria-hidden="true">{c.mode === mode ? "✓" : "+"}</span>{mode === "PRD" ? tr("PRD生成") : tr("用例生成")}{c.mode === mode && <span className="shortcut-cancel" aria-hidden="true">×</span>}</button>)}{!c.mode && onCreateFunction && <><span className="conversation-shortcut-divider" role="separator" aria-orientation="vertical" /><button type="button" className="conversation-create-function" disabled={busy || createFunctionDisabled} title={createFunctionDisabledReason ? tr(createFunctionDisabledReason) : undefined} onClick={onCreateFunction}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>{tr("新建功能")}</button></>}{c.mode === "UC" && <div className="conversation-feature-inline"><label htmlFor={id} title={tr("生成用例前需选择已确认 PRD 的功能；自动扩写无需选择")}>{tr("业务功能 ")}<span aria-hidden="true">*</span></label><select id={id} aria-label={tr("业务功能")} required value={c.featureId ?? ""} disabled={busy} onChange={e => onAction({ type: "feature", featureId: e.target.value || null })}><option value="">{tr("请选择功能")}</option>{features.map(feature => { const reason = featureDisabledReason(state, "UC", feature.id); return <option key={feature.id} value={feature.id} disabled={Boolean(reason)}>{feature.name}{reason ? ` · ${tr(reason)}` : ""}</option>; })}</select></div>}{c.mode === "PRD" && <div className="conversation-feature-inline"><label htmlFor={id}>{tr("功能选择（可选）")}</label><select id={id} aria-label={tr("PRD功能选择（可选）")} value={c.featureId ?? ""} disabled={busy} onChange={e => onAction({type:"feature",featureId:e.target.value||null})}><option value="">{tr("不选择：创建新功能及PRD")}</option>{features.map(f => {const reason=featureDisabledReason(state,"PRD",f.id);return <option key={f.id} value={f.id} disabled={Boolean(reason)}>{f.name}{reason ? " · "+reason : ""}</option>;})}</select></div>}</div>

      {!readOnly && <div className="conversation-footer"> <details className="conversation-test-options"><summary>{tr("测试选项")}</summary><button disabled={busy || !c.prompt.trim() || Boolean(invalidFeature)} onClick={() => onSend("send", false, true)}>{tr("模拟一次失败")}</button></details></div>}
    </div>
  </section>;
}

export function ProjectConversation(props: ProjectConversationProps) {
  return props.readOnly ? <LiveProjectConversation {...props} /> : <MockProjectConversation {...props} />;
}

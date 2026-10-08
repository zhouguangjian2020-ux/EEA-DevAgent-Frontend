"use client";
import { LiveProjectConversation } from "./live-project-conversation";
import { useEffect, useId, useRef } from "react";
import { ChatComposer, SparklesIcon } from "../workspace/chat-composer";
import { conversationFeatures, featureDisabledReason, type GenerationMode, type ConversationAction } from "../../features/conversation/model";
import type { ProjectWorks } from "../../features/workbench/model";
import type { PrdCreationSession } from "@/features/prd/creation";

export type ProjectConversationProps = {
  onOpenTaskResult?: (artifactId: string) => Promise<void>;
  onThreadChange?: (threadId: string) => void;
  onSaved?: () => Promise<unknown>;
  project: string; state: ProjectWorks; visible: boolean; docked: boolean; readOnly?: boolean;
  onAction: (action: ConversationAction) => void;
  onMode: (mode: GenerationMode | null) => void;
  onSend: (kind?: "send" | "expand", retry?: boolean, fail?: boolean) => void;
  onPrdSubmit?: (prompt: string) => void;
  onGenerateUcs?: (prdWorkId: string) => void;
  prdCreation?: PrdCreationSession;
  onPrdModeExit?: () => void;
  onStop: () => void; onOpenWork: (id: string) => void; onOpenObject: (id: string) => void;
};
function MockProjectConversation({ project, state, visible, docked, readOnly = false, onAction, onMode, onSend, onStop, onOpenWork, onOpenObject }: ProjectConversationProps) {
  const c = state.conversation, id = useId(), output = useRef<HTMLDivElement>(null), stick = useRef(true);
  const features = conversationFeatures(project, state, !readOnly), busy = Boolean(c.operation);
  const invalidFeature = c.mode === "UC" ? !c.featureId ? "请先选择业务功能，再提交。" : featureDisabledReason(state, c.mode, c.featureId) : "";
  const sendDisabledReason = readOnly
    ? "当前项目暂不支持发送"
    : invalidFeature || undefined;
  useEffect(() => { if (visible && stick.current && output.current) output.current.scrollTop = output.current.scrollHeight; }, [c.messages.length, c.operation?.id, c.notice, c.error?.message, visible, docked]);
  return <section id={`panel-${project}-home`} role={docked ? "complementary" : "tabpanel"} aria-labelledby={docked ? undefined : `tab-${project}-home`} hidden={!visible} className={`project-conversation${docked ? " docked" : " centered"}`} aria-label={`项目${project}对话`} data-testid="project-conversation">
    <div className="conversation-output" role="log" aria-label="项目对话记录" aria-live="polite" aria-relevant="additions text" ref={output} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.clientHeight - el.scrollTop < 72; }}>
      {!c.messages.length && <div className="conversation-welcome"><span className="conversation-eyebrow">从一个问题开始</span><h1>{docked ? "对话始终在这里" : "今天，我们一起梳理什么？"}</h1><p>直接提问，或选择下方快捷任务。<br />对象可以切换，思路不必重新开始。</p><div className="conversation-suggestions"><button onClick={() => onAction({ type: "prompt", value: "请解释 PRD 与用例的区别。" })} disabled={busy}>PRD 与用例有什么区别？ <span>↗</span></button><button onClick={() => onAction({ type: "prompt", value: "如何梳理功能的使用场景和异常边界？" })} disabled={busy}>如何梳理功能边界？ <span>↗</span></button></div></div>}
      {c.messages.map(message => <article key={message.id} className={`conversation-message ${message.role}`}><div className="conversation-author">{message.role === "user" ? "你" : <><SparklesIcon /> 天枢 <span>模拟回复</span></>}</div><p>{message.content}</p>{Boolean(message.references?.length) && <div className="conversation-references"><small>本次引用快照</small>{message.references!.map(ref => <button key={ref.id} onClick={() => onOpenObject(ref.id)}>{ref.name} ↗</button>)}</div>}{message.result && <button className="conversation-result" onClick={() => onOpenWork(message.result!.workId)}><span>▤</span><span>{message.result.label}<small>查看生成结果</small></span><span>↗</span></button>}</article>)}
      {busy && <div className="conversation-loading" role="status"><span className="loading-icon" />{c.operation?.kind === "expand" ? c.expansionPreview !== null ? "正在回填扩写结果…" : "正在扩写…" : c.operation?.mode ? `正在模拟生成${c.operation.mode === "PRD" ? " PRD" : "用例"}…` : "正在组织模拟回复…"}</div>}
      {c.notice && <p className="conversation-notice" role="status">{c.notice}</p>}
      {c.error && <div className="conversation-error" role="alert"><strong>本次请求未完成</strong><p>{c.error.message}</p><button className="button-secondary" disabled={busy} onClick={() => onSend(c.error!.request.kind, true)}>重试本次请求</button><small>重试使用原请求快照，不会重复添加用户消息。</small></div>}
    </div>
    <div className="conversation-composer-area">

      <ChatComposer label="项目对话输入" placeholder={c.mode === "PRD" ? "输入新功能名称与需求，例如：AEB自动紧急制动…" : c.mode === "UC" ? "描述本次用例的场景与要求…" : "输入问题，或添加对象一起讨论…"} value={c.expansionPreview ?? c.prompt} onChange={value => onAction({ type: "prompt", value })} onSend={() => onSend()} onExpand={() => onSend("expand")} onCancel={onStop} busy={c.operation ? c.operation.kind === "expand" ? "expand" : "generate" : null} compact={docked} sendDisabledReason={sendDisabledReason} attachments={c.attachments} attachmentsLocked={busy} onRemoveAttachment={objectId => onAction({ type: "remove-attachment", objectId })} onOpenAttachment={onOpenObject} />
      <div className="conversation-shortcuts" aria-label="快捷生成">{(["PRD", "UC"] as const).filter(mode => !c.mode || c.mode === mode).map(mode => <button key={mode} aria-pressed={c.mode === mode} className={c.mode === mode ? "selected" : ""} disabled={busy} onClick={() => onMode(c.mode === mode ? null : mode)}><span aria-hidden="true">{c.mode === mode ? "✓" : "+"}</span>{mode === "PRD" ? "PRD生成" : "用例生成"}{c.mode === mode && <span className="shortcut-cancel" aria-hidden="true">×</span>}</button>)}{c.mode === "UC" && <div className="conversation-feature-inline"><label htmlFor={id} title="生成用例前需选择已确认 PRD 的功能；自动扩写无需选择">业务功能 <span aria-hidden="true">*</span></label><select id={id} aria-label="业务功能" required value={c.featureId ?? ""} disabled={busy} onChange={e => onAction({ type: "feature", featureId: e.target.value || null })}><option value="">请选择功能</option>{features.map(feature => { const reason = featureDisabledReason(state, "UC", feature.id); return <option key={feature.id} value={feature.id} disabled={Boolean(reason)}>{feature.name}{reason ? ` · ${reason}` : ""}</option>; })}</select></div>}</div>
      {!readOnly && <div className="conversation-footer"> <details className="conversation-test-options"><summary>测试选项</summary><button disabled={busy || !c.prompt.trim() || Boolean(invalidFeature)} onClick={() => onSend("send", false, true)}>模拟一次失败</button></details></div>}
    </div>
  </section>;
}

export function ProjectConversation(props: ProjectConversationProps) {
  return props.readOnly ? <LiveProjectConversation {...props} /> : <MockProjectConversation {...props} />;
}

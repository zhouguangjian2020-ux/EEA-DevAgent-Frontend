import { useLayoutEffect, useId, useRef, useState } from "react";
import type { WorkspaceObject } from "@/features/workspace/tree";

export function SparklesIcon() { return <span className="sparkles-icon" aria-hidden="true" />; }
export type ChatComposerProps = {
  label?: string; placeholder?: string; value: string; onChange: (value: string) => void; onSend: () => void; onExpand?: () => void; onCancel?: () => void;
  busy?: "expand" | "generate" | null; compact?: boolean; disabledReason?: string;
  sendDisabledReason?: string; attachmentsLocked?: boolean; onOpenAttachment?: (id: string) => void;
  attachments?: WorkspaceObject[]; onRemoveAttachment?: (id: string) => void;
};
export function ChatComposer({ label = "任务描述", placeholder, value, onChange, onSend, onExpand, onCancel, busy, compact, disabledReason, sendDisabledReason, attachmentsLocked, onOpenAttachment, attachments = [], onRemoveAttachment }: ChatComposerProps) {
  const hintId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field) return;
    const resize = () => {
      if (!field.clientWidth) return;
      field.style.height = "auto";
      field.style.height = `${Math.min(field.scrollHeight, parseFloat(getComputedStyle(field).maxHeight) || 132)}px`;
      if (busy === "expand") field.scrollTop = field.scrollHeight;
    };
    let width = field.clientWidth;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width !== width) { width = entry.contentRect.width; resize(); }
    });
    resize();
    observer.observe(field);
    return () => observer.disconnect();
  }, [busy, value, compact]);
  const disabled = Boolean(disabledReason);
  return <div className={`chat-composer${compact ? " compact" : ""}`} data-testid="chat-composer">
    {attachments.length > 0 && <div className="composer-attachments" aria-label="已添加附件">{attachments.map((o) => <span key={o.id}>{onOpenAttachment ? <button type="button" className="attachment-open" aria-label={`查看附件 ${o.name}`} onClick={() => onOpenAttachment(o.id)}>{o.functionName} / {o.name}</button> : `${o.functionName} / ${o.name}`}<button disabled={attachmentsLocked} type="button" aria-label={`移除附件 ${o.name}`} onClick={() => onRemoveAttachment?.(o.id)}>×</button></span>)}</div>}
    <textarea ref={textarea} rows={2} aria-label={label} aria-describedby={hintId} aria-busy={busy === "expand"} value={value} disabled={disabled} readOnly={busy === "expand"}
      placeholder={disabledReason ?? placeholder ?? (compact ? "继续补充或修改这份 PRD…" : "描述你想创建的功能…")}
      onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && value.trim() && !busy && !disabled && !sendDisabledReason) { e.preventDefault(); onSend(); }
      }} />
    <div className="composer-tools">
      {onExpand && <button type="button" className="expand-button" title="优化当前输入，只回填，不自动发送" onClick={onExpand} disabled={!value.trim() || Boolean(busy) || disabled} aria-busy={busy === "expand"}>
        <SparklesIcon /><span>自动扩写</span>{busy === "expand" && <span className="loading-icon" aria-label="扩写中" />}
      </button>}
      <span className="composer-tools-spacer" />
      {busy && onCancel ? <button type="button" className="stop-button" onClick={onCancel}>停止</button> : <button type="button" className="send-button" aria-label="发送提示词" title={disabledReason ?? sendDisabledReason ?? "发送（Ctrl / ⌘ + Enter）"} aria-describedby={hintId} disabled={!value.trim() || disabled || Boolean(busy) || Boolean(sendDisabledReason)} onClick={onSend}>↑</button>}
    </div>
    <p className="sr-only" id={hintId}>{disabledReason ?? sendDisabledReason ?? (busy === "expand" ? "正在扩写，完成后直接更新输入框…" : busy === "generate" ? "正在生成，可继续输入下一条要求，不会自动发送。" : onExpand ? "自动扩写只优化提示词，不会自动发送" : "Ctrl / ⌘ + Enter 发送，Enter 换行")}</p>
  </div>;
}

export function UnconnectedComposer({ feature }: { feature: string }) {
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState("");
  return <><ChatComposer value={value} onChange={setValue} onSend={() => setNotice(`${feature}的生成服务尚未接入，输入内容已保留。`)} /><p className="workspace-notice" role="status">{notice}</p></>;
}

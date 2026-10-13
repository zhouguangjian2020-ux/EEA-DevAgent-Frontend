"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/features/i18n/provider";
import type { Thread } from "@/features/workbench/workflow-api";

type Props = {
  threads: Thread[]; selectedId: string; disabled: boolean; initializing: boolean; hasMore: boolean;
  onSelect: (id: string) => Promise<void>; onCreate: () => Promise<void>; onMore: () => Promise<void>;
  children?: ReactNode;
};

export function ConversationHistoryMenu({ threads, selectedId, disabled, initializing, hasMore, onSelect, onCreate, onMore, children }: Props) {
  const { t: tr } = useI18n();
  const [open, setOpen] = useState(false);
  const id = useId(), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="conversation-history-root" ref={root} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" className="conversation-history-trigger" aria-label={tr("会话历史")} title={tr("会话历史")} aria-expanded={open} aria-haspopup="dialog" aria-controls={id} onClick={() => setOpen(value => !value)}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 10a8.5 8.5 0 1 1 .5 6M3.5 4.5V10H9" /><path d="M12 7v5l3 2" /></svg>
    </button>
    {open && <div id={id} ref={panel} className="conversation-history-popover" role="dialog" aria-label={tr("会话历史")} tabIndex={-1}>
      <h2>{tr("会话历史")}</h2>
      <label className="conversation-history-select"><span>{tr("选择会话")}</span><select aria-label={tr("选择会话")} value={selectedId} disabled={disabled} onChange={event => { void onSelect(event.target.value); setOpen(false); trigger.current?.focus(); }}>
        <option value="" disabled>{initializing ? tr("正在准备新会话…") : tr("请选择会话")}</option>
        {threads.map(thread => <option key={thread.id} value={thread.id}>{thread.title}</option>)}
      </select></label>
      {hasMore && <button type="button" className="conversation-history-more" disabled={disabled} onClick={() => void onMore()}>{tr("更多会话")}</button>}
      {children}
      <div className="conversation-history-footer"><button type="button" className="button-secondary" disabled={disabled} onClick={() => { void onCreate(); setOpen(false); trigger.current?.focus(); }}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>{tr("新建对话")}</button></div>
    </div>}
  </div>;
}

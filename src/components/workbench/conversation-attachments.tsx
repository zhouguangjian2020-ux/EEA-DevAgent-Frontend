"use client";
import { useI18n } from "@/features/i18n/provider";
import type { ConversationAttachmentItem } from "@/features/conversation/attachments";
import "./conversation-attachments.css";

export function ConversationAttachments({ items }: { items: ConversationAttachmentItem[] }) {
  const { t: tr } = useI18n();
  if (!items.length) return null;
  return <details className="conversation-attachments">
    <summary>
      <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m7 11 6-6a2 2 0 0 1 3 3l-7 7a3.5 3.5 0 0 1-5-5l7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span>{tr("本轮对象快照（{0}）", { "0": items.length })}</span>
      <svg className="conversation-attachments-chevron" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 3 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </summary>
    <ul>{items.map(item => <li key={item.id + (item.revisionId ?? "")}>
      {item.kind && <span className="conversation-attachment-kind">{item.kind}</span>}
      <span>{item.name}</span>
    </li>)}</ul>
  </details>;
}

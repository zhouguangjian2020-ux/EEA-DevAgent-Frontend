"use client";
import { useState } from "react";
import { conversationReplyPresentation, PROPOSAL_SUMMARY } from "@/features/conversation/reply-presentation";
import { useI18n } from "@/features/i18n/provider";
import { AgentMarkdown } from "./agent-markdown";
import { ConversationDisclosureChevron } from "./conversation-disclosure";

/** Raw generation output stays inside execution details, collapsed until requested. */
export function ConversationGeneratedBody({ body }: { body: string }) {
  const { t: tr } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (!body) return null;
  return <details className="conversation-reply-disclosure" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>
      <ConversationDisclosureChevron open={expanded} />
      <strong className="conversation-activity-heading">{tr("生成正文")}</strong>
      <span className="conversation-reply-state">{tr(expanded ? "收起" : "展开查看")}</span>
    </summary>
    <div className="conversation-reply-content">
      {expanded && <AgentMarkdown>{body}</AgentMarkdown>}
    </div>
  </details>;
}

/** Only final answers and one preview receipt are displayed outside execution details. */
export function ConversationReply({ body, status, proposalCount = 0 }: { body: string; status: string; proposalCount?: number }) {
  const { t: tr } = useI18n();
  const presentation = conversationReplyPresentation(body, status, proposalCount);
  if (presentation.kind === "streaming") return null;
  if (presentation.kind === "proposal") return <AgentMarkdown>{tr(PROPOSAL_SUMMARY, { count: presentation.count })}</AgentMarkdown>;
  return <AgentMarkdown>{presentation.body}</AgentMarkdown>;
}

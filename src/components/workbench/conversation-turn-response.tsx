"use client";
import type { ConversationActivityRun } from "@/features/conversation/activity";
import type { ConversationContextUsage } from "@/features/conversation/context-usage";
import { conversationReplyPresentation } from "@/features/conversation/reply-presentation";
import { ConversationActivity } from "./conversation-activity";
import { ConversationContextUsageDetails } from "./conversation-context-usage";
import { ConversationGeneratedBody, ConversationReply } from "./conversation-reply";

/** One execution panel per attempt. Missing historical progress is never reconstructed. */
export function ConversationTurnResponse({ body, status, proposalCount = 0, activity, contextUsage }: {
  body: string; status: string; proposalCount?: number;
  activity?: ConversationActivityRun; contextUsage?: ConversationContextUsage;
}) {
  const presentation = conversationReplyPresentation(body, status, proposalCount);
  const generated = presentation.kind === "answer" ? "" : presentation.body;
  const showExecution = Boolean(activity || generated || contextUsage);
  // An empty fallback exposes retained raw output without inventing execution steps or timing.
  const run = activity ?? { startedAt: 0, sequence: 0, items: [], truncated: false };
  return <>
    {showExecution && <ConversationActivity run={run} status={status}
      hasAnswer={status !== "running" && Boolean(body)} showWaitingTime={Boolean(activity)}>
      {generated && <ConversationGeneratedBody key={presentation.kind} body={generated} />}
      {contextUsage && <ConversationContextUsageDetails usage={contextUsage} />}
    </ConversationActivity>}
    <ConversationReply body={body} status={status} proposalCount={proposalCount} />
  </>;
}

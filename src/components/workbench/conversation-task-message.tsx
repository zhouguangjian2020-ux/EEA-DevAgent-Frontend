"use client";
import { AgentMarkdown } from "./agent-markdown";
import { ConversationTaskActivity, type TaskActivityOutcome } from "./conversation-task-activity";
import { useEffect, useState } from "react";
import { useI18n } from "@/features/i18n/provider";
import { AgentTaskDuration } from "./agent-task-duration";
import { ConversationTaskContextDetails } from "./conversation-context-usage";
import { taskLabel, type TaskRecord } from '@/features/workbench/task-records';
import { creationStatus } from './prd-creation-inline';
import type { CreationState } from '@/features/prd/creation';
export function ConversationTaskMessage({ task, current, requestPrompt, failureMessage }: { task: TaskRecord; current?: CreationState; requestPrompt?: string; failureMessage?: string }) {
  const { t: tr } = useI18n();
  const [revealedAt, setRevealedAt] = useState<number>();
  useEffect(() => {
    if (!task.assistant_visible_at) return;
    const target = task.assistant_visible_at;
    const timer = setTimeout(() => setRevealedAt(target), Math.max(0, target - Date.now()));
    return () => clearTimeout(timer);
  }, [task.assistant_visible_at]);
  const showResponse = !task.assistant_visible_at || revealedAt === task.assistant_visible_at;
  const prompt = task.request_message ?? current?.input?.message ?? requestPrompt;
  // A successful server receipt is terminal; opening/re-reading it (or losing
  // that read connection) must not hide its persisted duration. A saved PRD
  // cannot be retried as a fresh attempt. For retryable tasks, keep suppressing
  // the old duration while a write attempt is pending, but not for a pure read.
  const timingPending = task.status !== "succeeded" && Boolean(current && (
    (current.busy && current.phase !== "read") || current.uncertain
    || (current.intent && ['planning', 'planned', 'generating', 'interrupted'].includes(current.intent.status))
    || current.intent?.status === 'saved'
  ));
  const durationMs = timingPending ? null : task.duration_ms;
  // A verified server receipt outranks a lost/aborted local connection.
  const label = task.status === 'succeeded' || task.request_error_code ? taskLabel(task)
    : current && (current.busy || current.uncertain || current.intent) ? creationStatus(current) : taskLabel(task);
  const running = task.status !== "succeeded" && !task.request_error_code && !failureMessage && !current?.error && !current?.uncertain && (task.status === "running" || Boolean(current?.busy));
  const message = task.status === "succeeded" ? label : failureMessage || current?.error || label;
  const outcome: TaskActivityOutcome = task.status === "succeeded" ? "completed"
    : current?.uncertain || task.status === "needs_verification" ? "uncertain"
    : task.request_error_code || failureMessage || current?.error ? "failed"
    : current?.intent?.status === "saved" ? "completed"
    : task.status === "waiting_choice" || current?.intent?.status === "planned" ? "choice"
    : task.status === "preview" ? "preview" : task.status === "empty" ? "empty" : "failed";
  return <div className="live-chat-turn" data-task-id={task.id} data-task-status={task.status}>
    {prompt && <article className="conversation-message user"><p>{prompt}</p></article>}
    {showResponse && <article className="conversation-message assistant">
      <AgentTaskDuration durationMs={durationMs} status={task.status} showUnavailable={!timingPending}/>
      <ConversationTaskActivity message={message} running={running} outcome={outcome}>
        <ConversationTaskContextDetails taskKind={task.task_kind} functionName={task.request_function_name} />
      </ConversationTaskActivity>
      {!running && <AgentMarkdown>{tr(message)}</AgentMarkdown>}
    </article>}
  </div>;
}

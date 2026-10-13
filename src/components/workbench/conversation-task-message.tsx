"use client";
import { TaskProgress } from "@/components/feedback/task-progress";
import { useEffect, useState } from "react";
import { AgentTaskDuration } from "./agent-task-duration";
import { taskLabel, type TaskRecord } from '@/features/workbench/task-records';
import { creationStatus } from './prd-creation-inline';
import type { CreationState } from '@/features/prd/creation';
export function ConversationTaskMessage({ task, current, requestPrompt, failureMessage }: { task: TaskRecord; current?: CreationState; requestPrompt?: string; failureMessage?: string }) {
  const [revealedAt, setRevealedAt] = useState<number>();
  useEffect(() => {
    if (!task.assistant_visible_at) return;
    const target = task.assistant_visible_at;
    const timer = setTimeout(() => setRevealedAt(target), Math.max(0, target - Date.now()));
    return () => clearTimeout(timer);
  }, [task.assistant_visible_at]);
  const showResponse = !task.assistant_visible_at || revealedAt === task.assistant_visible_at;
  const prompt = task.request_message ?? current?.input?.message ?? requestPrompt;
  // A local retry may begin before the next task-history poll. Do not attach the
  // previous attempt's duration while the authoritative PRD attempt is still active.
  const timingPending = Boolean(current && (
    current.busy || current.uncertain
    || (current.intent && ['planning', 'planned', 'generating', 'interrupted'].includes(current.intent.status))
    || (current.intent?.status === 'saved' && task.status !== 'succeeded')
  ));
  const durationMs = timingPending ? null : task.duration_ms;
  // A verified server receipt outranks a lost/aborted local connection.
  const label = task.status === 'succeeded' || task.request_error_code ? taskLabel(task)
    : current && (current.busy || current.uncertain || current.intent) ? creationStatus(current) : taskLabel(task);
  const running = task.status !== "succeeded" && !task.request_error_code && !failureMessage && !current?.error && !current?.uncertain && (task.status === "running" || Boolean(current?.busy));
  return <div className="live-chat-turn" data-task-id={task.id} data-task-status={task.status}>
    {prompt && <article className="conversation-message user"><p>{prompt}</p></article>}
    {showResponse && <article className="conversation-message assistant"><AgentTaskDuration durationMs={durationMs} status={task.status}/><p><TaskProgress text={task.status === "succeeded" ? label : failureMessage || current?.error || label} pending={running} /></p>
    </article>}
  </div>;
}

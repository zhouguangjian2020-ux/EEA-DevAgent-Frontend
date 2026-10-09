"use client";
import { AgentTaskDuration } from "./agent-task-duration";
import { useI18n } from "@/features/i18n/provider";
import { taskLabel, type TaskRecord } from '@/features/workbench/task-records';
import { creationStatus } from './prd-creation-inline';
import type { CreationState } from '@/features/prd/creation';
export function ConversationTaskMessage({ task, current }: { task: TaskRecord; current?: CreationState }) {
  const { t: tr } = useI18n();
  const prompt = task.request_message ?? current?.input?.message;
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
  return <div className="live-chat-turn" data-task-id={task.id} data-task-status={task.status}>
    {prompt && <article className="conversation-message user"><strong>{tr("我")}</strong><p>{prompt}</p></article>}
    <article className="conversation-message assistant"><AgentTaskDuration durationMs={durationMs} status={task.status}/><strong>Agent</strong><p>{tr(label)}</p>
      {task.status !== 'succeeded' && current?.error && <p role="alert">{tr(current.error)}</p>}
    </article>
  </div>;
}

"use client";
import { useI18n } from "@/features/i18n/provider";
import { taskDurationParts } from "@/features/conversation/task-duration";

/** Plain text above the answer, not a task card, button or client-side stopwatch. */
export function AgentTaskDuration({ durationMs, status }: { durationMs?: number | null; status: string }) {
  const { t: tr } = useI18n();
  const duration = taskDurationParts(durationMs, status);
  if (!duration) return null;
  return <small className="agent-task-duration" data-testid="agent-task-duration">
    {duration.minutes === 0 ? tr("用时{seconds}秒", duration) : tr("用时{minutes}分{seconds}秒", duration)}
  </small>;
}

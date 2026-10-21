"use client";
import { useI18n } from "@/features/i18n/provider";
import { isTaskDurationTerminal, taskDurationParts } from "@/features/conversation/task-duration";

/** Plain text above the answer, not a task card, button or client-side stopwatch. */
export function AgentTaskDuration({ durationMs, status, showUnavailable = false }: { durationMs?: number | null; status: string; showUnavailable?: boolean }) {
  const { t: tr } = useI18n();
  const duration = taskDurationParts(durationMs, status);
  if (!duration) return showUnavailable && isTaskDurationTerminal(status)
    ? <small className="agent-task-duration" data-testid="agent-task-duration-unavailable" title={tr("服务端未返回可靠用时，不用页面等待时间推算历史。")}>{tr("用时未记录")}</small>
    : null;
  return <small className="agent-task-duration" data-testid="agent-task-duration">
    {duration.minutes === 0 ? tr("用时{seconds}秒", duration) : tr("用时{minutes}分{seconds}秒", duration)}
  </small>;
}

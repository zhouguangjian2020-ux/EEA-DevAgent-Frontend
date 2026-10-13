"use client";
import { useEffect, useState } from "react";
import { TASK_FEEDBACK_EVENT, type TaskFeedbackEvent } from "@/features/workbench/task-feedback";

// Visual-only mirror of existing in-page request events. No polling, persistence,
// task starts or retries. An uncertain receipt stops the animation, not the task.
export function updateWorkflowLoading(current: TaskFeedbackEvent[], event: TaskFeedbackEvent) {
  const next = current.filter(item => !(item.project === event.project
    && item.task.client_request_id === event.task.client_request_id));
  return event.phase === "start" && event.task.status === "running" ? [...next, event] : next;
}
export function useWorkflowLoading() {
  const [pending, setPending] = useState<TaskFeedbackEvent[]>([]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<TaskFeedbackEvent>).detail;
      if (detail?.task) setPending(current => updateWorkflowLoading(current, detail));
    };
    window.addEventListener(TASK_FEEDBACK_EVENT, receive);
    return () => window.removeEventListener(TASK_FEEDBACK_EVENT, receive);
  }, []);
  return (project: string, feature: string, kind: "UC" | "FR" | "FR_ALLOCATION") => pending.some(item =>
    item.project === project && item.task.function_id === feature && item.task.task_kind === kind);
}

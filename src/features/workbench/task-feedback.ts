import type { TaskRecord } from "./task-records";

// Page-lifetime feedback only. The backend remains the source of persisted history.
export const TASK_FEEDBACK_EVENT = "workbench-task-feedback";
export type TaskFeedbackEvent = { project: string; thread: string; phase: "start" | "settled"; task: TaskRecord };
export type LocalTaskFeedback = { task: TaskRecord; baselineUpdatedAt?: string };
export function startTaskFeedback(project: string, thread: string | undefined, requestId: string,
  kind: "UC" | "FR" | "FR_ALLOCATION", featureId: string, featureName?: string) {
  const now = new Date().toISOString();
  const task: TaskRecord = { id: "local-" + requestId, client_request_id: requestId, task_kind: kind,
    function_id: featureId, request_function_name: featureName, status: "running", stage: "starting",
    result_count: null, result_available: false, unchanged: false, result_refs: [], created_at: now, updated_at: now,
    assistant_visible_at: Date.now() + 180 };
  let completed = false;
  const publish = (phase: TaskFeedbackEvent["phase"], row: TaskRecord) => {
    if (thread) window.dispatchEvent(new CustomEvent<TaskFeedbackEvent>(TASK_FEEDBACK_EVENT,
      { detail: { project, thread, phase, task: row } }));
  };
  publish("start", task);
  return {
    complete(count: number) {
      completed = true;
      publish("settled", { ...task, status: kind === "FR_ALLOCATION" ? "preview" : "succeeded", stage: "completed",
        result_count: count, updated_at: new Date().toISOString() });
    },
    unresolved() {
      if (!completed) publish("settled", { ...task, status: "needs_verification", stage: "completed", updated_at: new Date().toISOString() });
    },
  };
}

export function mergeTaskFeedback(remote: TaskRecord[], local: LocalTaskFeedback[]): TaskRecord[] {
  const merged = new Map(remote.map(task => [task.client_request_id, task]));
  for (const entry of local) {
    const saved = merged.get(entry.task.client_request_id);
    // A delayed poll must not replace a completed HTTP receipt with "running",
    // nor resurrect an old failed attempt while an explicit retry is starting.
    const changed = saved && saved.updated_at !== entry.baselineUpdatedAt;
    const serverWins = saved && changed && (entry.task.status === "running"
      || !["running", "needs_verification"].includes(saved.status));
    merged.set(entry.task.client_request_id, { ...(serverWins ? saved : entry.task),
      assistant_visible_at: entry.task.assistant_visible_at });
  }
  return [...merged.values()];
}

import { request } from '@/lib/api/client';
import { projectPath, type Turn } from './workflow-api';

export type TaskRecord = {
  /** Transient UI timing, never sent to the API or persisted. */
  assistant_visible_at?: number;
  duration_ms?: number | null;
  request_message?: string | null; request_function_name?: string | null; request_error_code?: string | null;
  id: string; client_request_id: string; task_kind: 'PRD' | 'UC' | 'FR' | 'FR_ALLOCATION' | 'UC_DIAGRAM';
  stage: string; status: 'running' | 'waiting_choice' | 'preview' | 'succeeded' | 'empty' | 'failed' | 'needs_verification';
  function_id: string | null; result_count: number | null; result_available: boolean; unchanged: boolean;
  result_refs: { artifact_id: string; revision_id: string }[]; created_at: string; updated_at: string;
};
export async function readTaskRecords(project: string, thread: string, signal: AbortSignal): Promise<TaskRecord[]> {
  const rows: TaskRecord[] = []; let offset: number | null = 0;
  // The 100-task limit is an Agent context limit, not a history-storage limit.
  // Follow the server's 50-row pages; the caller's abort deadline bounds the read.
  while (offset !== null) {
    const data: { tasks: TaskRecord[]; next_offset: number | null } = await request(
      projectPath(project) + '/conversations/' + encodeURIComponent(thread) + '/tasks?offset=' + offset,
      { signal, cache: 'no-store' });
    if (!Array.isArray(data.tasks) || data.next_offset !== null && (!Number.isSafeInteger(data.next_offset) || data.next_offset <= offset || !data.tasks.length)) throw new Error('任务记录分页异常');
    rows.push(...data.tasks); offset = data.next_offset;
  }
  return [...new Map(rows.map(row => [row.id, row])).values()];
}
export function taskLabel(t: TaskRecord): string {
  if (t.request_error_code === 'function_name_conflict') return '该功能已存在，本次生成已终止，未复用或改名。';
  if (t.request_error_code === 'prd_exists') return '该功能已有PRD，本次未生成或覆盖。';
  const kind = ({ PRD: 'PRD', UC: 'UC', FR: 'FR', FR_ALLOCATION: 'FR分配建议', UC_DIAGRAM: 'UC图' })[t.task_kind];
  if (t.status === 'running') return ({ planning: '正在分析功能定义', creating_function: '正在准备功能', saving: `正在保存${kind}` } as Record<string, string>)[t.stage] ?? `正在生成${kind}`;
  if (t.status === 'waiting_choice') return '功能计划已就绪，尚未生成PRD；请在顶部任务恢复中核对并继续原任务';
  if (t.status === 'succeeded') return t.result_count === null ? '任务已完成；结果当前不可访问' : t.task_kind === 'PRD' ? 'PRD已保存为待确认版本' : `已新增 ${t.result_count} 条待确认${kind}`;
  if (t.status === 'preview') {
    if (t.task_kind === 'UC_DIAGRAM') return t.unchanged ? '已确认UC未变化，沿用当前图' : 'UC图已生成；请在UC视图查看';
    if (t.task_kind === 'FR_ALLOCATION') return t.result_count === null ? '分配建议已返回，当前无权读取结果' : `已生成 ${t.result_count} 条分配建议，尚未保存或确认`;
    return 'PRD预览已生成，尚未保存或确认';
  }
  if (t.status === 'empty') return t.task_kind === 'UC_DIAGRAM' ? '没有已确认UC，本次未调用Agent绘图' : '没有可用结果，本次未新增对象';
  if (t.status === 'needs_verification') return '执行状态待核实；请核对原入口回执，不要直接重复生成';
  if (t.task_kind === "UC" && t.status === "failed") return "UC生成失败；历史记录未保留具体错误，请在原PRD入口核对后重试。";
  return `${kind}任务未完成，请在原入口核对或重试`;
}
export type TimelineEntry = { key: string; time: number; turn: Turn; task?: never } | { key: string; time: number; task: TaskRecord; turn?: never };
export function conversationTimeline(turns: Turn[], tasks: TaskRecord[]): TimelineEntry[] {
  return [...turns.map((turn, index) => ({ key: 'turn-' + turn.client_request_id, time: turn.created_at ? Date.parse(turn.created_at) : Number.MAX_SAFE_INTEGER - turns.length + index, turn })),
    ...tasks.map(task => ({ key: 'task-' + task.client_request_id, time: Date.parse(task.created_at), task }))]
    .sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : a.key.localeCompare(b.key));
}

// Task records provide stable request identity across refresh/retry. Derive a
// human-readable source label from the existing project workspace, never an ID.
export function taskRequestPrompt(task: TaskRecord, state: import("./model").ProjectWorks,
  tr: (text: string, params?: Record<string, string | number>) => string): string | undefined {
  if (task.request_message) return task.request_message;
  if (!["UC", "FR", "FR_ALLOCATION"].includes(task.task_kind)) return undefined;
  const source = Object.values(state.works).find(w => w.featureId === task.function_id && w.kind === "PRD");
  const localRequest = Object.values(state.works).find(w => w.kind === "PRD" && w.ucRequestFeedback?.requestId === task.client_request_id);
  const feature = task.request_function_name ?? (localRequest?.kind === "PRD" ? localRequest.ucRequestFeedback?.featureName : undefined)
    ?? (task.function_id ? state.features[task.function_id]?.name : undefined)
    ?? source?.featureName ?? Object.values(state.works).find(w => w.featureId === task.function_id)?.featureName;
  if (!feature) return tr(task.task_kind === "UC" ? "基于已确认的PRD生成UC。"
    : task.task_kind === "FR" ? "基于已确认的UC生成FR。" : "基于已确认的FR和项目子系统目录生成FR分配建议。");
  if (task.task_kind === "UC") return tr("为功能「{name}」，基于「{prd}」文件生成UC。", { name: feature, prd: "PRD · " + feature });
  if (task.task_kind === "FR") return tr("为功能「{name}」，基于已确认的UC生成功能需求FR。", { name: feature });
  return tr("为功能「{name}」，基于已确认的FR和项目子系统目录生成FR分配建议。", { name: feature });
}

// Bind the actual HTTP error to its originating request, never to the selected tab.
export function taskFailureMessage(task: TaskRecord, state: import("./model").ProjectWorks): string | undefined {
  if (task.task_kind !== "UC" || !["failed", "needs_verification"].includes(task.status)) return undefined;
  const work = Object.values(state.works).find(w => w.kind === "PRD" && w.ucRequestFeedback?.requestId === task.client_request_id);
  return work?.kind === "PRD" ? work.ucRequestFeedback?.message : undefined;
}

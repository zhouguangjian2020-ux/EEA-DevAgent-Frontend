import { request } from '@/lib/api/client';
import { projectPath, type Turn } from './workflow-api';

export type TaskRecord = {
  id: string; client_request_id: string; task_kind: 'PRD' | 'UC' | 'FR' | 'FR_ALLOCATION' | 'UC_DIAGRAM';
  stage: string; status: 'running' | 'waiting_choice' | 'preview' | 'succeeded' | 'empty' | 'failed' | 'needs_verification';
  function_id: string | null; result_count: number | null; result_available: boolean; unchanged: boolean;
  result_refs: { artifact_id: string; revision_id: string }[]; created_at: string; updated_at: string;
};
export async function readTaskRecords(project: string, thread: string, signal: AbortSignal): Promise<TaskRecord[]> {
  const rows: TaskRecord[] = []; let offset: number | null = 0;
  // The server contract allows at most 100 records per thread (50 per page).
  for (let page = 0; offset !== null && page < 3; page++) {
    const data: { tasks: TaskRecord[]; next_offset: number | null } = await request(
      projectPath(project) + '/conversations/' + encodeURIComponent(thread) + '/tasks?offset=' + offset,
      { signal, cache: 'no-store' });
    if (!Array.isArray(data.tasks) || data.next_offset !== null && data.next_offset <= offset) throw new Error('任务记录分页异常');
    rows.push(...data.tasks); offset = data.next_offset;
  }
  if (offset !== null || rows.length > 100) throw new Error('任务记录超过会话上限');
  return [...new Map(rows.map(row => [row.id, row])).values()];
}
export function taskLabel(t: TaskRecord): string {
  const kind = ({ PRD: 'PRD', UC: 'UC', FR: 'FR', FR_ALLOCATION: 'FR分配建议', UC_DIAGRAM: 'UC图' })[t.task_kind];
  if (t.status === 'running') return ({ planning: '正在分析功能定义', creating_function: '正在准备功能', saving: `正在保存${kind}` } as Record<string, string>)[t.stage] ?? `正在生成${kind}`;
  if (t.status === 'waiting_choice') return '功能计划已就绪，等待选择新建或复用';
  if (t.status === 'succeeded') return t.result_count === null ? '任务已完成；结果当前不可访问' : t.task_kind === 'PRD' ? 'PRD已保存为待确认版本' : `已新增 ${t.result_count} 条待确认${kind}`;
  if (t.status === 'preview') {
    if (t.task_kind === 'UC_DIAGRAM') return t.unchanged ? '已确认UC未变化，沿用当前图' : 'UC图已生成；请在UC视图查看';
    if (t.task_kind === 'FR_ALLOCATION') return t.result_count === null ? '分配建议已返回，当前无权读取结果' : `已生成 ${t.result_count} 条分配建议，尚未保存或确认`;
    return 'PRD预览已生成，尚未保存或确认';
  }
  if (t.status === 'empty') return t.task_kind === 'UC_DIAGRAM' ? '没有已确认UC，本次未调用Agent绘图' : '没有可用结果，本次未新增对象';
  if (t.status === 'needs_verification') return '执行状态待核实；请核对原入口回执，不要直接重复生成';
  return `${kind}任务未完成，请在原入口核对或重试`;
}
export type TimelineEntry = { key: string; time: number; turn: Turn; task?: never } | { key: string; time: number; task: TaskRecord; turn?: never };
export function conversationTimeline(turns: Turn[], tasks: TaskRecord[]): TimelineEntry[] {
  return [...turns.map((turn, index) => ({ key: 'turn-' + turn.client_request_id, time: turn.created_at ? Date.parse(turn.created_at) : Number.MAX_SAFE_INTEGER - turns.length + index, turn })),
    ...tasks.map(task => ({ key: 'task-' + task.id, time: Date.parse(task.created_at), task }))]
    .sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : a.key.localeCompare(b.key));
}

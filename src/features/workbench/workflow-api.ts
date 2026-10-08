import { API_BASE_URL, request } from '@/lib/api/client';
import type { FrBody, ManualContent } from './manual-api';
export type SourceSnapshot = { artifact_id: string; revision_id: string; number: string; content: Record<string, unknown> };
export type FrCandidate = FrBody & { candidate_id: string };
export type AllocationCandidate = { candidate_id: string; fr_id: string; fr_revision_id: string; targets: { subsystem_id: string; rationale: string }[]; note: string; unmatched_reason: string };
export type Modification = { original_content?: ManualContent; candidate_id: string; artifact_id: string; base_revision_id: string; content: ManualContent };
export type Generation<T> = { generation_id: string; scene: string; source_version: string; source: { sources: SourceSnapshot[]; subsystems: { subsystem_id: string; name: string; design_version_id: string }[] }; candidates: T[] };
export type Thread = { id: string; title: string };
export type Turn = { created_at?: string; client_request_id: string; prompt: string; body: string; status: string };
export const projectPath = (id: string) => '/v1/projects/' + encodeURIComponent(id);
export function workflowPost<T>(path: string, body: unknown, signal?: AbortSignal) {
  return request<T>(path, { method: 'POST', headers: { 'X-Project-Request': '1' }, body: JSON.stringify(body), signal });
}
export type ChatEvent = { type: string; content?: string; changes?: Modification[]; message?: string; status?: string };
export async function readChatStream(path: string, body: unknown, signal: AbortSignal, onEvent: (event: ChatEvent) => void) {
  const response = await fetch(API_BASE_URL + path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'X-Project-Request': '1' }, body: JSON.stringify(body), signal });
  if (!response.ok) { const b = await response.json().catch(() => null); throw new Error(b?.detail?.message ?? '对话请求失败（' + response.status + '）'); }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('未收到流式响应');
  const reader = response.body.getReader(), decoder = new TextDecoder(), nl = String.fromCharCode(10);
  let buffer = '', done = false;
  try {
    while (!done) {
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replaceAll(String.fromCharCode(13), '');
      if (buffer.length > 2_000_000) throw new Error('流式事件过大');
      const blocks = buffer.split(nl + nl); buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const data = block.split(nl).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join(nl);
        if (!data) continue;
        const event = JSON.parse(data) as ChatEvent;
        if (event.type === 'error') throw new Error(event.message ?? '对话失败');
        if (event.type === 'token' && typeof event.content !== 'string') throw new Error('流式内容异常');
        if (event.type === 'done' && event.status !== 'completed') throw new Error('对话未完整完成');
        if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
        onEvent(event);
        if (event.type === 'done') { done = true; break; }
      }
      if (chunk.done && !done) throw new Error('连接断开，回复未完成');
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

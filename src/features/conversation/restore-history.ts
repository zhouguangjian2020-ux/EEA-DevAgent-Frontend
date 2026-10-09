import { request, ApiError } from '@/lib/api/client';
import { workflowPost, type Thread, type Turn } from '@/features/workbench/workflow-api';
export type ConversationHistory = { thread: Thread; turns: Turn[] };
export async function restoreConversation(path: string, creationId: string, preferred?: string): Promise<ConversationHistory> {
  // Authenticate the list first. A failed read must never cause a replacement POST.
  const page = await request<{ threads: Thread[]; next_offset: number | null }>(path, { cache: 'no-store' });
  if (preferred && /^[0-9a-f-]{36}$/i.test(preferred)) {
    try { return await request<ConversationHistory>(path+'/'+encodeURIComponent(preferred), { cache: 'no-store' }); }
    catch (e) { if (!(e instanceof ApiError) || ![403,404].includes(e.status)) throw e; }
  }
  if (page.threads.length) return request<ConversationHistory>(path+'/'+encodeURIComponent(page.threads[0].id), { cache: 'no-store' });
  const thread = await workflowPost<Thread>(path, { client_request_id: creationId, title: '新会话' });
  return { thread, turns: [] };
}

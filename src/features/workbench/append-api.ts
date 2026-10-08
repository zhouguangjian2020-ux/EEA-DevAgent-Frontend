import { workflowPost, projectPath } from './workflow-api';
export type AppendedBatch = { generation_id: string; kind: 'UC' | 'FR'; status: 'succeeded'; project_id: string; function_id: string; source_version: string; replayed: boolean; items: { artifact_id: string; revision_id: string; function_id: string; created: boolean }[] };
export async function appendGenerated(project: string, feature: string, kind: 'UC' | 'FR', input: {client_request_id: string; thread_id?: string; prd_id?: string; prd_revision_id?: string}, signal?: AbortSignal) {
  const result = await workflowPost<AppendedBatch>(projectPath(project)+'/functions/'+feature+'/'+kind.toLowerCase()+'-generations/append', input, signal);
  if(result.status!=='succeeded'||result.generation_id!==input.client_request_id||result.kind!==kind||result.project_id!==project||result.function_id!==feature||!result.items.length||result.items.some(i=>!i.artifact_id||!i.revision_id||i.function_id!==feature)) throw new Error('生成保存回执身份异常，请刷新目录核对后重试');
  return result;
}

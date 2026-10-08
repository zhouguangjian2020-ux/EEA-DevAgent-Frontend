import { request } from '@/lib/api/client';
import { projectPath, workflowPost } from '@/features/workbench/workflow-api';

// Hand-authored feature adapter matching app/schemas/prd_creation.py, not a generated client.
export type FeatureCandidate = { function_id: string; name: string; description: string; match: 'exact_name' | 'similar_name' | 'similar_description'; prd_artifact_id: string | null; can_reuse_for_prd: boolean; blocked_reason: 'prd_exists' | 'prd_create_forbidden' | null };
export type FeaturePlanReview = { client_request_id: string; project_id: string; status: 'ready_to_create' | 'needs_selection' | 'blocked'; definition: { name: string; description: string; description_source: 'agent_output' }; candidates: FeatureCandidate[]; candidate_count: number; has_more: boolean; can_create_new_function: boolean; exact_name_conflict: boolean; phase: 'plan_review' };
export type PrdCreationIntent = { id: string; project_id: string; client_request_id: string; version: number; status: 'planning' | 'planned' | 'generating' | 'failed' | 'blocked' | 'saved' | 'interrupted'; next_phase: 'plan' | 'choose' | 'generate' | 'open'; review: FeaturePlanReview | null; function_id: string | null; artifact_id: string | null; revision_id: string | null; error_code: string | null; saved_as: 'pending' | null };
export type CreationChoice = { action: 'auto' | 'continue' } | { action: 'create'; name?: string } | { action: 'reuse'; function_id: string };
export type CreationInput = { client_request_id: string; message: string; thread_id?: string };
const path = (project: string) => projectPath(project) + '/prd-creations/intents';
export const prdCreationApi = {
  create: (project: string, input: CreationInput, signal: AbortSignal) => workflowPost<PrdCreationIntent>(path(project), input, signal),
  read: (project: string, input: CreationInput, intent: PrdCreationIntent | null, signal: AbortSignal) => request<PrdCreationIntent>(path(project) + (intent ? '/' + encodeURIComponent(intent.id) : '?client_request_id=' + encodeURIComponent(input.client_request_id)), { signal, cache: 'no-store' }),
  execute: (project: string, intent: PrdCreationIntent, choice: CreationChoice, signal: AbortSignal) => workflowPost<PrdCreationIntent>(path(project) + '/' + encodeURIComponent(intent.id) + '/execute', { expected_version: intent.version, ...choice }, signal),
};

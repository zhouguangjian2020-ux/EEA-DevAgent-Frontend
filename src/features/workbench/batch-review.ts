import { UC_BATCH_LIMIT, FR_BATCH_LIMIT } from "./batch-limits";
import { ApiError } from "@/lib/api/client";
import { workflowPost, projectPath } from "./workflow-api";
import { allocationReviewReason, allocationReviewVersion, type AllocationRow, type AllocationReviewTarget, type AllocationReviewResult } from "./allocation-review";

export type ArtifactReviewInput = { artifact_id: string; revision_id: string; mutation_id: string };
export type BatchItemReceipt = { artifact_id: string; revision_id: string | null; accepted: boolean; saved: boolean; error_code: string | null; error_message: string | null };
export type BatchReceipt = { function_id: string; items: BatchItemReceipt[] };
export const REVIEW_LIMITS = { UC: UC_BATCH_LIMIT, FR: FR_BATCH_LIMIT, FR_ALLOCATION: FR_BATCH_LIMIT } as const;
export function reviewLimitMessage(kind: keyof typeof REVIEW_LIMITS) {
  return `每批最多确认${REVIEW_LIMITS[kind]}条，请缩小选择范围。`;
}
export const REVIEW_UNCERTAIN = "批量确认回执未取得；请先刷新核对，重试将复用原确认标识。";

async function postBatch(project: string, featureId: string, kind: "artifacts" | "allocations", body: unknown,
  expected: { id: string; revision: string; saves: boolean }[], reviewKind: keyof typeof REVIEW_LIMITS, signal?: AbortSignal): Promise<BatchReceipt> {
  if (!expected.length || expected.length > REVIEW_LIMITS[reviewKind]) throw new Error(reviewLimitMessage(reviewKind));
  const result = await workflowPost<BatchReceipt>(projectPath(project) + "/functions/" + encodeURIComponent(featureId) + "/" + kind + "/batch-accept", body, signal);
  const seen = new Set<string>();
  if (result.function_id !== featureId || !Array.isArray(result.items) || result.items.length !== expected.length) throw new Error(REVIEW_UNCERTAIN);
  for (const item of result.items) {
    const original = expected.find(row => row.id === item?.artifact_id);
    if (!original || seen.has(item.artifact_id) || typeof item.accepted !== "boolean" || typeof item.saved !== "boolean"
      || item.saved && !original.saves || item.accepted && original.saves && !item.saved
      || (item.accepted || item.saved) && item.revision_id !== original.revision
      || !item.accepted && (!item.error_code || typeof item.error_message !== "string")) throw new Error(REVIEW_UNCERTAIN);
    seen.add(item.artifact_id);
  }
  return result;
}
export function confirmArtifactBatch(project: string, featureId: string, kind: "UC" | "FR", items: ArtifactReviewInput[], signal?: AbortSignal) {
  return postBatch(project, featureId, "artifacts", { kind, items }, items.map(x => ({ id: x.artifact_id, revision: x.revision_id, saves: false })), kind, signal);
}
export async function confirmAllocationBatch(project: string, featureId: string, targets: AllocationReviewTarget[],
  lookup: (id: string) => AllocationRow | undefined, capabilities: readonly string[],
  apply: (row: AllocationRow, receipt: BatchItemReceipt) => void, signal?: AbortSignal): Promise<AllocationReviewResult> {
  const result: AllocationReviewResult = { accepted: [], failed: [] }, rows: AllocationRow[] = [];
  for (const target of [...new Map(targets.map(x => [x.id, x])).values()]) {
    const row = lookup(target.id);
    const reason = signal?.aborted ? REVIEW_UNCERTAIN : !row ? "分配已移除，请刷新后重试"
      : allocationReviewVersion(row) !== target.version ? "分配版本已变化，请重新选择后确认" : allocationReviewReason(row, capabilities);
    if (reason || !row) result.failed.push({ id: target.id, reason }); else rows.push(row);
  }
  if (rows.length > REVIEW_LIMITS.FR_ALLOCATION) return { accepted: [], failed: targets.map(x => ({ id: x.id, reason: reviewLimitMessage("FR_ALLOCATION") })) };
  if (!rows.length) return result;
  const items = rows.map(row => ({ allocation_id: row.allocationId, mutation_id: row.acceptId,
    ...(row.dirty ? { save: { allocation_id: row.allocationId, mutation_id: row.mutation, base_revision_id: row.base,
      fr_id: row.fr_id, fr_revision_id: row.fr_revision_id, design_version_id: row.design, source_version: row.sourceVersion,
      targets: row.targets, note: row.note } } : { revision_id: row.savedRevision }) }));
  try {
    const receipt = await postBatch(project, featureId, "allocations", { items }, rows.map(row => ({ id: row.allocationId,
      revision: row.dirty ? row.mutation : row.savedRevision!, saves: row.dirty })), "FR_ALLOCATION", signal);
    for (const row of rows) {
      const item = receipt.items.find(x => x.artifact_id === row.allocationId)!;
      apply(row, item);
      if (item.accepted) result.accepted.push(row.candidate_id);
      else result.failed.push({ id: row.candidate_id, reason: item.error_message! });
    }
  } catch (error) {
    const reason = error instanceof ApiError ? error.message : REVIEW_UNCERTAIN;
    result.failed.push(...rows.map(row => ({ id: row.candidate_id, reason })));
  }
  return result;
}

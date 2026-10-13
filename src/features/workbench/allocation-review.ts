import type { WorkspaceAllocation } from "@/lib/api/client";
import { createUuid } from "@/lib/uuid";
import type { AllocationCandidate } from "./workflow-api";

export const UNASSIGNED_SUBSYSTEM = "__empty__";
export type AllocationRow = AllocationCandidate & {
  design: string; sourceVersion?: string; allocationId: string; base: string | null;
  savedRevision?: string; accepted?: boolean; dirty: boolean; mutation: string; acceptId: string;
};
// Navigation-only projection. It never turns an unsaved suggestion into a database object.
export type AllocationPreview = {
  allocationId: string; frId: string; targetIds: string[]; dirty: boolean; accepted: boolean;
};
export type AllocationSelection = { subsystemId?: string; allocationId?: string };
export function allocationPreview(rows: AllocationRow[]): AllocationPreview[] {
  return rows.map(row => ({ allocationId: row.allocationId, frId: row.fr_id,
    targetIds: row.targets.map(target => target.subsystem_id), dirty: row.dirty, accepted: Boolean(row.accepted) }));
}
export function rowsForAllocationSelection(rows: AllocationRow[], selection: AllocationSelection): AllocationRow[] {
  return rows.filter(row => (!selection.allocationId || row.allocationId === selection.allocationId)
    && (!selection.subsystemId || (selection.subsystemId === UNASSIGNED_SUBSYSTEM
      ? row.targets.length === 0 : row.targets.some(target => target.subsystem_id === selection.subsystemId))));
}
export function mergeSavedAllocationRows(current: AllocationRow[], saved: WorkspaceAllocation[]): AllocationRow[] {
  const remaining = new Map(current.map(row => [row.allocationId, row]));
  const rows = saved.map(item => {
    const existing = remaining.get(item.id); remaining.delete(item.id);
    // Refresh never overwrites an unsaved candidate or edit; stale sources fail at the existing write API.
    if (existing?.dirty || existing?.savedRevision === item.revision.revision_id
      && Boolean(existing.accepted) === (item.revision.status === "accepted")) return existing;
    return { candidate_id: item.id, design: item.design_version_id, fr_id: item.fr_id,
      fr_revision_id: item.fr_revision_id, targets: item.targets.map(t => ({ subsystem_id: t.subsystem_id, rationale: t.rationale ?? "" })),
      note: item.note ?? "", unmatched_reason: "", allocationId: item.id, base: item.revision.revision_id,
      savedRevision: item.revision.revision_id, accepted: item.revision.status === "accepted", dirty: false,
      mutation: createUuid(), acceptId: createUuid() };
  });
  return [...rows, ...[...remaining.values()].filter(row => row.dirty)];
}

export type AllocationReviewTarget = { id: string; version: string };
export type AllocationReviewResult = { accepted: string[]; failed: { id: string; reason: string }[] };
export function allocationReviewVersion(row: AllocationRow): string {
  return row.dirty ? row.mutation : row.savedRevision ?? "";
}
export function allocationReviewReason(row: AllocationRow, capabilities: readonly string[]): string {
  if (row.accepted && !row.dirty) return "该分配已确认";
  if (!row.targets.length) return "请先选择子系统";
  if (!row.design) return "没有有效的项目子系统目录";
  if (!capabilities.includes("FR_ALLOCATION.accept")) return "当前账号没有分配确认权限";
  if (row.dirty && !capabilities.includes(row.base ? "FR_ALLOCATION.update" : "FR_ALLOCATION.create")) return "当前账号没有分配保存权限";
  if (!row.dirty && !row.savedRevision) return "请先保存当前修改";
  return "";
}
// Selection is bound to an exact draft mutation or saved revision. This is not an atomic batch.
export async function reviewAllocationBatch(
  targets: AllocationReviewTarget[], lookup: (id: string) => AllocationRow | undefined,
  capabilities: readonly string[], save: (row: AllocationRow) => Promise<AllocationRow>,
  accept: (row: AllocationRow) => Promise<void>, signal?: AbortSignal,
): Promise<AllocationReviewResult> {
  const result: AllocationReviewResult = { accepted: [], failed: [] };
  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target.id)) continue;
    seen.add(target.id);
    const row = lookup(target.id);
    const reason = signal?.aborted ? "已停止后续确认；请核对已提交结果" : !row ? "分配已移除，请刷新后重试"
      : allocationReviewVersion(row) !== target.version ? "分配版本已变化，请重新选择后确认" : allocationReviewReason(row, capabilities);
    if (reason || !row) { result.failed.push({ id: target.id, reason }); continue; }
    try {
      const saved = row.dirty ? await save(row) : row;
      if (signal?.aborted) throw new Error("已停止后续确认；请核对已提交结果");
      await accept(saved);
      result.accepted.push(target.id);
    } catch (error) {
      result.failed.push({ id: target.id, reason: error instanceof Error ? error.message : "确认失败，请重试" });
    }
  }
  return result;
}

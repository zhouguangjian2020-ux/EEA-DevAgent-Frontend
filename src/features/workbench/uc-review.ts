import { acceptanceIssue } from "./manual-model";
import { isWorkRunning, type UcWork } from "./model";

export type UcReviewTarget = { id: string; revisionId: string };
export type UcReviewResult = { accepted: string[]; failed: { id: string; reason: string }[] };
export function ucReviewRevision(work: UcWork): string {
  return work.database?.revisionId ?? work.session.document?.id + ":" + work.session.document?.revision;
}
export function ucReviewReason(work: UcWork): string {
  if (!work.session.document) return "用例没有可确认的内容";
  if (work.session.document.status === "accepted") return "该用例已确认";
  if (isWorkRunning(work) || work.session.editDraft !== null || work.session.confirmDiscard) return "请先结束编辑、保存或放弃操作";
  if (work.database ? !work.database.canAccept : work.readOnly) return "当前账号没有UC确认权限";
  return acceptanceIssue(work);
}
export function confirmedUcSignature(works: UcWork[]): string {
  return works.filter(w => w.session.document?.status === "accepted")
    .map(w => w.id + ":" + ucReviewRevision(w)).sort().join("|");
}
// Existing per-object API, not an atomic database batch.
export async function reviewUcBatch(targets: UcReviewTarget[], featureId: string, lookup: (id: string) => UcWork | undefined,
  accept: (work: UcWork) => Promise<boolean>, signal?: AbortSignal): Promise<UcReviewResult> {
  const result: UcReviewResult = { accepted: [], failed: [] };
  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target.id)) continue;
    seen.add(target.id);
    const work = lookup(target.id);
    const reason = signal?.aborted ? "已停止后续确认；请核对已提交结果" : !work || work.featureId !== featureId ? "用例已移除或不属于当前功能"
      : ucReviewRevision(work) !== target.revisionId ? "用例版本已变化，请重新选择后确认" : ucReviewReason(work);
    if (reason || !work) { result.failed.push({ id: target.id, reason: reason || "用例不存在" }); continue; }
    try {
      const ok = await accept(work);
      const latest = lookup(target.id);
      if (ok && latest?.session.document?.status === "accepted" && ucReviewRevision(latest) === target.revisionId) result.accepted.push(target.id);
      else result.failed.push({ id: target.id, reason: latest?.session.notice || "确认结果尚未同步，请核对后重试" });
    } catch (error) { result.failed.push({ id: target.id, reason: error instanceof Error ? error.message : "确认失败，请重试" }); }
  }
  return result;
}

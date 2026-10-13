import { acceptanceIssue } from "./manual-model";
import { isWorkRunning, type FrWork } from "./model";

export type FrReviewTarget = { id: string; revisionId: string };
export type FrReviewResult = { accepted: string[]; failed: { id: string; reason: string }[] };
export function frReviewRevision(work: FrWork): string {
  return work.database?.revisionId ?? work.session.document?.id + ":" + work.session.document?.revision;
}
export function frReviewReason(work: FrWork): string {
  if (!work.session.document) return "需求没有可确认的内容";
  if (work.session.document.status === "accepted") return "该需求已确认";
  if (isWorkRunning(work) || work.session.editDraft !== null) return "请先结束编辑、保存或放弃操作";
  if (work.database ? !work.database.canAccept : work.readOnly) return "当前账号没有FR确认权限";
  return acceptanceIssue(work);
}
// Existing per-object API, not an atomic database batch.
export async function reviewFrBatch(targets: FrReviewTarget[], featureId: string, lookup: (id: string) => FrWork | undefined,
  accept: (work: FrWork) => Promise<boolean>, signal?: AbortSignal): Promise<FrReviewResult> {
  const result: FrReviewResult = { accepted: [], failed: [] };
  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target.id)) continue;
    seen.add(target.id);
    const work = lookup(target.id);
    const reason = signal?.aborted ? "已停止后续确认；请核对已提交结果" : !work || work.featureId !== featureId ? "需求已移除或不属于当前功能"
      : frReviewRevision(work) !== target.revisionId ? "需求版本已变化，请重新选择后确认" : frReviewReason(work);
    if (reason || !work) { result.failed.push({ id: target.id, reason: reason || "需求不存在" }); continue; }
    try {
      const ok = await accept(work);
      const latest = lookup(target.id);
      if (ok && latest?.session.document?.status === "accepted" && frReviewRevision(latest) === target.revisionId) result.accepted.push(target.id);
      else result.failed.push({ id: target.id, reason: latest?.session.notice || "确认结果尚未同步，请核对后重试" });
    } catch (error) { result.failed.push({ id: target.id, reason: error instanceof Error ? error.message : "确认失败，请重试" }); }
  }
  return result;
}

import { ApiError } from "../../lib/api/client";
import { createUuid } from "@/lib/uuid";
import { confirmArtifactBatch, REVIEW_LIMITS, reviewLimitMessage, REVIEW_UNCERTAIN } from "./batch-review";
import { reviewFrBatch, frReviewReason, frReviewRevision, type FrReviewTarget, type FrReviewResult } from "./fr-review";
import { reviewUcBatch, ucReviewReason, ucReviewRevision, type UcReviewTarget, type UcReviewResult } from "./uc-review";
import type { ObjectWork, UcWork, FrWork } from "./model";
import type { WorkbenchActionContext, WorkbenchOperations, WorkbenchWrites } from "./workbench-action-context";
import type { WorkbenchPersistenceActions } from "./workbench-persistence-actions";

type ReviewContext = WorkbenchActionContext & Pick<WorkbenchPersistenceActions, "seedDatabase" | "persist"> & {
  operations: WorkbenchOperations;
  writes: WorkbenchWrites;
};

// Review keeps partial receipts and uncertain outcomes; it does not own hook lifecycle.
export function createWorkbenchReviewActions(getContext: () => ReviewContext) {
  async function confirmDatabaseDocuments(project: string, featureId: string, kind: "UC" | "FR",
    targets: UcReviewTarget[], signal: AbortSignal): Promise<UcReviewResult> {
    const { state, act, workNotice, writes, seedDatabase } = getContext();
    const result: UcReviewResult = { accepted: [], failed: [] };
    const pending: { work: UcWork | FrWork; key: string; mutation: string; revision: string }[] = [];
    const unique = [...new Map(targets.map(target => [target.id, target])).values()];
    if (unique.length > REVIEW_LIMITS[kind]) return { accepted: [], failed: unique.map(x => ({ id: x.id, reason: reviewLimitMessage(kind) })) };
    for (const target of unique) {
      const work = state.current[project]?.works[target.id];
      if (!work || work.kind !== kind || !work.database || work.featureId !== featureId || (work.kind !== "UC" && work.kind !== "FR")) {
        result.failed.push({ id: target.id, reason: "对象已移除或不属于当前功能" }); continue;
      }
      const revision = work.kind === "UC" ? ucReviewRevision(work) : frReviewRevision(work);
      const reason = signal.aborted ? REVIEW_UNCERTAIN : revision !== target.revisionId ? "对象版本已变化，请重新选择后确认"
        : work.kind === "UC" ? ucReviewReason(work) : frReviewReason(work);
      if (reason) { result.failed.push({ id: target.id, reason }); continue; }
      const key = project + "/" + work.id + "/accept", signature = JSON.stringify({ revision_id: revision });
      const previous = writes.current.get(key), attempt = previous?.signature === signature ? previous : { signature, id: createUuid() };
      writes.current.set(key, attempt);
      pending.push({ work, key, mutation: attempt.id, revision });
      act(project, { type: "replace-work", work: { ...work, saving: true } });
    }
    if (!pending.length) return result;
    try {
      const receipt = await confirmArtifactBatch(project, featureId, kind, pending.map(item => ({ artifact_id: item.work.database!.artifactId,
        revision_id: item.revision, mutation_id: item.mutation })), signal);
      for (const item of pending) {
        const saved = receipt.items.find(row => row.artifact_id === item.work.database!.artifactId)!;
        const current = state.current[project]?.works[item.work.id];
        if (saved.accepted) {
          result.accepted.push(item.work.id); writes.current.delete(item.key);
          if (current?.kind === kind && current.database?.revisionId === item.revision && (current.kind === "UC" || current.kind === "FR"))
            act(project, { type: "replace-work", work: { ...current, saving: false,
              database: { ...current.database, acceptedRevisionId: item.revision },
              session: { ...current.session, selected: false, document: current.session.document ? { ...current.session.document, status: "accepted" } : null } } as ObjectWork });
        } else {
          result.failed.push({ id: item.work.id, reason: saved.error_message! });
          workNotice(project, item.work.id, saved.error_message!);
        }
      }
    } catch (error) {
      const reason = error instanceof ApiError ? error.message : REVIEW_UNCERTAIN;
      result.failed.push(...pending.map(item => ({ id: item.work.id, reason })));
    } finally {
      for (const item of pending) {
        const current = state.current[project]?.works[item.work.id];
        if (current?.saving) act(project, { type: "replace-work", work: { ...current, saving: false } });
      }
    }
    // One workspace refresh for the entire response, including uncertain transport outcomes.
    try { await seedDatabase(project, project, { initial: false }); }
    catch { act(project, { type: "notice", message: "确认回执已保留，但目录刷新失败；请刷新核对。" }); }
    return result;
  }
  async function confirmUcs(project: string, overviewId: string, targets: UcReviewTarget[]): Promise<UcReviewResult> {
    const { state, act, operations, persist } = getContext();
    const overview = state.current[project]?.works[overviewId], key = project + "/" + overviewId;
    if (overview?.kind !== "UC_OVERVIEW" || overview.saving || operations.current.has(key)) throw new Error("请等待当前用例图或确认任务结束");
    const controller = new AbortController(), requestId = createUuid();
    operations.current.set(key, { controller, id: requestId, kind: "uc-review" });
    act(project, { type: "replace-work", work: { ...overview, saving: true } });
    try {
      const databaseSelection = targets.some(target => Boolean(state.current[project]?.works[target.id]?.database));
      const result = databaseSelection ? await confirmDatabaseDocuments(project, overview.featureId, "UC", targets, controller.signal) : await reviewUcBatch(targets, overview.featureId, id => {
        const item = state.current[project]?.works[id]; return item?.kind === "UC" ? item : undefined;
      }, async work => {
        act(project, { type: "uc", id: work.id, action: { type: "select", selected: true } });
        if (work.database) return persist(project, work.id, "accept");
        act(project, { type: "uc", id: work.id, action: { type: "accept" } });
        return true;
      }, controller.signal);
      act(project, { type: "notice", message: "已确认 " + result.accepted.length + " 条，未完成 " + result.failed.length + " 条。" });
      return result;
    } finally {
      if (operations.current.get(key)?.id === requestId) operations.current.delete(key);
      const current = state.current[project]?.works[overviewId];
      if (current?.kind === "UC_OVERVIEW") act(project, { type: "replace-work", work: { ...current, saving: false } });
    }
  }
  async function confirmFrs(project: string, overviewId: string, targets: FrReviewTarget[]): Promise<FrReviewResult> {
    const { state, act, operations, persist } = getContext();
    const overview = state.current[project]?.works[overviewId], key = project + "/" + overviewId;
    if (overview?.kind !== "FR_OVERVIEW" || overview.saving || operations.current.has(key)) throw new Error("请等待当前FR生成或确认任务结束");
    const controller = new AbortController(), requestId = createUuid();
    operations.current.set(key, { controller, id: requestId, kind: "fr-review" });
    act(project, { type: "replace-work", work: { ...overview, saving: true } });
    try {
      const databaseSelection = targets.some(target => Boolean(state.current[project]?.works[target.id]?.database));
      const result = databaseSelection ? await confirmDatabaseDocuments(project, overview.featureId, "FR", targets, controller.signal) : await reviewFrBatch(targets, overview.featureId, id => {
        const item = state.current[project]?.works[id]; return item?.kind === "FR" ? item : undefined;
      }, async work => {
        act(project, { type: "fr", id: work.id, action: { type: "select", selected: true } });
        if (work.database) return persist(project, work.id, "accept");
        act(project, { type: "fr", id: work.id, action: { type: "accept" } });
        return true;
      }, controller.signal);
      act(project, { type: "notice", message: "已确认 " + result.accepted.length + " 条，未完成 " + result.failed.length + " 条。" });
      return result;
    } finally {
      if (operations.current.get(key)?.id === requestId) operations.current.delete(key);
      const current = state.current[project]?.works[overviewId];
      if (current?.kind === "FR_OVERVIEW") act(project, { type: "replace-work", work: { ...current, saving: false } });
    }
  }
  return { confirmUcs, confirmFrs };
}

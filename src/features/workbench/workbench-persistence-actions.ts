import { ApiError, updateFunction } from "../../lib/api/client";
import { createUuid } from "@/lib/uuid";
import { metadataError, metadataInput } from "../metadata/model";
import { loadDatabaseWorkspace } from "./database";
import { createManualWork, saveManualRevision, acceptManualRevision, type ManualCreate, type WriteResult } from "./manual-api";
import { acceptanceIssue, draftBody } from "./manual-model";
import { mockManualWork } from "../../mocks/manual-work";
import { createProjectWorks, featureOverviewId, isWorkRunning, projectFeatures, type ObjectWork, type WorkbenchAction } from "./model";
import type { PrdAction } from "../prd/model";
import type { UcAction } from "../uc/model";
import type { FrAction } from "../fr/model";
import type { WorkbenchActionContext, WorkbenchWrites } from "./workbench-action-context";

interface PersistenceContext extends WorkbenchActionContext {
  writes: WorkbenchWrites;
  createBusy: { current: Set<string> };
  createdResults: { current: Map<string, WriteResult> };
}

// Owns persistence/reconciliation only. Request receipts and live state remain hook-owned.
export function createWorkbenchPersistenceActions(getContext: () => PersistenceContext) {
  async function seedDatabase(project: string, projectId: string, options: { openId?: string; savedId?: string; initial?: boolean; removedArtifactIds?: string[]; removedFeatureIds?: string[] } = { initial: true }) {
    const { state, act } = getContext();
    const result = await loadDatabaseWorkspace(projectId);
    act(project, { type: "database-seed", works: result.works, features: result.features, capabilities: result.capabilities,
      openId: options.openId ?? (options.initial && !state.current[project] ? result.openId : undefined), savedId: options.savedId,
      removedArtifactIds: options.removedArtifactIds, removedFeatureIds: options.removedFeatureIds });
    return result.workspace;
  }
  async function refreshAfterDeletion(project: string, result: { id: string; kind: string } | { id: string; kind: string }[]) {
    const { state, act } = getContext();
    const results = Array.isArray(result) ? result : [result];
    const removedArtifactIds = results.filter(item => item.kind !== "function").map(item => item.id);
    const removedFeatureIds = results.filter(item => item.kind === "function").map(item => item.id);
    // Record confirmed deletion before awaiting refresh, so a late old read cannot revive it.
    act(project, { type: "database-seed", works: [], features: [], removedArtifactIds, removedFeatureIds });
    try {
      await seedDatabase(project, project, { initial: false, removedArtifactIds, removedFeatureIds });
      act(project, { type: "notice", message: "已删除对象；工作空间、侧栏和受影响标签已同步。" });
    } catch (error) {
      act(project, { type: "database-seed", works: [], features: [], capabilities: state.current[project]?.capabilities, removedArtifactIds, removedFeatureIds });
      act(project, { type: "notice", message: "删除已完成，但工作空间刷新失败；已移除当前对象，请稍后重新加载工作空间。" });
      throw error;
    }
  }
  async function createManual(project: string, database: boolean, featureId: string | undefined, input: ManualCreate) {
    const { state, act, createBusy, createdResults } = getContext();
    if (createBusy.current.has(project)) throw new Error("当前项目正在创建，请稍候。");
    createBusy.current.add(project);
    try {
      if (!database) {
        if (input.kind === "function") { act(project, { type: "manual-feature", feature: { id: input.creation_id, name: input.name.trim(), description: input.description.trim() } }); return; }
        const p = state.current[project] ?? createProjectWorks(), f = projectFeatures(p).find(f => f.id === featureId);
        if (!f) throw new Error("请先选择功能");
        if (input.kind === "PRD" && Object.values(p.works).some(w => w.featureId === f.id && w.kind === "PRD")) throw new Error("该功能已有 PRD");
        const work = mockManualWork(f, input);
        if (work.kind === "UC") work.sourcePrdWorkId = Object.values(p.works).find(w => w.kind === "PRD" && w.featureId === f.id)?.id ?? "";
        act(project, { type: "manual-work", work });
        return;
      }
      const key = project + "/" + input.creation_id;
      const result = createdResults.current.get(key) ?? await createManualWork(project, featureId, input);
      createdResults.current.set(key, result);
      const openId = input.kind === "function" ? featureOverviewId(result.function_id) : input.kind === "PRD" ? "db-prd-" + result.function_id : "db-" + input.kind.toLowerCase() + "-" + result.artifact_id;
      // Retry the same creation ID if this read fails: the server replays, never inserts twice.
      try { await seedDatabase(project, project, { openId }); }
      catch (error) { throw new Error("对象已创建，但工作空间同步失败：" + (error instanceof Error ? error.message : "请重试")); }
      createdResults.current.delete(key);
      act(project, { type: "notice", message: input.kind === "function" ? "功能已创建；各工作空间共用此功能，目录内容为空。" : "已创建待确认草稿；可编辑并保存，确认需要单独确认。" });
    } finally { createBusy.current.delete(project); }
  }
  async function saveFeature(project: string, id: string): Promise<boolean> {
    const { state, act, workNotice } = getContext();
    let w = state.current[project]?.works[id];
    if (w?.kind !== "FEATURE_OVERVIEW" || !w.metadataDraft || w.saving || w.metadataConflict) return false;
    const f = state.current[project].features[w.featureId];
    if (!f || (state.current[project].capabilities && !state.current[project].capabilities?.includes("function.update"))) return false;
    const invalid = metadataError(w.metadataDraft.name, w.metadataDraft.description, "功能");
    if (invalid) { workNotice(project, id, invalid); return false; }
    const input = w.metadataAttempt?.input ?? metadataInput(w.metadataDraft, createUuid());
    if (!state.current[project].capabilities) {
      act(project, { type: "feature-updated", feature: { ...f, name: input.name!, description: input.description ?? "", lockVersion: String(BigInt(f.lockVersion ?? "0") + BigInt(1)) } });
      act(project, { type: "feature-cancel", id }); workNotice(project, id, "功能资料已保存（Mock，仅当前浏览器内存）。"); return true;
    }
    let attempt = w.metadataAttempt ?? { input };
    act(project, { type: "replace-work", work: { ...w, saving: true, metadataAttempt: attempt } });
    try {
      if (!attempt.result) {
        const result = await updateFunction(project, w.featureId, input);
        if (result.id !== w.featureId || result.project_id !== project) throw new Error("资料响应归属不一致，请重试核对");
        attempt = { ...attempt, result };
        const current = state.current[project]?.works[id];
        if (current?.kind === "FEATURE_OVERVIEW") act(project, { type: "replace-work", work: { ...current, metadataAttempt: attempt } });
        act(project, { type: "feature-updated", feature: { ...f, name: result.name, description: result.description ?? "", lockVersion: result.lock_version, canUpdate: result.can_update } });
      }
      // Refresh only metadata. Do not reseed unrelated documents, drafts, tabs or conversations.
      const latest = (await loadDatabaseWorkspace(project)).features.find(item => item.id === w.featureId);
      if (!latest) throw new Error("功能已不可访问，请核对项目状态");
      act(project, { type: "feature-updated", feature: latest });
      const current = state.current[project]?.works[id];
      if (current?.kind === "FEATURE_OVERVIEW") act(project, { type: "replace-work", work: { ...current, saving: false, metadataDraft: undefined, metadataAttempt: undefined, metadataConflict: false, session: { ...current.session, notice: "功能资料已保存，各工作空间已同步。" } } });
      return true;
    } catch (error) {
      const current = state.current[project]?.works[id];
      const rejected = !attempt.result && error instanceof ApiError && [401,403,404,409,415,422].includes(error.status);
      if (current?.kind === "FEATURE_OVERVIEW") act(project, { type: "replace-work", work: { ...current, metadataAttempt: rejected ? undefined : attempt, metadataConflict: rejected && error instanceof ApiError && error.status === 409,
        session: { ...current.session, notice: (attempt.result ? "资料已保存，待同步。请重试同步，不会再次提交修改。" : rejected ? "保存未成功，原输入已保留。" : "暂无法确认保存结果，请重试同一请求；输入已保留并锁定。") + " " + (error instanceof Error ? error.message : "请稍后重试") } } });
      return false;
    } finally {
      w = state.current[project]?.works[id];
      if (w?.kind === "FEATURE_OVERVIEW" && w.saving) act(project, { type: "replace-work", work: { ...w, saving: false } });
    }
  }
  async function reloadFeature(project: string, id: string) {
    const { state, act, workNotice } = getContext();
    const w = state.current[project]?.works[id];
    if (w?.kind !== "FEATURE_OVERVIEW" || w.saving || w.metadataAttempt) return;
    act(project, { type: "replace-work", work: { ...w, saving: true } });
    try {
      const latest = (await loadDatabaseWorkspace(project)).features.find(f => f.id === w.featureId);
      if (!latest) throw new Error("功能不存在或无权访问");
      act(project, { type: "feature-updated", feature: latest });
      const current = state.current[project]?.works[id];
      if (current?.kind === "FEATURE_OVERVIEW") act(project, { type: "replace-work", work: { ...current, saving: false, metadataDraft: undefined, metadataConflict: false, session: { ...current.session, notice: "已重新读取最新功能资料。" } } });
    } catch (error) { workNotice(project, id, "重新读取失败，原输入保留。" + (error instanceof Error ? error.message : "请重试")); }
    finally { const current = state.current[project]?.works[id]; if (current?.saving) act(project, { type: "replace-work", work: { ...current, saving: false } }); }
  }
  async function persist(project: string, id: string, kind: "save" | "accept"): Promise<boolean> {
    const { state, act, workNotice, writes } = getContext();
    const w = state.current[project]?.works[id];
    if (!w?.database || isWorkRunning(w) || (w.kind !== "PRD" && w.kind !== "UC" && w.kind !== "FR")) return false;
    if (!(kind === "save" ? w.database.canUpdate : w.database.canAccept)) { workNotice(project, id, "当前账号没有此操作权限。"); return false; }
    if (kind === "accept") {
      if (!w.session.selected || w.session.editDraft !== null || w.session.document?.status !== "pending") return false;
      const issue = acceptanceIssue(w); if (issue) { workNotice(project, id, issue); return false; }
    }
    const key = project + "/" + id + "/" + kind;
    try {
      const body = kind === "save" ? { base_revision_id: w.database.revisionId, content: draftBody(w) } : { revision_id: w.database.revisionId };
      const signature = JSON.stringify(body), previous = writes.current.get(key);
      const attempt = previous?.signature === signature ? previous : { signature, id: createUuid(), result: undefined as WriteResult | undefined };
      writes.current.set(key, attempt);
      act(project, { type: "replace-work", work: { ...w, saving: true } });
      if (!attempt.result) attempt.result = body.content !== undefined
        ? await saveManualRevision(project, w.database.artifactId, { mutation_id: attempt.id, ...body })
        : await acceptManualRevision(project, w.database.artifactId, { mutation_id: attempt.id, ...body });
      await seedDatabase(project, project, { savedId: id });
      writes.current.delete(key);
      workNotice(project, id, kind === "save" ? "已保存到数据库，当前为待确认新版本；旧确认版本仍保留，需单独确认。" : "当前版本已确认，可作为下游来源。");
      return true;
    } catch (error) {
      workNotice(project, id, (error instanceof Error ? error.message : "操作失败") + " 原输入已保留；可重试同一请求。若提示版本冲突，请复制草稿后取消编辑、刷新并核对。");
      return false;
    } finally {
      const current = state.current[project]?.works[id];
      if (current?.saving) act(project, { type: "replace-work", work: { ...current, saving: false } });
    }
  }
  function objectAction(project: string, id: string, action: PrdAction | UcAction | FrAction) {
    const { state, act } = getContext();
    const w = state.current[project]?.works[id];
    if (!w || isWorkRunning(w) || (w.kind !== "PRD" && w.kind !== "UC" && w.kind !== "FR")) return;
    if (w.database) {
      if (action.type === "save" || action.type === "accept") { void persist(project, id, action.type); return; }
      if (action.type === "edit") {
        if (!w.database.canUpdate || !w.session.document) return;
        act(project, { type: "replace-work", work: { ...w, session: { ...w.session, editDraft: structuredClone(w.session.document.content), notice: "编辑后保存将创建新版本，不覆盖已确认历史。" } } as ObjectWork });
        return;
      }
      if (["discard", "confirm-discard", "start", "generated"].includes(action.type)) return;
    }
    act(project, { type: w.kind.toLowerCase(), id, action } as WorkbenchAction);
  }
  return { seedDatabase, refreshAfterDeletion, createManual, saveFeature, reloadFeature, persist, objectAction };
}

export type WorkbenchPersistenceActions = ReturnType<typeof createWorkbenchPersistenceActions>;

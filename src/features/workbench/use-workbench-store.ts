"use client";
import { appendGenerated } from "./append-api";

import { buildConversationRequest, validateConversationRequest } from "../conversation/model";
import { requestMockConversation } from "../../mocks/conversation";
import { streamPrdExpansion } from "../conversation/api";
import { streamPrdGeneration } from "../prd/api";
import { prdGenerationReason } from "../prd/generation";
import { useEffect, useRef, useState } from "react";
import { forgetDeletedProjects, workbenchReducer, createProjectWorks, isWorkDirty, isWorkRunning, type WorkbenchStore, type WorkbenchAction, type CloseChoice, canGenerateUcBatch, frOverviewId } from "./model";
import type { PrdOperation } from "../prd/model";
import { type UcOperation } from "../uc/model";
import { expandMockPrompt, generateMockPrd, mockWait } from "@/mocks/prd";
import { updateMockUc } from "@/mocks/uc";
import { requestMockFrBatch } from "../../mocks/fr-batch";
import { requestMockUcBatch } from "../../mocks/uc-batch";
import { requestUcDiagram } from "./uc-generation-api";
import { updateMockFr } from "@/mocks/fr";
import type { FrOperation } from "../fr/model";
import { loadDatabaseWorkspace } from "./database";
import { ApiError, updateFunction } from "../../lib/api/client";
import { createUuid } from "@/lib/uuid";
import { metadataError, metadataInput } from "../metadata/model";
import { createManualWork, saveManualRevision, acceptManualRevision, type ManualCreate, type WriteResult } from "./manual-api";
import { acceptanceIssue, draftBody } from "./manual-model";
import { mockManualWork } from "../../mocks/manual-work";
import { featureOverviewId, projectFeatures, type ObjectWork } from "./model";
import type { PrdAction } from "../prd/model";
import type { UcAction } from "../uc/model";
import type { FrAction } from "../fr/model";

type Pending = { controller: AbortController; id: string; kind: "prd-generation" | "PRD" | "UC" | "FR" | "children" | "fr-batch" | "uc-diagram" | "conversation" };
export function useWorkbenchStore(deletedProjectIds: readonly string[], getTaskThread?: (project: string) => string) {
  const deletedProjects = useRef(deletedProjectIds);
  const [store, setStore] = useState<WorkbenchStore>({});
  const state = useRef<WorkbenchStore>({});
  const operations = useRef(new Map<string, Pending>());
  const writes = useRef(new Map<string, { signature: string; id: string; result?: WriteResult }>());
  const generationRetries = useRef(new Map<string, {signature:string; id:string; thread?:string}>());
  const createBusy = useRef(new Set<string>());
  const createdResults = useRef(new Map<string, WriteResult>());
  // Synchronous state reference also guards double clicks before React's next render.
  function act(project: string, action: WorkbenchAction) {
    // A late read/write result must never resurrect an explicitly deleted project.
    if (deletedProjects.current.includes(project)) return;
    state.current = workbenchReducer(state.current, { project, action });
    setStore(state.current);
  }
  useEffect(() => {
    deletedProjects.current = deletedProjectIds;
    for (const project of deletedProjectIds) {
      for (const [key, operation] of operations.current) if (key.startsWith(project + "/")) {
        operation.controller.abort(); operations.current.delete(key);
      }
      for (const key of writes.current.keys()) if (key.startsWith(project + "/")) writes.current.delete(key);
      for (const key of createdResults.current.keys()) if (key.startsWith(project + "/")) createdResults.current.delete(key);
      createBusy.current.delete(project);
    }
    const next = forgetDeletedProjects(state.current, deletedProjectIds);
    if (next !== state.current) { state.current = next; setStore(next); }
  }, [deletedProjectIds]);
  useEffect(() => {
    const pending = operations.current;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (Object.values(state.current).some(p => Boolean(p.conversation.operation || p.conversation.prompt.trim() || p.conversation.messages.length || p.conversation.attachments.length) || Object.values(p.works).some(w => isWorkDirty(w) || isWorkRunning(w) || w.session.prompt.trim() || ("document" in w.session && w.session.document)))) {
        event.preventDefault(); event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { pending.forEach(p => p.controller.abort()); pending.clear(); window.removeEventListener("beforeunload", beforeUnload); };
  }, []);
  async function seedDatabase(project: string, projectId: string, options: { openId?: string; savedId?: string; initial?: boolean; removedArtifactIds?: string[]; removedFeatureIds?: string[] } = { initial: true }) {
    const result = await loadDatabaseWorkspace(projectId);
    act(project, { type: "database-seed", works: result.works, features: result.features, capabilities: result.capabilities,
      openId: options.openId ?? (options.initial && !state.current[project] ? result.openId : undefined), savedId: options.savedId,
      removedArtifactIds: options.removedArtifactIds, removedFeatureIds: options.removedFeatureIds });
    return result.workspace;
  }
  async function refreshAfterDeletion(project: string, result: { id: string; kind: string } | { id: string; kind: string }[]) {
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
  function workNotice(project: string, id: string, message: string) {
    const w = state.current[project]?.works[id];
    if (w) act(project, { type: "replace-work", work: { ...w, session: { ...w.session, notice: message } } as ObjectWork });
  }
  async function saveFeature(project: string, id: string): Promise<boolean> {
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
  async function generatePrd(project: string, workId: string) {
    const key = `${project}/${workId}`, p = state.current[project], w = p?.works[workId];
    if (w?.kind !== "PRD" || operations.current.has(key) || prdGenerationReason(w, p.features[w.featureId]?.description)) return;
    const id = createUuid(), controller = new AbortController();
    act(project, { type: "prd-generation", id: workId, action: { type: "start", id } });
    const current = state.current[project]?.works[workId];
    if (current?.kind !== "PRD" || current.prdGeneration?.id !== id) return;
    operations.current.set(key, { controller, id, kind: "prd-generation" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latest = "";
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      const result = await streamPrdGeneration({ project_id: project, function_id: w.featureId, client_request_id: id, thread_id: getTaskThread?.(project) }, controller.signal, text => {
        latest = text;
        // Batch frequent tokens into visible updates; no simulated typing after completion.
        if (!reducedMotion && timer === undefined) timer = setTimeout(() => {
          timer = undefined;
          if (!controller.signal.aborted) act(project, { type: "prd-generation", id: workId, action: { type: "progress", id, text: latest } });
        }, 80);
      });
      if (!controller.signal.aborted) act(project, { type: "prd-generation", id: workId, action: { type: "done", id, output: result.output, requestId: result.requestId } });
    } catch (error) {
      if (!controller.signal.aborted) act(project, { type: "prd-generation", id: workId, action: { type: "failed", id, message: error instanceof Error ? error.message : "PRD 生成失败，原 PRD 未修改。" } });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (operations.current.get(key)?.id === id) operations.current.delete(key);
    }
  }
  async function runPrd(project: string, workId: string, kind: "expand" | "generate", fail = false, retry = false) {
    const key = `${project}/${workId}`;
    const w = state.current[project]?.works[workId];
    if (w?.kind !== "PRD" || w.readOnly || w.database || operations.current.has(key) || isWorkRunning(w) || w.session.editDraft !== null || w.session.confirmDiscard || w.session.document?.status === "accepted") return;
    const old = retry ? w.session.error?.request : null;
    const prompt = old?.prompt ?? w.session.prompt.trim(); if (!prompt) return;
    const id = createUuid();
    const request: PrdOperation = { id, kind: old?.kind ?? kind, prompt, previous: old?.previous ?? w.session.document, references: old?.references ?? w.attachments.map(o => ({ id: o.id, name: `${o.functionName} / ${o.name}` })) };
    const controller = new AbortController(); operations.current.set(key, { controller, id, kind: "PRD" });
    act(project, { type: "prd", id: workId, action: { type: "start", request, retry } });
    try {
      await mockWait(controller.signal, request.kind === "expand" ? 850 : 1200);
      if (fail) throw new Error("模拟请求失败，已有草稿和请求已保留，可重试。");
      act(project, { type: "prd", id: workId, action: request.kind === "expand" ? { type: "expanded", id, prompt: expandMockPrompt(prompt) } : { type: "generated", id, document: generateMockPrd(project, prompt, request.previous, workId, w.featureName) } });
    } catch (error) {
      if (!controller.signal.aborted) act(project, { type: "prd", id: workId, action: { type: "failed", id, message: error instanceof Error ? error.message : "请求失败，请重试。" } });
    } finally { if (operations.current.get(key)?.id === id) operations.current.delete(key); }
  }
  async function runFr(project: string, workId: string, retry = false) {
    const key = `${project}/${workId}`; const w = state.current[project]?.works[workId];
    if (!w || w.readOnly || w.database || (w.kind !== "FR" && w.kind !== "FR_OVERVIEW") || operations.current.has(key) || isWorkRunning(w)) return;
    const prompt = w.session.error?.request.prompt ?? w.session.prompt.trim(); if (!prompt) return;
    const id = createUuid();
    const request: FrOperation = { id, prompt, previous: w.kind === "FR" ? w.session.document : null, references: w.attachments.map(o => ({ id: o.id, name: `${o.functionName} / ${o.name}` })) };
    const controller = new AbortController(); operations.current.set(key, { controller, id, kind: "FR" });
    act(project, { type: w.kind === "FR" ? "fr" : "fr-overview", id: workId, action: { type: "start", request, retry } });
    try {
      await mockWait(controller.signal, 1050);
      if (w.kind === "FR") {
        if (!w.session.document) return;
        act(project, { type: "fr", id: workId, action: { type: "generated", id, document: updateMockFr(request.previous ?? w.session.document, prompt) } });
      } else {
        act(project, { type: "fr-overview", id: workId, action: { type: "generated", id, document: null as never } });
      }
    } catch (error) {
      if (!controller.signal.aborted) act(project, { type: w.kind === "FR" ? "fr" : "fr-overview", id: workId, action: { type: "failed", id, message: error instanceof Error ? error.message : "请求失败，请重试。" } });
    } finally { if (operations.current.get(key)?.id === id) operations.current.delete(key); }
  }
  async function runUc(project: string, workId: string, retry = false) {
    const key = `${project}/${workId}`; const w = state.current[project]?.works[workId];
    if (w?.kind !== "UC" || !w.session.document || operations.current.has(key) || isWorkRunning(w) || w.session.editDraft || w.session.confirmDiscard || w.session.document.status === "accepted") return;
    const old = retry ? w.session.error?.request : null;
    const prompt = old?.prompt ?? w.session.prompt.trim(); if (!prompt) return;
    const id = createUuid();
    const request: UcOperation = { id, prompt, previous: old?.previous ?? w.session.document, references: old?.references ?? w.attachments.map(o => ({ id: o.id, name: `${o.functionName} / ${o.name}` })) };
    const controller = new AbortController(); operations.current.set(key, { controller, id, kind: "UC" });
    act(project, { type: "uc", id: workId, action: { type: "start", request, retry } });
    try { await mockWait(controller.signal, 1000); act(project, { type: "uc", id: workId, action: { type: "generated", id, document: updateMockUc(request.previous, prompt) } }); }
    catch (error) { if (!controller.signal.aborted) act(project, { type: "uc", id: workId, action: { type: "failed", id, message: error instanceof Error ? error.message : "请求失败，请重试。" } }); }
    finally { if (operations.current.get(key)?.id === id) operations.current.delete(key); }
  }
  async function generateUcs(project: string, workId: string) {
    const key = `${project}/${workId}`;
    const w = state.current[project]?.works[workId];
    if(w?.kind!=='PRD'||operations.current.has(key)||!canGenerateUcBatch(w)) return;
    const signature = `${w.database?.artifactId}/${w.database?.acceptedRevisionId}`;
    const pending = generationRetries.current.get(key);
    const id = pending?.signature===signature ? pending.id : createUuid();
    let thread: string | undefined;
    try { thread = pending?.signature === signature ? pending.thread : w.database ? getTaskThread?.(project) : undefined; }
    catch (e) { act(project, { type: 'notice', message: e instanceof Error ? e.message : '会话尚未就绪' }); return; }
    generationRetries.current.set(key,{signature,id,thread});
    act(project,{type:'uc-start',id:workId,taskId:id});
    const updated=state.current[project]?.works[workId];
    if(updated?.kind!=='PRD'||updated.ucTask!==id)return;
    const controller=new AbortController();operations.current.set(key,{controller,id,kind:'children'});
    try {
      if(updated.database){
        const revision=updated.database.acceptedRevisionId;
        if(!revision)throw new Error('请先确认当前PRD');
        const result=await appendGenerated(project,updated.featureId,'UC',{client_request_id:id,thread_id:thread,prd_id:updated.database.artifactId,prd_revision_id:revision},controller.signal);
        if(controller.signal.aborted)return;
        try { await seedDatabase(project,project,{}); }
        catch { act(project,{type:'notice',message:'UC已保存，目录刷新失败；请刷新工作空间，不要重复生成。'}); }
        act(project,{type:'uc-appended',id:workId,taskId:id,count:result.items.length});
      } else {
        const works=await requestMockUcBatch(project,updated,id,controller.signal);
        act(project,{type:'uc-ready',id:workId,taskId:id,works});
      }
      generationRetries.current.delete(key);
    } catch(error){
      if(!controller.signal.aborted)act(project,{type:'uc-failed',id:workId,taskId:id,message:(error instanceof Error?error.message:'生成失败')+'；可复用本次请求重试，若已保存不会重复创建。'});
    } finally {if(operations.current.get(key)?.id===id)operations.current.delete(key);}
  }
  async function generateUcDiagram(project: string, workId: string, force = false) {
    const key = `${project}/${workId}`;
    const w = state.current[project]?.works[workId];
    if (w?.kind !== "UC_OVERVIEW" || w.sourceMode !== 'database'  || operations.current.has(key) || w.ucDiagram.status === "loading") return;
    const id = createUuid();
    act(project, { type: "uc-diagram-start", id: workId, taskId: id });
    const updated = state.current[project]?.works[workId];
    if (updated?.kind !== "UC_OVERVIEW" || updated.ucDiagram.requestId !== id) return;
    const controller = new AbortController();
    operations.current.set(key, { controller, id, kind: "uc-diagram" });
    try {
      const result = await requestUcDiagram(project, updated.featureId, {
        knownUcSourceVersion: !force && updated.ucDiagram.diagramCode ? updated.ucDiagram.sourceVersion : null,
        clientRequestId: id,
        threadId: force ? getTaskThread?.(project) : undefined,
      }, controller.signal);
      if (result.generation_id !== id || result.scene !== "FROM_UC_CREATE_UC_DIAGRAM"
        || result.source.project_id !== project || result.source.function_id !== updated.featureId
        || !Number.isInteger(result.source.uc_count) || result.source.uc_count < 0
        || !/^[0-9a-f]{64}$/.test(result.source_version)) {
        throw new Error("UC图结果身份或版本异常，请刷新后重试。");
      }
      if (result.status === "succeeded" && (result.diagram_format !== "mermaid" || !result.diagram_code?.trim())) {
        throw new Error("Agent未返回有效的Mermaid图代码，请重试。");
      }
      if (controller.signal.aborted) return;
      const current = state.current[project]?.works[workId];
      if (current?.kind !== "UC_OVERVIEW") return;
      const preservedCode = current.ucDiagram.diagramCode;
      const preservedFormat = current.ucDiagram.diagramFormat;
      const status = result.status;
      act(project, {
        type: "uc-diagram-ready",
        id: workId,
        taskId: id,
        state: {
          status,
          requestId: id,
          sourceVersion: result.source_version,
          ucCount: result.source.uc_count,
          diagramFormat: status === "succeeded" ? result.diagram_format ?? null : status === "empty" ? null : preservedFormat,
          diagramCode: status === "succeeded" ? result.diagram_code ?? null : status === "empty" ? null : preservedCode,
          message: status === "empty" ? "当前功能没有已确认的 UC。" : status === "unchanged" ? "已确认 UC 未变化，沿用上次图代码。" : "UC 图已生成，来源为最新已确认 UC。",
        },
      });
    } catch (error) {
      if (!controller.signal.aborted) act(project, { type: "uc-diagram-failed", id: workId, taskId: id, message: error instanceof Error ? error.message : "UC图生成失败，请重试。" });
    } finally {
      if (operations.current.get(key)?.id === id) operations.current.delete(key);
    }
  }  async function generateFrs(project: string, workId: string) {
    const key = `${project}/${workId}`;
    const w = state.current[project]?.works[workId];
    if (w?.kind !== "UC_OVERVIEW" || operations.current.has(key) || isWorkRunning(w)) return;
    const id = createUuid();
    act(project, { type: "fr-batch-start", id: workId, taskId: id });
    const updated = state.current[project].works[workId];
    if (updated.kind !== "UC_OVERVIEW" || updated.frBatch?.id !== id) return;
    const controller = new AbortController(); operations.current.set(key, { controller, id, kind: "fr-batch" });
    try {
      const works = await requestMockFrBatch(project, updated.featureId, updated.featureName, frOverviewId(state.current[project], updated.featureId), updated.frBatch, controller.signal);
      act(project, { type: "fr-batch-ready", id: workId, taskId: id, works });
    } catch (error) {
      if (!controller.signal.aborted) act(project, { type: "fr-batch-failed", id: workId, taskId: id, message: error instanceof Error ? error.message : "FR 生成失败，请重试。" });
    } finally { if (operations.current.get(key)?.id === id) operations.current.delete(key); }
  }
  async function runConversation(project: string, kind: "send" | "expand" = "send", retry = false, fail = false) {
    const key = project + "/conversation";
    const p = state.current[project] ?? createProjectWorks();
    if (operations.current.has(key) || p.conversation.operation) return;
    const previous = retry ? p.conversation.error?.request : null;
    const request = previous ? { ...previous, id: createUuid() } : buildConversationRequest(project, p, createUuid(), kind);
    const invalid = validateConversationRequest(p, request);
    if (invalid) { act(project, { type: "conversation", action: { type: "notice", message: invalid } }); return; }
    const controller = new AbortController();
    operations.current.set(key, { controller, id: request.id, kind: "conversation" });
    act(project, { type: "conversation", action: { type: "start", request, retry } });
    try {
      const response = request.kind === "expand"
        ? await (async () => {
            const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const result = await streamPrdExpansion(request.prompt, controller.signal, text => {
              if (!reducedMotion) act(project, { type: "conversation", action: { type: "expansion-progress", id: request.id, text } });
            });
            if (reducedMotion) act(project, { type: "conversation", action: { type: "expansion-progress", id: request.id, text: result.text } });
            return { message: "Agent 扩写完成", expandedPrompt: result.text, expansionSource: "agent" as const };
          })()
        : await requestMockConversation(request, controller.signal, fail);
      if (!controller.signal.aborted) act(project, { type: "conversation", action: { type: "success", id: request.id, response } });
    } catch (error) {
      if (!controller.signal.aborted) act(project, { type: "conversation", action: { type: "failed", id: request.id, message: error instanceof Error ? error.message : "请求失败，原输入已保留，请重试。" } });
    } finally { if (operations.current.get(key)?.id === request.id) operations.current.delete(key); }
  }
  function cancelConversation(project: string) {
    const key = project + "/conversation", pending = operations.current.get(key);
    if (!pending) return;
    pending.controller.abort(); operations.current.delete(key);
    act(project, { type: "conversation", action: { type: "cancel", id: pending.id } });
  }
  function cancel(project: string, workId: string) {
    const key = `${project}/${workId}`; const pending = operations.current.get(key); if (!pending) return;
    pending.controller.abort(); operations.current.delete(key);
    if (pending.kind === "prd-generation") act(project, { type: "prd-generation", id: workId, action: { type: "cancel", id: pending.id } });
    else if (pending.kind === "fr-batch") act(project, { type: "fr-batch-failed", id: workId, taskId: pending.id, message: "FR 生成已停止，没有创建新对象，可重新生成。" });
    else if (pending.kind === "children") act(project, { type: "uc-failed", id: workId, taskId: pending.id, message: "已停止等待UC生成；后端可能仍完成保存。可重试同一请求核对回执，已有PRD和UC不被覆盖。" });
    else if (pending.kind === "PRD") act(project, { type: "prd", id: workId, action: { type: "cancel", id: pending.id } });
    else if (pending.kind === "UC") act(project, { type: "uc", id: workId, action: { type: "cancel", id: pending.id } });
    else if (pending.kind === "uc-diagram") act(project, { type: "uc-diagram-cancel", id: workId, taskId: pending.id, message: "UC图生成已停止，可点击刷新重试。" });
    else { const current = state.current[project]?.works[workId]; act(project, { type: current?.kind === "FR" ? "fr" : "fr-overview", id: workId, action: { type: "cancel", id: pending.id } }); }
  }
  async function resolveClose(project: string, id: string, choice: CloseChoice) {
    const w = state.current[project]?.works[id];
    if (w?.saving) return;
    if (choice === "save" && w?.kind === "FEATURE_OVERVIEW") {
      if (await saveFeature(project, id)) { act(project, { type: "resolve-close", id, choice: "cancel" }); act(project, { type: "close", id }); }
      return;
    }
    if (choice === "save" && w?.database) {
      if (await persist(project, id, "save")) { act(project, { type: "resolve-close", id, choice: "cancel" }); act(project, { type: "close", id }); }
      return;
    }
    if (choice === "stop") cancel(project, id);
    act(project, { type: "resolve-close", id, choice });
  }
  return { store, act, saveFeature, reloadFeature, createManual, objectAction, runConversation, cancelConversation, generatePrd, runPrd, runUc, runFr, generateUcs, generateUcDiagram, generateFrs, seedDatabase, refreshAfterDeletion, cancel, resolveClose };
}





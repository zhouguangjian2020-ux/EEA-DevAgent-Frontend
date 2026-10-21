import { assertSafeUcDiagram } from "../panorama/mermaid-safety";
import { appendGenerated } from "./append-api";
import { startTaskFeedback } from "./task-feedback";
import { streamPrdGeneration } from "../prd/api";
import { prdGenerationReason } from "../prd/generation";
import { canGenerateUcBatch, frOverviewId, isWorkRunning } from "./model";
import type { PrdOperation } from "../prd/model";
import type { UcOperation } from "../uc/model";
import type { FrOperation } from "../fr/model";
import { expandMockPrompt, generateMockPrd, mockWait } from "@/mocks/prd";
import { updateMockUc } from "@/mocks/uc";
import { updateMockFr } from "@/mocks/fr";
import { requestMockFrBatch } from "../../mocks/fr-batch";
import { requestMockUcBatch } from "../../mocks/uc-batch";
import { requestUcDiagram } from "./uc-generation-api";
import { createUuid } from "@/lib/uuid";
import { confirmedUcSignature } from "./uc-review";
import type { WorkbenchActionContext, WorkbenchOperations } from "./workbench-action-context";
import type { WorkbenchPersistenceActions } from "./workbench-persistence-actions";

type GenerationContext = Pick<WorkbenchActionContext, "state" | "act"> & Pick<WorkbenchPersistenceActions, "seedDatabase"> & {
  operations: WorkbenchOperations;
  generationRetries: { current: Map<string, { signature: string; id: string; thread?: string }> };
  getTaskThread?: (project: string) => string;
};

// Generation owns requests/progress, while the hook retains cancellation and unmount cleanup.
export function createWorkbenchGenerationActions(getContext: () => GenerationContext) {
  async function generatePrd(project: string, workId: string) {
    const { state, act, operations, getTaskThread } = getContext();
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
    const { state, act, operations } = getContext();
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
    const { state, act, operations } = getContext();
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
    const { state, act, operations } = getContext();
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
    const { state, act, operations, generationRetries, seedDatabase, getTaskThread } = getContext();
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
    const feedback = updated.database ? startTaskFeedback(project, thread, id, 'UC', updated.featureId, updated.featureName) : undefined;
    try {
      if(updated.database){
        const revision=updated.database.acceptedRevisionId;
        if(!revision)throw new Error('请先确认当前PRD');
        const result=await appendGenerated(project,updated.featureId,'UC',{client_request_id:id,thread_id:thread,prd_id:updated.database.artifactId,prd_revision_id:revision},controller.signal);
        if(controller.signal.aborted)return;
        feedback?.complete(result.items.length);
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
    } finally {feedback?.unresolved();if(operations.current.get(key)?.id===id)operations.current.delete(key);}
  }
  async function generateUcDiagram(project: string, workId: string, force = false) {
    const { state, act, operations, getTaskThread } = getContext();
    const key = `${project}/${workId}`;
    const w = state.current[project]?.works[workId];
    if (w?.kind !== "UC_OVERVIEW" || w.sourceMode !== 'database' || w.saving || operations.current.has(key) || w.ucDiagram.status === "loading") return;
    const sourceSignature = confirmedUcSignature(Object.values(state.current[project]?.works ?? {}).filter((item): item is import("./model").UcWork => item.kind === "UC" && item.featureId === w.featureId));
    if (!sourceSignature) {
      act(project, { type: "replace-work", work: { ...w, ucDiagram: { status: "empty", requestId: null, sourceVersion: null, ucCount: 0, diagramFormat: null, diagramCode: null, message: "当前功能没有已确认的 UC。" } } });
      return;
    }
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
      if (result.status === "succeeded") assertSafeUcDiagram(result.diagram_code!);
      if (controller.signal.aborted) return;
      const current = state.current[project]?.works[workId];
      if (current?.kind !== "UC_OVERVIEW") return;
      const latestSignature = confirmedUcSignature(Object.values(state.current[project]?.works ?? {}).filter((item): item is import("./model").UcWork => item.kind === "UC" && item.featureId === w.featureId));
      if (latestSignature !== sourceSignature) throw new Error("用例确认版本已变化，正在重新核对图形来源。");
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
  }
  async function generateFrs(project: string, workId: string) {
    const { state, act, operations } = getContext();
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
  return { generatePrd, runPrd, runFr, runUc, generateUcs, generateUcDiagram, generateFrs };
}

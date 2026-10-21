"use client";
import { useEffect, useRef, useState } from "react";
import { buildConversationRequest, validateConversationRequest } from "../conversation/model";
import { requestMockConversation } from "../../mocks/conversation";
import { requestPrdExpansion } from "../conversation/api";
import { revealExpansion } from "../conversation/reveal";
import { createUuid } from "@/lib/uuid";
import { forgetDeletedProjects, workbenchReducer, createProjectWorks, isWorkDirty, isWorkRunning, type WorkbenchStore, type WorkbenchAction, type CloseChoice, type ObjectWork } from "./model";
import type { WriteResult } from "./manual-api";
import type { WorkbenchPendingOperation, WorkbenchWriteAttempt } from "./workbench-action-context";
import { createWorkbenchPersistenceActions } from "./workbench-persistence-actions";
import { createWorkbenchReviewActions } from "./workbench-review-actions";
import { createWorkbenchGenerationActions } from "./workbench-generation-actions";

export function useWorkbenchStore(deletedProjectIds: readonly string[], getTaskThread?: (project: string) => string) {
  const deletedProjects = useRef(deletedProjectIds);
  const [store, setStore] = useState<WorkbenchStore>({});
  const state = useRef<WorkbenchStore>({});
  const operations = useRef(new Map<string, WorkbenchPendingOperation>());
  const writes = useRef(new Map<string, WorkbenchWriteAttempt>());
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
  function workNotice(project: string, id: string, message: string) {
    const w = state.current[project]?.works[id];
    if (w) act(project, { type: "replace-work", work: { ...w, session: { ...w.session, notice: message } } as ObjectWork });
  }
  // Recreate closures each render, as before; all async actions read the same live refs.
  // Context is acquired only when an action runs, never while rendering.
  const persistence = createWorkbenchPersistenceActions(() => ({ state, act, workNotice, writes, createBusy, createdResults }));
  const { seedDatabase, refreshAfterDeletion, createManual, saveFeature, reloadFeature, persist, objectAction } = persistence;
  const { confirmUcs, confirmFrs } = createWorkbenchReviewActions(() => ({ state, act, workNotice, operations, writes, seedDatabase, persist }));
  const { generatePrd, runPrd, runFr, runUc, generateUcs, generateUcDiagram, generateFrs } = createWorkbenchGenerationActions(() => ({
    state, act, operations, generationRetries, seedDatabase, getTaskThread,
  }));
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
            const result = await requestPrdExpansion(request.prompt, controller.signal);
            await revealExpansion(result.text, controller.signal, text => {
              act(project, { type: "conversation", action: { type: "expansion-progress", id: request.id, text } });
            }, reducedMotion);
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
    else if (pending.kind === "uc-review" || pending.kind === "fr-review") { /* Finish the in-flight confirmation; abort subsequent items. */ }
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
  return { store, act, confirmUcs, confirmFrs, saveFeature, reloadFeature, createManual, objectAction, runConversation, cancelConversation, generatePrd, runPrd, runUc, runFr, generateUcs, generateUcDiagram, generateFrs, seedDatabase, refreshAfterDeletion, cancel, resolveClose };
}





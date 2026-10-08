"use client";

import { useEffect, useReducer, useRef } from "react";
import { createPrdSession, prdStoreReducer, type PrdAction, type PrdOperation } from "./model";
import { expandMockPrompt, generateMockPrd, mockWait } from "@/mocks/prd";
import { createUuid } from "@/lib/uuid";

const emptySession = createPrdSession();
export function usePrdStore(project: string) {
  const [store, dispatch] = useReducer(prdStoreReducer, {});
  const operations = useRef(new Map<string, { controller: AbortController; id: string }>());
  const session = store[project] ?? emptySession;
  useEffect(() => {
    const pending = operations.current;
    return () => { pending.forEach(({ controller }) => controller.abort()); pending.clear(); };
  }, []);
  function act(action: PrdAction) { dispatch({ project, action }); }
  async function run(kind: "expand" | "generate", fail = false, retry = false) {
    if (operations.current.has(project) || session.operation || session.editDraft !== null || session.confirmDiscard || session.document?.status === "accepted") return;
    const previousRequest = retry ? session.error?.request : null;
    const prompt = previousRequest?.prompt ?? session.prompt.trim();
    if (!prompt) return;
    const id = createUuid();
    const request: PrdOperation = { id, kind: previousRequest?.kind ?? kind, prompt, previous: previousRequest?.previous ?? session.document };
    const controller = new AbortController();
    operations.current.set(project, { controller, id });
    dispatch({ project, action: { type: "start", request, retry } });
    try {
      await mockWait(controller.signal, request.kind === "expand" ? 850 : 1200);
      if (fail) throw new Error("模拟请求失败；输入和已有草稿已保留，请重试。");
      if (request.kind === "expand") dispatch({ project, action: { type: "expanded", id, prompt: expandMockPrompt(prompt) } });
      else dispatch({ project, action: { type: "generated", id, document: generateMockPrd(project, prompt, request.previous, id) } });
      return { project, kind: request.kind };
    } catch (error) {
      if (!controller.signal.aborted) dispatch({ project, action: { type: "failed", id, message: error instanceof Error ? error.message : "请求失败，请重试。" } });
    } finally {
      if (operations.current.get(project)?.id === id) operations.current.delete(project);
    }
  }
  function cancel() {
    const pending = operations.current.get(project);
    if (pending) { pending.controller.abort(); operations.current.delete(project); act({ type: "cancel", id: pending.id }); }
  }
  return { session, act, run, cancel };
}


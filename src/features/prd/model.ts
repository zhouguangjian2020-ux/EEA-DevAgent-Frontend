import type { WorkspaceFolder } from "../workspace/tree";

export type PrdDocument = { id: string; functionName: string; content: string; revision: number; status: "pending" | "accepted" };
export type PrdMessage = { id: string; role: "user" | "assistant"; content: string; references?: { id: string; name: string }[]; artifact?: Pick<PrdDocument, "id" | "functionName" | "revision"> & { status: "pending" | "accepted" | "discarded" } };
export type PrdOperation = { id: string; kind: "expand" | "generate"; prompt: string; previous: PrdDocument | null; references?: { id: string; name: string }[] };
export type PrdSession = {
  prompt: string; rootName: string | null; document: PrdDocument | null; messages: PrdMessage[];
  operation: PrdOperation | null; error: { request: PrdOperation; message: string } | null;
  selected: boolean; editDraft: string | null; confirmDiscard: boolean; notice: string;
};
export type PrdAction =
  | { type: "prompt"; value: string }
  | { type: "start"; request: PrdOperation; retry?: boolean }
  | { type: "expanded"; id: string; prompt: string }
  | { type: "generated"; id: string; document: PrdDocument }
  | { type: "failed"; id: string; message: string }
  | { type: "cancel"; id: string }
  | { type: "select"; selected: boolean }
  | { type: "edit" } | { type: "edit-text"; value: string } | { type: "save" } | { type: "cancel-edit" }
  | { type: "accept" } | { type: "confirm-discard" } | { type: "cancel-discard" } | { type: "discard" }
  | { type: "notice"; message: string };

export function createPrdSession(): PrdSession {
  return { prompt: "", rootName: null, document: null, messages: [], operation: null, error: null, selected: false, editDraft: null, confirmDiscard: false, notice: "" };
}
export function canReviewPrd(s: PrdSession): boolean {
  return s.document?.status === "pending" && !s.operation && s.editDraft === null;
}
export function validPrdAcceptance(content: string) { return Boolean(content.trim()); }
function reviewedMessages(s: PrdSession, status: "accepted" | "discarded"): PrdMessage[] {
  return s.messages.map((m) => m.artifact && m.artifact.id === s.document?.id && m.artifact.revision === s.document?.revision ? { ...m, artifact: { ...m.artifact, status } } : m);
}
export function transitionPrd(s: PrdSession, a: PrdAction): PrdSession {
  switch (a.type) {
    case "prompt": return s.operation?.kind === "expand" ? s : { ...s, prompt: a.value };
    case "start": {
      if (s.operation || s.editDraft !== null || s.confirmDiscard || s.document?.status === "accepted" || !a.request.prompt.trim()) return s;
      const generate = a.request.kind === "generate";
      return { ...s, operation: a.request, error: null, notice: "", prompt: generate && !a.retry ? "" : s.prompt,
        messages: generate && !a.retry ? [...s.messages, { id: `${a.request.id}-user`, role: "user", content: a.request.prompt, ...(a.request.references ? { references: a.request.references } : {}) }] : s.messages };
    }
    case "expanded": return s.operation?.id === a.id && s.operation.kind === "expand" ? { ...s, prompt: a.prompt, operation: null, notice: "提示词已扩写，可继续编辑后发送。" } : s;
    case "generated": {
      if (s.operation?.id !== a.id || s.operation.kind !== "generate") return s;
      return { ...s, document: a.document, rootName: a.document.functionName, selected: true, operation: null, error: null,
        messages: [...s.messages, { id: `${a.id}-assistant`, role: "assistant", content: `已${s.document ? "更新" : "生成"}“${a.document.functionName}”的 PRD 草稿（模拟演示）。\n\n你可以在正文区阅读或编辑，也可以继续提出修改要求。确认后，请在下方确认本次产物。`, artifact: { id: a.document.id, functionName: a.document.functionName, revision: a.document.revision, status: "pending" } }] };
    }
    case "failed": return s.operation?.id === a.id ? { ...s, error: { request: s.operation, message: a.message }, operation: null } : s;
    case "cancel": return s.operation?.id === a.id ? { ...s, operation: null, notice: "本轮操作已停止，已有内容和对话已保留。" } : s;
    case "select": return canReviewPrd(s) ? { ...s, selected: a.selected } : s;
    case "edit": return canReviewPrd(s) && !s.confirmDiscard ? { ...s, editDraft: s.document!.content, error: null } : s;
    case "edit-text": return s.editDraft !== null ? { ...s, editDraft: a.value } : s;
    case "cancel-edit": return { ...s, editDraft: null };
    case "save": {
      if (s.editDraft === null || s.document?.status !== "pending") return s;
      const content = s.editDraft;
      return { ...s, document: { ...s.document, content }, editDraft: null, notice: content.trim() ? "草稿已保存，仍为待确认；保存不会自动确认。" : "草稿已保存，但PRD正文为空，确认前需要补充正文。" };
    }
    case "accept": {
      if (!canReviewPrd(s) || !s.selected || s.confirmDiscard) return s;
      if (!validPrdAcceptance(s.document!.content)) return { ...s, notice: "PRD正文不能为空白，补充正文后才能确认。" };
      return { ...s, document: { ...s.document!, status: "accepted" }, selected: false, messages: reviewedMessages(s, "accepted"), notice: "PRD 已确认，可用于后续用例生成。" };
    }
    case "confirm-discard": return canReviewPrd(s) && s.selected ? { ...s, confirmDiscard: true } : s;
    case "cancel-discard": return { ...s, confirmDiscard: false };
    case "discard": return canReviewPrd(s) && s.selected && s.confirmDiscard ? { ...s, document: null, selected: false, confirmDiscard: false, error: null, messages: reviewedMessages(s, "discarded"), notice: "本轮草稿已放弃，对话与功能目录保留（空目录规则待确认）。" } : s;
    case "notice": return { ...s, notice: a.message };
  }
}
export type PrdStore = Record<string, PrdSession>;
export function prdStoreReducer(store: PrdStore, event: { project: string; action: PrdAction }): PrdStore {
  const current = store[event.project] ?? createPrdSession();
  const next = transitionPrd(current, event.action);
  return next === current ? store : { ...store, [event.project]: next };
}
export function prdWorkspaceNodes(project: string, s: PrdSession): WorkspaceFolder[] {
  if (!s.rootName) return [];
  return [{ id: `${project}-prd-function`, type: "folder", level: "function", name: s.rootName,
    children: s.document ? [{ id: s.document.id, type: "object", kind: "PRD", name: "PRD", functionName: s.rootName,
      summary: s.document.content, status: s.document.status }] : [] }];
}

export type FrContent = { id: string; source: string; description: string; acceptanceCriteria?: string; sources?: { uc_id: string; uc_revision_id: string }[] };
export type FrDocument = { id: string; featureName: string; content: FrContent; revision: number; status: "pending" | "accepted" };
export type FrMessage = { id: string; role: "user" | "assistant"; content: string };
export type FrOperation = { id: string; prompt: string; previous: FrDocument | null; references: { id: string; name: string }[] };
export type FrSession = {
  document: FrDocument | null;
  prompt: string;
  messages: FrMessage[];
  editDraft: FrContent | null;
  selected: boolean;
  operation: FrOperation | null;
  error: { message: string; request: FrOperation } | null;
  notice: string;
};
export type FrOverviewSession = {
  prompt: string;
  messages: FrMessage[];
  operation: FrOperation | null;
  error: { message: string; request: FrOperation } | null;
  notice: string;
};
export type FrAction =
  | { type: "select"; selected: boolean }
  | { type: "prompt"; value: string }
  | { type: "edit" }
  | { type: "edit-content"; value: FrContent }
  | { type: "save" }
  | { type: "cancel-edit" }
  | { type: "accept" }
  | { type: "start"; request: FrOperation; retry?: boolean }
  | { type: "generated"; id: string; document: FrDocument }
  | { type: "failed"; id: string; message: string }
  | { type: "cancel"; id: string };

export function createFrSession(document: FrDocument): FrSession {
  return {
    document,
    prompt: "",
    messages: [{ id: `${document.id}-initial`, role: "assistant", content: `已打开 ${document.content.id}。这是该 FR 对象独立的会话；当前只保留需求编号、来源和需求描述。生成与对话修改为本地模拟。` }],
    editDraft: null,
    selected: document.status === "pending",
    operation: null,
    error: null,
    notice: "",
  };
}
export function createFrOverviewSession(featureName: string): FrOverviewSession {
  return {
    prompt: "",
    messages: [{ id: `${featureName}-fr-overview-initial`, role: "assistant", content: `已打开「${featureName}」的 FR 全景视图。这里集中查看该业务功能下的全部功能需求；AI 对话只作用于当前全景标签。生成与对话修改为本地模拟。` }],
    operation: null,
    error: null,
    notice: "",
  };
}
export function canReviewFr(s: FrSession) { return Boolean(s.document && s.document.status === "pending" && !s.operation && !s.editDraft); }
export function validFrStructure(c: FrContent) { return Boolean(c.id.trim()); }
export function validFrAcceptance(c: FrContent) { return validFrStructure(c) && Boolean(c.source.trim() && c.description.trim()); }
export function transitionFr(s: FrSession, a: FrAction): FrSession {
  switch (a.type) {
    case "select": return canReviewFr(s) ? { ...s, selected: a.selected } : s;
    case "prompt": return { ...s, prompt: a.value };
    case "edit": return canReviewFr(s) ? { ...s, editDraft: structuredClone(s.document!.content), notice: "" } : s;
    case "edit-content": return s.editDraft ? { ...s, editDraft: { ...a.value, id: s.document!.content.id } } : s;
    case "cancel-edit": return { ...s, editDraft: null, notice: "" };
    case "save": {
      if (!s.editDraft || s.document?.status !== "pending" || !validFrStructure(s.editDraft)) return s;
      const content = structuredClone(s.editDraft);
      return { ...s, document: { ...s.document, content, revision: s.document.revision + 1 }, editDraft: null, notice: validFrAcceptance(content) ? "本页草稿已保存，仍待确认；保存不等于确认。" : "草稿已保存，但确认前需要需求来源和需求描述。" };
    }
    case "accept": {
      if (!canReviewFr(s) || !s.selected) return s;
      if (!validFrAcceptance(s.document!.content)) return { ...s, notice: "FR需求描述不能为空，且至少需要一条需求来源，补充后才能确认。" };
      return { ...s, document: { ...s.document!, status: "accepted" }, selected: false, notice: "FR 已确认；后续修改应形成新的待审阅版本，不覆盖已确认历史。" };
    }
    case "start": return s.document && !s.operation && !s.editDraft && a.request.prompt.trim() ? { ...s, operation: a.request, error: null, prompt: a.retry ? s.prompt : "", messages: a.retry ? s.messages : [...s.messages, { id: `${a.request.id}-user`, role: "user", content: a.request.prompt }] } : s;
    case "generated": return s.operation?.id === a.id ? { ...s, operation: null, document: a.document, selected: true, messages: [...s.messages, { id: `${a.id}-assistant`, role: "assistant", content: "已根据当前 FR 的补充要求生成一版待确认内容，请检查后编辑或确认。" }], notice: "FR 已生成，等待确认。" } : s;
    case "failed": return s.operation?.id === a.id ? { ...s, operation: null, error: { message: a.message, request: { ...s.operation } }, notice: "" } : s;
    case "cancel": return s.operation?.id === a.id ? { ...s, operation: null, notice: "本次 FR 生成已停止，已有内容和输入已保留。" } : s;
  }
}

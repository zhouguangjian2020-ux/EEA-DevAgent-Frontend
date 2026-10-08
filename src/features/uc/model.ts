export const UC_FIELDS = ["用例名称", "用例描述", "用例编号", "参与者", "前置条件", "场景", "后置条件", "扩展用例", "HMI 交互逻辑", "法规需求", "性能需求", "非功能需求"] as const;
export const EXCEPTION_NAMES = ["车辆状态异常", "机械故障", "环境突变", "用户误操作（滥用）", "供电异常"] as const;
export type UcContent = {
  sourcePrdRevisionId?: string;
  name: string; description: string; number: string; actors: string; preconditions: string;
  mainFlow: string; branches: string[]; exceptions: string[];
  postconditions: string; extensions: string; hmi: string; regulations: string; performance: string; nonfunctional: string;
};
export type UcDocument = { id: string; featureName: string; content: UcContent; revision: number; status: "pending" | "accepted" };
export type ObjectReference = { id: string; name: string };
export type UcMessage = { id: string; role: "user" | "assistant"; content: string; references?: ObjectReference[] };
export type UcOperation = { id: string; prompt: string; previous: UcDocument; references: ObjectReference[] };
export type UcSession = {
  document: UcDocument | null; prompt: string; messages: UcMessage[]; editDraft: UcContent | null;
  selected: boolean; confirmDiscard: boolean; notice: string; operation: UcOperation | null;
  error: { message: string; request: UcOperation } | null;
};
export type UcAction =
  | { type: "prompt"; value: string } | { type: "select"; selected: boolean }
  | { type: "edit" } | { type: "edit-content"; value: UcContent } | { type: "save" } | { type: "cancel-edit" }
  | { type: "accept" } | { type: "confirm-discard" } | { type: "cancel-discard" } | { type: "discard" }
  | { type: "start"; request: UcOperation; retry?: boolean }
  | { type: "generated"; id: string; document: UcDocument } | { type: "failed"; id: string; message: string }
  | { type: "cancel"; id: string };
export function createUcSession(document: UcDocument): UcSession {
  return { document, prompt: "", messages: [{ id: `${document.id}-initial`, role: "assistant", content: `已打开 ${document.content.number}「${document.content.name}」。这是该对象独立的会话；表格及示例内容可查看、编辑和审阅。生成与对话修改为本地模拟。` }], editDraft: null, selected: document.status === "pending", confirmDiscard: false, notice: "", operation: null, error: null };
}
export function canReviewUc(s: UcSession) { return s.document?.status === "pending" && !s.operation && s.editDraft === null; }
export function validUcStructure(c: UcContent) { return c.branches.every(item => typeof item === "string") && c.exceptions.every(item => typeof item === "string"); }
export function validUcAcceptance(c: UcContent) { return validUcStructure(c) && Boolean(c.name.trim() && c.description.trim() && c.mainFlow.trim()); }
export function transitionUc(s: UcSession, a: UcAction): UcSession {
  switch (a.type) {
    case "prompt": return { ...s, prompt: a.value };
    case "select": return canReviewUc(s) ? { ...s, selected: a.selected } : s;
    case "edit": return canReviewUc(s) && !s.confirmDiscard ? { ...s, editDraft: structuredClone(s.document!.content), notice: "" } : s;
    case "edit-content": return s.editDraft ? { ...s, editDraft: { ...a.value, number: s.document!.content.number } } : s;
    case "cancel-edit": return { ...s, editDraft: null, notice: "" };
    case "save": {
      if (!s.editDraft || s.document?.status !== "pending" || !validUcStructure(s.editDraft)) return s;
      const content = structuredClone(s.editDraft);
      return { ...s, document: { ...s.document, content }, editDraft: null, notice: validUcAcceptance(content) ? "本页草稿已保存，仍待确认；保存不等于确认。" : "草稿已保存，但确认前需要补充用例名称、描述和主事件流。" };
    }
    case "accept": {
      if (!canReviewUc(s) || !s.selected || s.confirmDiscard) return s;
      if (!validUcAcceptance(s.document!.content)) return { ...s, notice: "用例名称、描述和主事件流不能为空白，补充后才能确认。" };
      return { ...s, document: { ...s.document!, status: "accepted" }, selected: false, notice: "用例已确认；后续修改应形成新的待审阅版本，不覆盖已确认历史。" };
    }
    case "confirm-discard": return canReviewUc(s) && s.selected ? { ...s, confirmDiscard: true } : s;
    case "cancel-discard": return { ...s, confirmDiscard: false };
    case "discard": return canReviewUc(s) && s.selected && s.confirmDiscard ? { ...s, document: null, selected: false, confirmDiscard: false, notice: "未确认的用例草稿已放弃，对话保留。关闭标签不等于放弃。" } : s;
    case "start": return canReviewUc(s) && !s.confirmDiscard && a.request.prompt.trim() ? { ...s, operation: a.request, error: null, notice: "", prompt: a.retry ? s.prompt : "", messages: a.retry ? s.messages : [...s.messages, { id: `${a.request.id}-user`, role: "user", content: a.request.prompt, references: a.request.references }] } : s;
    case "generated": return s.operation?.id === a.id ? { ...s, operation: null, document: a.document, selected: true, messages: [...s.messages, { id: `${a.id}-assistant`, role: "assistant", content: "已将本次要求作为补充内容记录在用例描述中（本地模拟），未自动推断工程参数。请在表格中检查后再确认。" }] } : s;
    case "failed": return s.operation?.id === a.id ? { ...s, operation: null, error: { request: s.operation, message: a.message } } : s;
    case "cancel": return s.operation?.id === a.id ? { ...s, operation: null, notice: "本轮操作已停止，正文和对话保留。" } : s;
  }
}

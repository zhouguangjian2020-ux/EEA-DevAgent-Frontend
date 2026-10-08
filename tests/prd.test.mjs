import assert from "node:assert/strict";
import test from "node:test";
import { loadTypescript } from "./load-typescript.mjs";
const { createPrdSession, transitionPrd, prdStoreReducer, prdWorkspaceNodes, canReviewPrd } = await loadTypescript("../src/features/prd/model.ts");
const { expandMockPrompt, generateMockPrd, mockFunctionName, mockWait, PRD_EXAMPLE } = await loadTypescript("../src/mocks/prd.ts");
const request = (id, kind = "generate", previous = null) => ({ id, kind, prompt: PRD_EXAMPLE, previous });
function generated() {
  let s = transitionPrd(createPrdSession(), { type: "start", request: request("first") });
  return transitionPrd(s, { type: "generated", id: "first", document: generateMockPrd("A", PRD_EXAMPLE, null, "first") });
}
test("a new PRD workspace is empty and uses no seeded product objects", async () => {
  assert.deepEqual(prdWorkspaceNodes("A", createPrdSession()), []);
  const { workspaceByProject } = await loadTypescript("../src/mocks/workspace.ts");
  assert.deepEqual(workspaceByProject.A.product, []);
  assert.deepEqual(workspaceByProject.B.product, []);
});
test("expansion replaces only the input and never sends or creates an artifact", () => {
  let s = transitionPrd(createPrdSession(), { type: "prompt", value: "功能：座椅通风" });
  s = transitionPrd(s, { type: "start", request: { ...request("exp", "expand"), prompt: s.prompt } });
  assert.equal(transitionPrd(s, { type: "prompt", value: "racing edit" }), s);
  s = transitionPrd(s, { type: "expanded", id: "exp", prompt: expandMockPrompt(s.prompt) });
  assert.match(s.prompt, /座椅通风/);
  assert.equal(s.document, null); assert.equal(s.messages.length, 0); assert.equal(s.operation, null);
});
test("the first successful generation immediately exposes a pending PRD under a direct root", () => {
  const s = generated();
  assert.equal(s.document.status, "pending"); assert.equal(s.messages.length, 2); assert.equal(s.selected, true);
  const nodes = prdWorkspaceNodes("A", s);
  assert.equal(nodes[0].children[0].type, "object"); assert.equal(nodes[0].children[0].name, "PRD");
  assert.equal(nodes[0].children[0].status, "pending");
});
test("typing during generation survives the switch to document and narrow chat", () => {
  let s = transitionPrd(createPrdSession(), { type: "start", request: request("job") });
  s = transitionPrd(s, { type: "prompt", value: "尚未发送的补充" });
  s = transitionPrd(s, { type: "generated", id: "job", document: generateMockPrd("A", PRD_EXAMPLE, null, "job") });
  assert.equal(s.prompt, "尚未发送的补充"); assert.equal(s.messages[0].content, PRD_EXAMPLE);
});
test("empty requests and duplicate operations are ignored", () => {
  const empty = createPrdSession();
  assert.equal(transitionPrd(empty, { type: "start", request: { ...request("bad"), prompt: " " } }), empty);
  const s = transitionPrd(empty, { type: "start", request: request("running") });
  assert.equal(transitionPrd(s, { type: "start", request: request("other") }), s);
});
test("unselected, busy and editing drafts cannot be accepted", () => {
  let s = transitionPrd(generated(), { type: "select", selected: false });
  assert.equal(transitionPrd(s, { type: "accept" }), s);
  s = transitionPrd(generated(), { type: "edit" });
  assert.equal(canReviewPrd(s), false); assert.equal(transitionPrd(s, { type: "accept" }), s);
});
test("accept enforces PRD nonblank content while draft save remains allowed", () => {
  const blank = transitionPrd(generated(), { type: "edit" });
  const saved = transitionPrd(transitionPrd(blank, { type: "edit-text", value: " " }), { type: "save" });
  assert.equal(saved.document.content, " "); assert.equal(saved.document.status, "pending");
  assert.equal(transitionPrd(saved, { type: "accept" }).document.status, "pending");
});
test("accept updates the tree and matching answer without deleting anything", () => {
  const s = transitionPrd(generated(), { type: "accept" });
  assert.equal(s.document.status, "accepted"); assert.equal(s.messages[1].artifact.status, "accepted");
  assert.equal(prdWorkspaceNodes("A", s)[0].children[0].status, "accepted");
  assert.equal(transitionPrd(s, { type: "discard" }), s);
  assert.equal(transitionPrd(s, { type: "edit" }), s);
  assert.equal(transitionPrd(s, { type: "start", request: request("overwrite") }), s);
});
test("discard requires confirmation and keeps the conversation and provisional empty root", () => {
  const s = generated(); assert.equal(transitionPrd(s, { type: "discard" }), s);
  const confirmed = transitionPrd(s, { type: "confirm-discard" });
  assert.equal(transitionPrd(confirmed, { type: "cancel-discard" }).document, s.document);
  const discarded = transitionPrd(confirmed, { type: "discard" });
  assert.equal(discarded.document, null); assert.equal(discarded.messages.length, 2);
  assert.equal(discarded.messages[1].artifact.status, "discarded");
  assert.equal(prdWorkspaceNodes("A", discarded)[0].children.length, 0);
});
test("edit cancel restores text; save allows free text without accepting", () => {
  const s = generated();
  let edit = transitionPrd(s, { type: "edit" });
  edit = transitionPrd(edit, { type: "edit-text", value: "任何自由文本\n没有固定字段" });
  assert.equal(transitionPrd(edit, { type: "cancel-edit" }).document.content, s.document.content);
  const saved = transitionPrd(edit, { type: "save" });
  assert.equal(saved.document.content, "任何自由文本\n没有固定字段"); assert.equal(saved.document.status, "pending");
  const blankSaved = transitionPrd(transitionPrd(edit, { type: "edit-text", value: " " }), { type: "save" });
  assert.equal(blankSaved.document.content, " "); assert.equal(blankSaved.editDraft, null); assert.match(blankSaved.notice, /确认前/);
});
test("a late callback from a cancelled operation cannot create output", () => {
  let s = transitionPrd(createPrdSession(), { type: "start", request: request("old") });
  s = transitionPrd(s, { type: "cancel", id: "old" });
  const result = transitionPrd(s, { type: "generated", id: "old", document: generateMockPrd("A", PRD_EXAMPLE, null, "old") });
  assert.equal(result, s);
});
test("failure retains the draft and retry reuses the request without duplicate messages", () => {
  const s = generated();
  let failed = transitionPrd(s, { type: "start", request: request("fail", "generate", s.document) });
  failed = transitionPrd(failed, { type: "failed", id: "fail", message: "failure" });
  assert.equal(failed.document, s.document);
  const retry = transitionPrd(failed, { type: "start", request: { ...failed.error.request, id: "retry" }, retry: true });
  assert.equal(retry.messages.length, failed.messages.length);
  const success = transitionPrd(retry, { type: "generated", id: "retry", document: generateMockPrd("A", "补充接管", s.document, "retry") });
  assert.equal(success.document.id, s.document.id); assert.equal(success.document.revision, 2);
  assert.equal(success.document.status, "pending"); assert.match(success.document.content, /补充接管/);
});
test("project-keyed async completions and inputs never leak into the other project", () => {
  let store = prdStoreReducer({}, { project: "A", action: { type: "start", request: request("a") } });
  store = prdStoreReducer(store, { project: "B", action: { type: "prompt", value: "项目B输入" } });
  store = prdStoreReducer(store, { project: "A", action: { type: "generated", id: "a", document: generateMockPrd("A", PRD_EXAMPLE, null, "a") } });
  assert.equal(store.B.prompt, "项目B输入"); assert.equal(store.B.document, null); assert.equal(store.A.document.status, "pending");
});
test("mock generation works with non-AEB text and does not evaluate markup", () => {
  assert.equal(mockFunctionName("新功能：座椅通风，支持定时关闭"), "座椅通风");
  const doc = generateMockPrd("B", "新功能：座椅通风，<script>alert(1)</script>", null, "id");
  assert.equal(doc.functionName, "座椅通风"); assert.match(doc.content, /<script>/);
  assert.equal(doc.status, "pending");
});
test("mock requests support abort before and during the delay", async () => {
  const a = new AbortController(); a.abort();
  await assert.rejects(mockWait(a.signal, 10), { name: "AbortError" });
  const b = new AbortController(); const pending = mockWait(b.signal, 100); b.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await mockWait(new AbortController().signal, 1);
});

test("free text headings and lists render without imposing a field schema", async () => {
  const { parseFreeText } = await loadTypescript("../src/features/prd/free-text.ts");
  assert.deepEqual(parseFreeText("# 标题\n\n## 自定义章节\n正文\n下一行\n- 一项\n- 二项\n\n普通段落"), [
    { kind: "heading", level: 1, text: "标题" }, { kind: "heading", level: 2, text: "自定义章节" },
    { kind: "paragraph", text: "正文\n下一行" }, { kind: "list", items: ["一项", "二项"] }, { kind: "paragraph", text: "普通段落" }
  ]);
  assert.deepEqual(parseFreeText("<script>alert(1)</script>"), [{ kind: "paragraph", text: "<script>alert(1)</script>" }]);
  assert.deepEqual(parseFreeText(""), []);
});

test("editing a long expanded prompt never truncates the user's original text", () => {
  const original = "原始需求".repeat(2200);
  const expanded = expandMockPrompt(original);
  const s = transitionPrd(createPrdSession(), { type: "prompt", value: expanded + "\n补充" });
  assert.equal(s.prompt, expanded + "\n补充"); assert.ok(s.prompt.includes(original));
});

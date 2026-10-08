import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTypescript } from "./load-typescript.mjs";
import { loadComponent } from "./load-component.mjs";
const { streamPrdGeneration, PRD_GENERATION_TIMEOUT_MS } = await loadTypescript("../src/features/prd/api.ts");
const { createProjectWorks, transitionWorkbench, workbenchReducer, isWorkRunning, canGenerateUcBatch } = await loadTypescript("../src/features/workbench/model.ts");
const { createPrdSession } = await loadTypescript("../src/features/prd/model.ts");
const { prdGenerationReason } = await loadTypescript("../src/features/prd/generation.ts");
const { PrdWorkspace } = loadComponent("../src/components/prd/prd-workspace.tsx", { "react-markdown": await import("react-markdown"), "remark-gfm": await import("remark-gfm") });
const input = { project_id: "project-id", function_id: "function-id" };
const frame = event => `data: ${JSON.stringify(event)}\n\n`;
const token = content => frame({ type: "token", content });
const done = output => frame({ type: "done", scene: "FROM_DEFINITION_CREATE_PRD", output, request_id: "backend-request" });
function response(chunks, onCancel = () => {}) {
  return new Response(new ReadableStream({
    start(c) { for (const chunk of chunks) c.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); c.close(); },
    cancel: onCancel,
  }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}
const call = (onProgress = () => {}, signal = new AbortController().signal) => streamPrdGeneration(input, signal, onProgress);

test("PRD stream sends identities only, uses cookie and no Agent secret, final output replaces preview", async t => {
  const progress = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/v1/agent/prd/generate/stream");
    assert.equal(init.credentials, "include");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), input);
    assert.deepEqual(init.headers, { "X-Project-Request": "1", "Content-Type": "application/json", Accept: "text/event-stream" });
    return response([token("# 部分"), token(" PRD"), done("# 完整正文")]);
  });
  assert.deepEqual(await call(text => progress.push(text)), { output: "# 完整正文", requestId: "backend-request", traceId: null });
  assert.deepEqual(progress, ["# 部分", "# 部分 PRD"]);
});
test("Chinese and emoji may be split at every byte and CRLF frame boundary", async t => {
  const text = token("中文🚗") + done("中文🚗");
  const bytes = new TextEncoder().encode(text.replaceAll("\n", "\r\n"));
  t.mock.method(globalThis, "fetch", async () => response(Array.from(bytes, b => Uint8Array.of(b))));
  assert.equal((await call()).output, "中文🚗");
});
test("SSE comment, multiline data, optional trailing newline and metadata are handled", async t => {
  t.mock.method(globalThis, "fetch", async () => response([': heartbeat\n\nevent: progress\ndata: {"type":"progress"}\n\n', 'data: {"type":"token",\ndata: "content":"正文"}\n\n', done("正文").trimEnd()]));
  assert.equal((await call()).output, "正文");
});
for (const [name, text] of [
  ["missing done", token("partial")],
  ["invalid json", "data: nope\n\n"],
  ["null event", "data: null\n\n"],
  ["array event", "data: []\n\n"],
  ["nontext token", frame({ type: "token", content: 5 })],
  ["wrong scene", frame({ type: "done", scene: "PROMPT_EXPAND", output: "wrong", request_id: "r" })],
  ["empty output", done(" ")],
  ["missing request id", frame({ type: "done", scene: "FROM_DEFINITION_CREATE_PRD", output: "body" })],
  ["oversized output", done("x".repeat(200001))],
  ["unbounded incomplete frame", "data: " + "x".repeat(2000001)],
]) test(`rejects ${name} without a successful result`, async t => {
  t.mock.method(globalThis, "fetch", async () => response([text]));
  await assert.rejects(call());
});
for (const status of [401, 404, 409, 422, 503]) test(`HTTP ${status} is not a completed stream`, async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ detail: { message: "安全业务提示" } }), { status }));
  await assert.rejects(call(), status === 401 ? /登录/ : status === 422 ? /参数/ : /安全业务提示/);
});
test("SSE error keeps a user-safe error and does not claim completion", async t => {
  t.mock.method(globalThis, "fetch", async () => response([token("不完整"), frame({ type: "error", message: "Agent 当前繁忙", task_id: "private" })]));
  await assert.rejects(call(), /Agent 当前繁忙/);
});
test("rejects buffered JSON instead of faking token streaming", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ output: "正文" }), { headers: { "Content-Type": "application/json" } }));
  await assert.rejects(call(), /格式异常/);
});
test("pre-abort never calls backend", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("unexpected request"));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(call(() => {}, abort.signal), { name: "AbortError" });
});
test("cancel midstream prevents late progress and closes reader", async t => {
  const abort = new AbortController(), progress = [];
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(token("首段"))); }, cancel() { cancelled = true; } }), { headers: { "Content-Type": "text/event-stream" } }));
  const result = call(text => { progress.push(text); abort.abort(); }, abort.signal);
  // The first read checks abort immediately after returning from onProgress, before another read.
  await assert.rejects(result, { name: "AbortError" });
  assert.deepEqual(progress, ["首段"]); assert.equal(cancelled, true);
});
test("total timeout terminates stalled stream", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })));
  const promise = call();
  t.mock.timers.tick(PRD_GENERATION_TIMEOUT_MS + 1);
  await assert.rejects(promise, /等待超时/);
});

function fixture() {
  const p = createProjectWorks();
  p.features.f = { id: "f", name: "DVR", description: "完整功能描述" };
  p.works.w = { id: "w", kind: "PRD", featureId: "f", featureName: "DVR", attachments: [], ucTask: null,
    database: { artifactId: "prd-id", revisionId: "r1", acceptedRevisionId: "r1", canUpdate: true, canAccept: true },
    session: { ...createPrdSession(), document: { id: "prd-id", content: "# 原始 PRD", functionName: "DVR", revision: 1, status: "accepted" } } };
  p.tabs = ["w"]; p.activeId = "w";
  return p;
}
const act = (p, action) => transitionWorkbench(p, { type: "prd-generation", id: "w", action });
const start = p => act(p, { type: "start", id: "run-1" });
test("generation preview never changes PRD identity, content, status, revision, draft or conversation", () => {
  const old = fixture(); let p = start(old);
  assert.equal(isWorkRunning(p.works.w), true); assert.equal(canGenerateUcBatch(p.works.w), false);
  p = act(p, { type: "progress", id: "run-1", text: "部分" });
  p = act(p, { type: "done", id: "run-1", output: "# 最终正文", requestId: "backend-id" });
  assert.equal(p.works.w.prdGeneration.status, "succeeded");
  assert.equal(p.works.w.session, old.works.w.session); assert.equal(p.works.w.database, old.works.w.database);
  assert.equal(p.conversation, old.conversation); assert.deepEqual(p.tabs, ["w"]);
  assert.equal(act(p, { type: "start", id: "duplicate" }), p);
});
for (const type of ["cancel", "failed"]) test(`${type} discards partial preview, keeps original, rejects late result and allows retry`, () => {
  const original = fixture(); let p = start(original);
  p = act(p, { type: "progress", id: "run-1", text: "partial" });
  p = act(p, { type, id: "run-1", message: "失败" });
  assert.equal(p.works.w.prdGeneration.text, ""); assert.equal(p.works.w.session, original.works.w.session);
  assert.equal(act(p, { type: "done", id: "run-1", output: "late", requestId: "late" }), p);
  const retry = act(p, { type: "start", id: "retry" });
  assert.equal(retry.works.w.prdGeneration.status, "streaming");
  assert.equal(act(retry, { type: "progress", id: "run-1", text: "old" }), retry);
});
test("no permission, local mocks, missing definition, active edit/UC/save block generation", () => {
  for (const patch of [{ database: undefined }, { readOnly: true }, { saving: true }, { ucTask: "uc" }]) {
    const p = fixture(); Object.assign(p.works.w, patch); assert.equal(start(p), p);
  }
  const p = fixture(); p.works.w.database.canUpdate = false; assert.equal(start(p), p);
  const empty = fixture(); empty.features.f.description = " "; assert.match(prdGenerationReason(empty.works.w, " "), /功能描述/); assert.equal(start(empty), empty);
  const editing = fixture(); editing.works.w.session.editDraft = "编辑中"; assert.equal(start(editing), editing);
});
test("running generation prompts stop before closing and survives workspace refresh", () => {
  const base = fixture(), p = start(base);
  assert.equal(transitionWorkbench(p, { type: "close", id: "w" }).closeRequest.reason, "running");
  const refreshed = transitionWorkbench(p, { type: "database-seed", works: [base.works.w] });
  assert.equal(refreshed.works.w.prdGeneration.id, "run-1");
  const finished = act(p, { type: "done", id: "run-1", output: "preview", requestId: "r" });
  assert.equal(transitionWorkbench(finished, { type: "database-seed", works: [base.works.w] }).works.w.prdGeneration.text, "preview");
});
test("project/tab switching does not redirect output, deletes cannot be resurrected", () => {
  const p = transitionWorkbench(start(fixture()), { type: "home" }), other = fixture();
  const next = workbenchReducer({ A: p, B: other }, { project: "A", action: { type: "prd-generation", id: "w", action: { type: "done", id: "run-1", output: "result", requestId: "r" } } });
  assert.equal(next.B, other); assert.equal(next.A.activeId, null);
  const deleted = transitionWorkbench(p, { type: "database-seed", works: [], removedArtifactIds: ["prd-id"] });
  assert.equal(act(deleted, { type: "done", id: "run-1", output: "late", requestId: "r" }), deleted);
});
const noop = () => {};
const props = { featureName: "DVR", session: fixture().works.w.session, onAction: noop, onGenerateUcs: noop, onStopUcs: noop, generatedUcs: [], onOpenUc: noop, canGenerateUcs: true, persistence: { ...fixture().works.w.database, onRefresh: noop } };
function render(state, reason = null) {
  return renderToStaticMarkup(createElement(PrdWorkspace, { ...props, generation: { state, reason, onGenerate: noop, onStop: noop } }));
}
test("PRD toolbar contains real generation entry and exposes disabled reason", () => {
  assert.match(render(), />生成 PRD<\/button>/);
  assert.match(render(undefined, "请先完善功能描述"), /disabled="" title="请先完善功能描述"/);
});
test("streaming view offers stop, safe Markdown and never confirms a partial output", () => {
  const html = render({ id: "run", status: "streaming", text: "# 实时 PRD\n<script>alert(1)</script>\n![remote](https://example.test/img)" }, "任务进行中");
  assert.match(html, /停止生成/); assert.match(html, /aria-busy="true"/);
  assert.match(html, /实时 PRD/); assert.doesNotMatch(html, /<script|<img|>确认<|>保存草稿</);
  assert.match(html, /原 PRD/); assert.match(html, /生成预览（未保存）/);
});
test("completed preview is explicitly unsaved and has no acceptance or save actions", () => {
  const html = render({ id: "run", status: "succeeded", text: "# 生成结果" }, "已生成预览");
  assert.match(html, /生成完成 · 未保存、未确认/); assert.match(html, /已生成 PRD/);
  assert.doesNotMatch(html, /停止生成|>确认<|>保存草稿<|>生成 UC</);
});
test("database UC candidates render read-only nested scenario content without a formal object link", () => {
  const html = renderToStaticMarkup(createElement(PrdWorkspace, {
    ...props,
    ucGenerated: true,
    ucGenerating: false,
    generatedCandidates: [{
      candidate_id: "candidate-1", ordinal: 1, name: "记录事件", description: "系统记录事件。",
      actors: "驾驶员；系统", preconditions: "设备已上电。",
      scenario: { main_flow: "1. 触发。", branches: ["主动触发"], exceptions: [] },
      postconditions: "事件可查询。", extensions: "<待确认>", hmi: "显示结果。",
      regulations: "<待确认>", performance: "<待标定>", nonfunctional: "可追溯。",
    }],
  }));
  assert.match(html, /UC 生成候选/);
  assert.match(html, /仅供审阅 · 尚未创建、保存或确认正式 UC/);
  assert.match(html, /场景 · 主事件流/);
  assert.match(html, /场景 · 分支事件流/);
  assert.match(html, /用例编号：正式保存时由后端生成/);
  assert.doesNotMatch(html, /候选 1[^<]*<\/button>/);
});
test("failure and cancellation restore original document and generation action", () => {
  const failed = render({ id: "run", status: "failed", text: "", error: "Agent 不可用" });
  assert.match(failed, /role="alert"/); assert.match(failed, /原始 PRD/); assert.match(failed, />生成 PRD<\/button>/);
  assert.match(render({ id: "run", status: "cancelled", text: "" }), /已停止接收/);
});

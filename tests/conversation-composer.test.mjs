import test from "node:test";
import assert from "node:assert/strict";
import { Children, createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./load-component.mjs";
import { loadTypescript } from "./load-typescript.mjs";

const model = await loadTypescript("../src/features/conversation/model.ts");
const { createProjectWorks, transitionWorkbench } = await loadTypescript("../src/features/workbench/model.ts");
const { ProjectConversation } = loadComponent("../src/components/workbench/project-conversation.tsx");
const { ChatComposer } = loadComponent("../src/components/workspace/chat-composer.tsx");
const noop = () => {};
const chat = (p, action) => transitionWorkbench(p, { type: "conversation", action });
const attachment = { id: "uc-1", kind: "UC", name: "用例附件", functionName: "测试功能", summary: "", type: "object" };
function draft(mode, value = "请补充场景与边界") {
  let p = chat(createProjectWorks(), { type: "mode", mode });
  return chat(p, { type: "prompt", value });
}
test("UC business-function selector sits immediately to the right of the UC shortcut", () => {
  const html = renderToStaticMarkup(createElement(ProjectConversation, { project: "p", state: draft("UC"), visible: true, docked: false, onAction: noop, onMode: noop, onSend: noop, onStop: noop, onOpenWork: noop, onOpenObject: noop }));
  const composer = html.indexOf('class="chat-composer"');
  const shortcuts = html.indexOf('<div class="conversation-shortcuts" aria-label="快捷生成">');
  const ucButton = html.indexOf("用例生成", shortcuts);
  const selector = html.indexOf('aria-label="业务功能"', shortcuts);
  const footer = html.indexOf('class="conversation-footer"', shortcuts);
  assert.ok(shortcuts > composer);
  assert.ok(selector > ucButton && (footer < 0 || selector < footer));
  assert.match(html.slice(shortcuts, selector), /aria-pressed="true"/);
  assert.doesNotMatch(html, /class="conversation-feature"/);
});
for (const mode of [null, "PRD", "UC"]) {
  test("input expansion does not require generation prerequisites: " + mode, () => {
    let p = draft(mode);
    if (!mode) p = chat(p, { type: "attach", objects: [attachment] });
    const r = model.buildConversationRequest("project", p, "expand", "expand");
    assert.equal(model.validateConversationRequest(p, r), "");
    assert.equal(r.featureId, null);
    const before = { works: p.works, tabs: p.tabs, messages: p.conversation.messages, attachments: p.conversation.attachments };
    p = chat(p, { type: "start", request: r });
    p = chat(p, { type: "expansion-progress", id: r.id, text: "扩写中" });
    assert.equal(p.conversation.expansionPreview, "扩写中");
    assert.equal(p.conversation.prompt, r.prompt);
    p = chat(p, { type: "success", id: r.id, response: { message: "", expandedPrompt: "完整扩写结果", expansionSource: "agent" } });
    assert.equal(p.conversation.prompt, "完整扩写结果");
    assert.equal(p.conversation.mode, mode);
    assert.equal(p.conversation.operation, null);
    assert.equal(p.conversation.expansionPreview, null);
    for (const key of ["works", "tabs"]) assert.equal(p[key], before[key]);
    for (const key of ["messages", "attachments"]) assert.deepEqual(p.conversation[key], before[key]);
    assert.doesNotMatch(p.conversation.notice, /生成 PRD/);
  });
  test("expansion validates blank input and a Unicode-aware 4000 character limit: " + mode, () => {
    for (const [value, error] of [["   ", /请输入/], ["🚗".repeat(4001), /4000/], ["🚗".repeat(4000), /^$/]]) {
      const p = draft(mode, value);
      assert.match(model.validateConversationRequest(p, model.buildConversationRequest("p", p, "r", "expand")), error);
    }
  });
  test("cancel, failure and retry preserve the snapshot in every mode: " + mode, () => {
    let p = draft(mode);
    const r = model.buildConversationRequest("p", p, "r", "expand");
    p = chat(p, { type: "start", request: r });
    p = chat(p, { type: "expansion-progress", id: r.id, text: "片段" });
    p = chat(p, { type: "failed", id: r.id, message: "服务未配置" });
    assert.equal(p.conversation.prompt, r.prompt);
    assert.equal(p.conversation.expansionPreview, null);
    const retry = { ...p.conversation.error.request, id: "retry" };
    p = chat(p, { type: "start", request: retry, retry: true });
    p = chat(p, { type: "cancel", id: retry.id });
    assert.equal(p.conversation.prompt, r.prompt);
    assert.equal(chat(p, { type: "expansion-progress", id: retry.id, text: "迟到片段" }), p);
    assert.equal(chat(p, { type: "success", id: retry.id, response: { message: "", expandedPrompt: "迟到结果" } }), p);
  });
  for (const docked of [false, true]) test("expansion control is always present, compact and independent of send: " + mode + "/" + docked, () => {
    const html = renderToStaticMarkup(createElement(ProjectConversation, { project: "p", state: draft(mode), visible: true, docked, readOnly: true, onAction: noop, onMode: noop, onSend: noop, onStop: noop, onOpenWork: noop, onOpenObject: noop }));
    assert.match(html, /class="expand-button"[^>]*>.*?自动扩写/s);
    assert.doesNotMatch(html.match(/<button[^>]*class="expand-button"[^>]*>/)[0], /disabled/);
    assert.match(html.match(/<button[^>]*class="send-button"[^>]*>/)[0], /disabled/);
    assert.match(html, /rows="2"/);
    assert.match(html, /class="sr-only"[^>]*>正在自动准备新会话/);
    assert.doesNotMatch(html, /conversation-header|conversation-api-hint|conversation-footer|composer-hint|PRD 扩写 API|不随对象标签切换|数据库项目尚未开放/);
    assert.ok(html.indexOf('class="conversation-output"') < html.indexOf('class="conversation-composer-area"'));
  });
  test("real request executor uses the streaming expansion API, never mock generation: " + mode, async t => {
    let latest, calls = 0;
    const previousWindow = globalThis.window;
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
    const { useWorkbenchStore } = loadComponent("../src/features/workbench/use-workbench-store.ts", {
      react: { useEffect: noop, useRef: value => ({ current: value }), useState: value => [value, next => { latest = next; }] },
      "../conversation/api": { streamPrdExpansion: async (text, _signal, onProgress) => { calls++; assert.equal(text, "扩写执行器测试"); onProgress("来自扩写接口的结果"); return { text: "来自扩写接口的结果" }; } },
      "../../mocks/conversation": { requestMockConversation: async () => { throw new Error("expansion must not use Mock"); } },
    });
    const bench = useWorkbenchStore([]);
    bench.act("p", { type: "conversation", action: { type: "mode", mode } });
    bench.act("p", { type: "conversation", action: { type: "prompt", value: "扩写执行器测试" } });
    await bench.runConversation("p", "expand");
    assert.equal(calls, 1);
    assert.equal(latest.p.conversation.prompt, "来自扩写接口的结果");
    assert.equal(latest.p.conversation.error, null);
    assert.deepEqual(latest.p.works, {});
  });
}

test("expansion remains disabled for blank input, a running request or an unavailable composer", () => {
  for (const props of [{ value: " " }, { value: "test", busy: "expand" }, { value: "test", busy: "generate" }, { value: "test", disabledReason: "不可用" }]) {
    const html = renderToStaticMarkup(createElement(ChatComposer, { onChange: noop, onSend: noop, onExpand: noop, ...props }));
    assert.match(html.match(/<button[^>]*class="expand-button"[^>]*>/)[0], /disabled/);
  }
});

test("removing the visible hint does not enable Ctrl+Enter for database projects or IME composition", () => {
  const { ChatComposer: Composer } = loadComponent("../src/components/workspace/chat-composer.tsx", {
    react: { useLayoutEffect: noop, useRef: () => ({ current: null }), useId: () => "hint" },
  });
  const nodes = node => isValidElement(node) ? [node, ...Children.toArray(node.props.children).flatMap(nodes)] : [];
  let sends = 0;
  for (const [extra, composing] of [[{ sendDisabledReason: "暂未开放" }, false], [{}, true], [{}, false]]) {
    const field = nodes(Composer({ value: "文本", onChange: noop, onSend: () => sends++, onExpand: noop, ...extra })).find(n => n.type === "textarea");
    field.props.onKeyDown({ key: "Enter", ctrlKey: true, nativeEvent: { isComposing: composing }, preventDefault: noop });
  }
  assert.equal(sends, 1);
});

test("composer grows to its cap, shrinks again and remeasures when the dock width changes", t => {
  const descriptors = Object.fromEntries(["ResizeObserver", "getComputedStyle"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  let onResize, disposed = false;
  globalThis.ResizeObserver = class {
    constructor(callback) { onResize = callback; }
    observe() {}
    disconnect() { disposed = true; }
  };
  globalThis.getComputedStyle = () => ({ maxHeight: "132px" });
  const field = { clientWidth: 300, scrollHeight: 44, scrollTop: 0, style: {} };
  let cleanup;
  const { ChatComposer: Composer } = loadComponent("../src/components/workspace/chat-composer.tsx", {
    react: { useRef: () => ({ current: field }), useId: () => "hint", useLayoutEffect: effect => { cleanup = effect(); } },
  });
  Composer({ value: "短输入", onChange: noop, onSend: noop, onExpand: noop, busy: "expand" });
  assert.equal(field.style.height, "44px");
  field.scrollHeight = 330;
  onResize([{ contentRect: { width: 240 } }]);
  assert.equal(field.style.height, "132px");
  assert.equal(field.scrollTop, 330);
  field.scrollHeight = 44;
  onResize([{ contentRect: { width: 700 } }]);
  assert.equal(field.style.height, "44px");
  cleanup();
  assert.equal(disposed, true);
});

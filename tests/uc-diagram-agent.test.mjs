import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./load-component.mjs";

const { PanoramaWorkspace } = loadComponent("../src/components/panorama/panorama-workspace.tsx", {
  "./panorama.css": {},
});

const baseWork = {
  id: "feature-uc-overview",
  kind: "UC_OVERVIEW",
  featureId: "feature-1",
  featureName: "记录事件",
  attachments: [],
  readOnly: true,
  session: {},
  frBatch: null,
  ucDiagram: {
    status: "succeeded",
    requestId: "request-1",
    sourceVersion: "a".repeat(64),
    ucCount: 1,
    diagramFormat: "mermaid",
    diagramCode: "flowchart LR\\n  A[\"<script>alert(1)</script>\"] --> B",
    message: "ready",
  },
};

const noop = () => {};

function render(overrides = {}) {
  return renderToStaticMarkup(createElement(PanoramaWorkspace, {
    work: { ...baseWork, ...overrides, ucDiagram: { ...baseWork.ucDiagram, ...(overrides.ucDiagram ?? {}) } },
    ucs: [],
    frs: [],
    active: true,
    onAssign: noop,
    onRefreshDiagram: noop,
    onStopDiagram: noop,
  }));
}

test("Agent UC diagram shows inert escaped code and refresh status", () => {
  const html = render();
  assert.match(html, /Mermaid 图代码/);
  assert.match(html, /刷新 UC 图/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /查看 Mermaid 图代码/);
});

test("Agent UC diagram exposes stop state without rendering a local fake diagram", () => {
  const html = render({ ucDiagram: { status: "loading", diagramCode: null, message: null } });
  assert.match(html, /生成中…/);
  assert.match(html, />停止</);
  assert.match(html, /正在读取已确认 UC 并请求 Agent/);
  assert.doesNotMatch(html, /uc-panorama-diagram/);
});

test("empty Agent UC source is a valid read-only state", () => {
  const html = render({ ucDiagram: { status: "empty", ucCount: 0, diagramCode: null, diagramFormat: null, message: "当前功能没有已确认的 UC。" } });
  assert.match(html, /当前功能没有已确认的 UC/);
  assert.match(html, /没有已确认UC，暂不生成图形/);
  assert.match(html, /0 个 已确认 UC/);
});
const { assertSafeUcDiagram } = loadComponent('../src/features/panorama/mermaid-safety.ts');
test('UC graph allows pure graph and rejects configuration and active content',()=>{
  assert.equal(assertSafeUcDiagram('flowchart LR'+String.fromCharCode(10)+' A-->B'),'flowchart LR'+String.fromCharCode(10)+' A-->B');
  for(const code of ['sequenceDiagram','flowchart LR'+String.fromCharCode(10)+'%%{init: {}}%%','flowchart LR'+String.fromCharCode(10)+'click A callback','flowchart LR'+String.fromCharCode(10)+'A[<script>bad</script>]','flowchart LR'+String.fromCharCode(10)+'A[https://example.test]'])assert.throws(()=>assertSafeUcDiagram(code));
});

const { databaseWorkspaceWorks } = loadComponent('../src/features/workbench/database.ts');
test('database UC overview has explicit source marker and no fake artifact identity',()=>{
  const workspace={capabilities:[],subsystems:[],functions:[{id:'f',code:'F',name:'DVR',prd:null,use_cases:[],functional_requirements:[],fr_allocations:[],subsystems:[],accepted_use_cases:[]}]};
  const overview=databaseWorkspaceWorks(workspace).works.find(w=>w.kind==='UC_OVERVIEW');
  assert.equal(overview.sourceMode,'database');
  assert.equal(overview.database,undefined);
  assert.equal(overview.ucDiagram.status,'idle');
});

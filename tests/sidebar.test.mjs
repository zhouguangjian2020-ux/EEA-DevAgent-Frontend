import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { Children, createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { loadTypescript } from "./load-typescript.mjs";

const require = createRequire(import.meta.url);
// Render the real sidebar/tree without adding a test framework or a DOM dependency.
function loadComponent(relativePath, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), compiledModule, compiledModule.exports,
  );
  return compiledModule.exports;
}
const navigation = await loadTypescript("../src/features/navigation/model.ts");
const tree = loadComponent("../src/components/workspace/workspace-tree.tsx");
const { AppSidebar } = loadComponent("../src/components/navigation/app-sidebar.tsx", {
  "@/features/navigation/model": navigation,
  "@/components/workspace/workspace-tree": tree,
});
const noop = () => {};
const item = {
  id: "uc-1", type: "object", name: "测试用例", kind: "UC", functionName: "测试功能", summary: "",
  deletion: { kind: "UC", id: "uc-1", label: "测试用例", canDelete: true },
};
function props(overrides = {}) {
  return {
    navigation: { ...navigation.createNavigationState(), primary: "requirements", view: "workspace" },
    nodes: [item], openFolders: {}, searching: false, search: "", selectedIds: [], totalObjects: 1,
    attachmentTarget: "项目00000000-0000-0000-0000-000000000001对话", canDeleteObjects: true,
    onNavigate: noop, onSearch: noop, onAddObjects: noop, onToggleFolder: noop, onToggleObject: noop,
    onPreview: noop, onObjectMenu: noop, onDeletionMode: noop, onDeleteSelected: noop,
    ...overrides,
  };
}
function elements(node) {
  if (!isValidElement(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}
function control(options, className) {
  return elements(AppSidebar(props(options))).find(element => element.props.className === className);
}
const render = options => renderToStaticMarkup(createElement(AppSidebar, props(options)));

test("sidebar omits redundant project/attachment/current-work blocks while retaining primary controls", () => {
  const html = render({ project: "00000000-0000-0000-0000-000000000001", currentWork: "旧当前工作摘要" });
  assert.doesNotMatch(html, /00000000-0000-0000-0000-000000000001|添加至|当前工作|定位当前对象|sidebar-current-work/);
  for (const label of ["返回全部功能", "需求工程", "模块视图", "搜索对象", "多选删除", "工作空间对象树", "添加到 AI 对话", "测试用例更多操作"]) {
    assert.ok(html.includes(label), `missing retained control: ${label}`);
  }
});

test("search helpers stay removed in normal, deletion and read-only sidebar modes", () => {
  for (const options of [{}, { deletionMode: true, deletionCount: 0 }, { deletionMode: true, deletionCount: 1 }, { canDeleteObjects: false }]) {
    const html = render(options);
    assert.doesNotMatch(html, /tree-hint|单击打开标签|勾选仅作附件候选|删除选择独立保存|不自动选择下级|最多200项/);
    assert.match(html, /aria-label="搜索对象"/);
  }
});

test("attachment button retains selection, target and busy guards plus the original callback", () => {
  const onAddObjects = () => {};
  for (const options of [{}, { selectedIds: [item.id], attachmentTarget: undefined }, { selectedIds: [item.id], attachmentBusy: true }]) {
    assert.equal(control(options, "add-agent").props.disabled, true);
  }
  const button = control({ selectedIds: [item.id], onAddObjects, attachmentBusy: false }, "add-agent");
  assert.equal(button.props.disabled, false);
  assert.equal(button.props.onClick, onAddObjects);
  assert.match(render({ selectedIds: [item.id], attachmentBusy: false }), /添加到 AI 对话 <span>1<\/span>/);
});

test("delete mode keeps its own checks and count without exposing the attachment action", () => {
  const options = { deletionMode: true, deletionCount: 1, deletionSelectedIds: ["UC:uc-1"], selectedIds: [item.id] };
  const html = render(options);
  assert.match(html, /已选 1 项/);
  assert.match(html, /aria-label="删除选择 测试用例"/);
  assert.doesNotMatch(html, /aria-label="选择 测试功能 测试用例"/);
  assert.equal(control(options, "workspace-actions").props.hidden, true);
  assert.equal(control(options, "button-danger").props.disabled, false);
  assert.equal(control({ ...options, deletionCount: 0 }, "button-danger").props.disabled, true);
});

test("tree opening, selection and single-delete callbacks remain connected", () => {
  const onPreview = () => {};
  const onObjectMenu = () => {};
  const onToggleObject = () => {};
  const onToggleDeletion = () => {};
  const node = elements(AppSidebar(props({ onPreview, onObjectMenu, onToggleObject, onToggleDeletion })))
    .find(element => element.type === tree.WorkspaceTree);
  assert.equal(node.props.onPreview, onPreview);
  assert.equal(node.props.onObjectMenu, onObjectMenu);
  assert.equal(node.props.onToggleObject, onToggleObject);
  assert.equal(node.props.onToggleDeletion, onToggleDeletion);
});

test("sidebar preserves empty/search results and module tabs after context removal", () => {
  assert.match(render({ nodes: [], totalObjects: 0 }), /还没有产物/);
  assert.match(render({ nodes: [], totalObjects: 0, searching: true, search: "不匹配" }), /没有找到匹配对象/);
  const html = render({ navigation: { ...navigation.createNavigationState(), primary: "requirements", view: "functions" } });
  assert.match(html, /aria-label="模块视图"/);
  assert.match(html, /用例生成/);
  assert.doesNotMatch(html, /sidebar-current-work|添加至/);
});

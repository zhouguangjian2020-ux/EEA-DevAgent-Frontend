import assert from "node:assert/strict";
import test from "node:test";
import { loadTypescript } from "./load-typescript.mjs";
const { createNavigationState, transitionNavigation, secondaryItems } = await loadTypescript("../src/features/navigation/model.ts");

const transition = (state, action) => transitionNavigation(state, action);

test("workbench starts in the single global navigation view without module tabs", () => {
  const state = createNavigationState();
  assert.equal(state.view, "navigation");
  assert.equal(state.primary, "workbench");
  assert.equal(transition(state, { type: "set-tab", tab: "workspace" }), state);
});

test("expanding several primary functions is independent and does not enter a module", () => {
  const initial = createNavigationState();
  let state = transition(initial, { type: "toggle-expanded", primary: "requirements" });
  state = transition(state, { type: "toggle-expanded", primary: "architecture" });
  state = transition(state, { type: "toggle-expanded", primary: "product" });
  assert.deepEqual(state.expanded, { requirements: true, architecture: true, product: true });
  assert.equal(state.view, "navigation");
  assert.equal(state.primary, "workbench");
  state = transition(state, { type: "toggle-expanded", primary: "architecture" });
  assert.deepEqual(state.expanded, { requirements: true, architecture: false, product: true });
  assert.deepEqual(initial.expanded, {});
});

test("entering a primary function replaces global navigation and starts unselected", () => {
  let state = transition(createNavigationState(), { type: "enter", primary: "requirements", secondary: "用例生成" });
  state = transition(state, { type: "enter", primary: "architecture" });
  assert.equal(state.view, "functions");
  assert.equal(state.primary, "architecture");
  assert.equal(state.secondary, null);
});

test("a global secondary shortcut enters its module and selects the corresponding function", () => {
  const state = transition(createNavigationState(), { type: "enter", primary: "requirements", secondary: "用例生成" });
  assert.equal(state.view, "functions");
  assert.equal(state.primary, "requirements");
  assert.equal(state.secondary, "用例生成");
});

test("tab replacement and back preserve module selection and independently expanded groups", () => {
  let state = transition(createNavigationState(), { type: "toggle-expanded", primary: "requirements" });
  state = transition(state, { type: "toggle-expanded", primary: "architecture" });
  state = transition(state, { type: "enter", primary: "requirements", secondary: "用例生成" });
  state = transition(state, { type: "set-tab", tab: "workspace" });
  assert.equal(state.view, "workspace");
  assert.equal(state.secondary, "用例生成");
  state = transition(state, { type: "set-tab", tab: "functions" });
  assert.equal(state.view, "functions");
  state = transition(state, { type: "back" });
  assert.equal(state.view, "navigation");
  assert.equal(state.primary, "requirements");
  assert.equal(state.secondary, "用例生成");
  assert.deepEqual(state.expanded, { requirements: true, architecture: true });
});

test("workbench clears the secondary selection and cannot show an empty module panel", () => {
  let state = transition(createNavigationState(), { type: "enter", primary: "requirements", secondary: "用例生成" });
  state = transition(state, { type: "enter", primary: "workbench" });
  assert.equal(state.view, "navigation");
  assert.equal(state.secondary, null);
});

test("invalid secondary selections cannot leak across modules", () => {
  const state = transition(createNavigationState(), { type: "enter", primary: "architecture", secondary: "PRD生成" });
  assert.equal(state.secondary, null);
  assert.equal(transition(state, { type: "select-secondary", secondary: "PRD生成" }), state);
  assert.equal(transition(state, { type: "select-secondary", secondary: "逻辑架构" }).secondary, "逻辑架构");
});

test("PRD belongs only to product and requirements uses the three confirmed names", () => {
  assert.deepEqual(secondaryItems.product, ["PRD生成"]);
  assert.deepEqual(secondaryItems.requirements, ["用例生成", "功能设计", "功能分配"]);
  assert.equal(transition(createNavigationState(), { type: "enter", primary: "product", secondary: "PRD生成" }).secondary, "PRD生成");
  assert.equal(transition(createNavigationState(), { type: "enter", primary: "requirements", secondary: "PRD生成" }).secondary, null);
  assert.ok(!JSON.stringify(secondaryItems).includes("FDR"));
});

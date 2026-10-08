import test from "node:test";
import assert from "node:assert/strict";
import { loadTypescript } from "./load-typescript.mjs";
const m = await loadTypescript("../src/features/workbench/model.ts");
const fm = await loadTypescript("../src/mocks/fr.ts");
const demos = await loadTypescript("../src/mocks/workbench.ts");
const pm = await loadTypescript("../src/features/panorama/model.ts");
const step = m.transitionWorkbench;
function ucs() { return step(m.createProjectWorks(), { type: "seed", ...demos.demoWorks("A") }); }
function frs(p = m.createProjectWorks(), featureId = "feature-a", featureName = "FCW") { return step(p, { type: "fr-seed", featureId, featureName, works: fm.createFrWorks("A", featureId, featureName).works }); }
function open(p, featureId, kind = "FR_ALLOCATION_OVERVIEW") { return step(p, { type: "open-panorama", featureId, featureName: "ignored input", kind }); }

test("UC folder has an explicit independent open target and no synthetic diagram object", () => {
  const p = ucs(), tree = m.workTree(p, "UC");
  const folder = tree.find(f => f.children[0].children.length).children[0];
  assert.equal(folder.name, "UC"); assert.equal(folder.panorama.kind, "UC_OVERVIEW");
  assert.ok(folder.children.every(c => c.kind === "UC"));
  let opened = open(p, folder.panorama.featureId, "UC_OVERVIEW");
  const id = opened.activeId; opened = open(opened, folder.panorama.featureId, "UC_OVERVIEW");
  assert.equal(opened.tabs.filter(t => t === id).length, 1);
  assert.equal(m.workObject(opened.works[id]), null);
  assert.equal(m.workStage(opened.works[id]), "用例生成");
});
test("saved UC edits and discard update panorama data but unsaved drafts do not", () => {
  let p = ucs(); const w = Object.values(p.works).find(w => w.kind === "UC");
  const original = w.session.document.content.name;
  p = step(p, { type: "uc", id: w.id, action: { type: "edit" } });
  p = step(p, { type: "uc", id: w.id, action: { type: "edit-content", value: { ...w.session.document.content, name: "Changed name" } } });
  assert.equal(m.featureUcs(p, w.featureId).find(x => x.id === w.id).session.document.content.name, original);
  p = step(p, { type: "uc", id: w.id, action: { type: "save" } });
  assert.equal(m.featureUcs(p, w.featureId).find(x => x.id === w.id).session.document.content.name, "Changed name");
  const count = m.featureUcs(p, w.featureId).length;
  p = step(p, { type: "uc", id: w.id, action: { type: "confirm-discard" } });
  p = step(p, { type: "uc", id: w.id, action: { type: "discard" } });
  assert.equal(m.featureUcs(p, w.featureId).length, count - 1);
  assert.equal(m.workObject(p.works[w.id]), null);
});
test("multi-actor diagram only connects declared actor / UC associations", () => {
  const rows = [{ id: "a", content: { actors: "用户、HMI、用户" } }, { id: "b", content: { actors: "HMI" } }];
  assert.deepEqual(pm.diagramActors(rows), [{ name: "用户", ids: ["a"] }, { name: "HMI", ids: ["a", "b"] }]);
});
test("two business features retain all 26 FRs and separate overview targets", () => {
  const p = frs(frs(), "feature-b", "LKA");
  assert.equal(m.featureFrs(p, "feature-a").length, 13); assert.equal(m.featureFrs(p, "feature-b").length, 13);
  assert.equal(new Set([...m.featureFrs(p, "feature-a"), ...m.featureFrs(p, "feature-b")].map(w => w.objectId)).size, 26);
  assert.equal(m.workTree(p, "FR").length, 2);
  assert.equal(m.workTree(p, "FR分配")[0].children[0].name, "FR分配");
});
test("only valid subsystem IDs can be assigned to a current feature's FR", () => {
  let p = open(frs(frs(), "feature-b", "LKA"), "feature-a"); const id = p.activeId;
  const a = m.featureFrs(p, "feature-a")[0], b = m.featureFrs(p, "feature-b")[0];
  assert.equal(step(p, { type: "assign-fr", id, frId: b.id, subsystemIds: ["body"] }), p);
  assert.equal(step(p, { type: "assign-fr", id, frId: a.id, subsystemIds: ["invalid"] }), p);
  const original = p.works[a.id];
  p = step(p, { type: "assign-fr", id, frId: a.id, subsystemIds: ["body", "power", "body"] });
  assert.deepEqual(p.works[id].assignments[a.id], ["body", "power"]);
  assert.equal(p.works[a.id], original);
  assert.equal(p.works[id].assignments[b.id], undefined);
  p = step(p, { type: "assign-fr", id, frId: a.id, subsystemIds: [] });
  assert.deepEqual(p.works[id].assignments[a.id], []);
});
test("allocation, conversation and prompt survive close / reopen without duplicates", () => {
  let p = open(frs(), "feature-a"), id = p.activeId; const fr = m.featureFrs(p, "feature-a")[0];
  p = step(p, { type: "assign-fr", id, frId: fr.id, subsystemIds: ["hmi"] });
  p = step(p, { type: "panorama", id, action: { type: "prompt", value: "Only in allocation" } });
  p = step(p, { type: "close", id }); assert.equal(p.closeRequest, null);
  p = open(p, "feature-a"); assert.equal(p.activeId, id);
  assert.deepEqual(p.works[id].assignments[fr.id], ["hmi"]); assert.equal(p.works[id].session.prompt, "Only in allocation");
  p = open(p, "feature-a", "UC_OVERVIEW"); assert.equal(p.works[p.activeId].session.prompt, "");
  assert.equal(m.workStage(p.works[id]), "功能分配");
});
test("FR committed edit immediately appears in allocation data without changing assignment", () => {
  let p = open(frs(), "feature-a"), id = p.activeId; const fr = m.featureFrs(p, "feature-a")[0];
  p = step(p, { type: "assign-fr", id, frId: fr.id, subsystemIds: ["body"] });
  p = step(p, { type: "fr", id: fr.id, action: { type: "edit" } });
  p = step(p, { type: "fr", id: fr.id, action: { type: "edit-content", value: { ...fr.session.document.content, description: "Saved requirement" } } });
  p = step(p, { type: "fr", id: fr.id, action: { type: "save" } });
  assert.equal(m.featureFrs(p, "feature-a")[0].session.document.content.description, "Saved requirement");
  assert.deepEqual(p.works[id].assignments[fr.id], ["body"]);
});
test("project-scoped state prevents allocation leakage for equal feature IDs", () => {
  let store = { A: frs(), B: frs() };
  store = m.workbenchReducer(store, { project: "A", action: { type: "open-panorama", kind: "FR_ALLOCATION_OVERVIEW", featureId: "feature-a", featureName: "FCW" } });
  const id = store.A.activeId; const fr = m.featureFrs(store.A, "feature-a")[0];
  store = m.workbenchReducer(store, { project: "A", action: { type: "assign-fr", id, frId: fr.id, subsystemIds: ["power"] } });
  store = m.workbenchReducer(store, { project: "B", action: { type: "open-panorama", kind: "FR_ALLOCATION_OVERVIEW", featureId: "feature-a", featureName: "FCW" } });
  assert.deepEqual(store.B.works[id].assignments, {});
});
test("overview chat is local-only and cannot modify sources or allocation", () => {
  let p = open(frs(), "feature-a"), id = p.activeId;
  const sources = m.featureFrs(p, "feature-a");
  p = step(p, { type: "panorama", id, action: { type: "prompt", value: "change all data" } });
  p = step(p, { type: "panorama", id, action: { type: "discuss", messageId: "one" } });
  assert.deepEqual(m.featureFrs(p, "feature-a"), sources); assert.deepEqual(p.works[id].assignments, {});
  assert.equal(p.works[id].session.prompt, ""); assert.equal(p.works[id].session.messages.length, 3);
});
test("home is not an object tab and cannot be closed or reordered", () => {
  const p = frs();
  assert.equal(step(p, { type: "close", id: "home" }), p);
  assert.equal(step(p, { type: "reorder", id: "home", beforeId: p.activeId }), p);
  assert.equal(step(p, { type: "home" }).activeId, null);
});


test("an empty already-open UC panorama fills automatically when UC generation completes without focus theft", () => {
  const demo = demos.demoWorks("A"), source = demo.works.find(w => w.kind === "PRD" && w.featureName === "儿童锁");
  let p = step(m.createProjectWorks(), { type: "seed", works: [source], openId: source.id });
  p = open(p, source.featureId, "UC_OVERVIEW"); const overview = p.activeId;
  assert.equal(m.featureUcs(p, source.featureId).length, 0);
  p = step(p, { type: "uc-start", id: source.id, taskId: "new-ucs" });
  p = step(p, { type: "uc-ready", id: source.id, taskId: "new-ucs", works: demo.works.filter(w => w.kind === "UC" && w.featureId === source.featureId) });
  assert.equal(m.featureUcs(p, source.featureId).length, 5);
  assert.equal(p.activeId, overview); assert.equal(p.tabs.filter(id => p.works[id].kind === "UC").length, 0);
});


test("Agent UC diagram lifecycle preserves cache, rejects stale completion, and survives database refresh", () => {
  const seeded = ucs(), source = Object.values(seeded.works).find(w => w.kind === "PRD");
  let p = open(seeded, source.featureId, "UC_OVERVIEW");
  const id = p.activeId;
  assert.equal(p.works[id].ucDiagram.status, "idle");
  p = step(p, { type: "uc-diagram-start", id, taskId: "diagram-1" });
  assert.equal(p.works[id].ucDiagram.status, "loading");
  const state = {
    status: "succeeded", requestId: "diagram-1", sourceVersion: "a".repeat(64), ucCount: 2,
    diagramFormat: "mermaid", diagramCode: "flowchart LR\n  A --> B", message: "ready",
  };
  p = step(p, { type: "uc-diagram-ready", id, taskId: "diagram-1", state });
  assert.equal(p.works[id].ucDiagram.diagramCode, state.diagramCode);
  const completed = p;
  p = step(p, { type: "uc-diagram-ready", id, taskId: "diagram-1", state: { ...state, diagramCode: "late overwrite" } });
  assert.strictEqual(p, completed);
  p = step(p, { type: "uc-diagram-start", id, taskId: "diagram-2" });
  assert.equal(p.works[id].ucDiagram.diagramCode, state.diagramCode);
  p = step(p, { type: "uc-diagram-ready", id, taskId: "diagram-2", state: { ...state, requestId: "diagram-2", status: "unchanged", message: "unchanged" } });
  assert.equal(p.works[id].ucDiagram.diagramCode, state.diagramCode);
  p = step(p, { type: "uc-diagram-start", id, taskId: "diagram-3" });
  p = step(p, { type: "uc-diagram-failed", id, taskId: "diagram-3", message: "upstream down" });
  assert.equal(p.works[id].ucDiagram.status, "error");
  assert.equal(p.works[id].ucDiagram.diagramCode, state.diagramCode);
  p = step(p, { type: "uc-diagram-start", id, taskId: "diagram-4" });
  p = step(p, { type: "uc-diagram-cancel", id, taskId: "diagram-4", message: "stopped" });
  assert.equal(p.works[id].ucDiagram.status, "idle");
  assert.equal(p.works[id].ucDiagram.diagramCode, state.diagramCode);
  const refreshedWork = { ...p.works[id], readOnly: true };
  p = step(p, { type: "database-seed", works: [refreshedWork], features: [], capabilities: [] });
  assert.equal(p.works[id].ucDiagram.diagramCode, state.diagramCode);
  assert.equal(p.works[id].ucDiagram.sourceVersion, state.sourceVersion);
});

test("empty UC diagram result clears an old cached code", () => {
  const seeded = ucs(), source = Object.values(seeded.works).find(w => w.kind === "PRD");
  let p = open(seeded, source.featureId, "UC_OVERVIEW"), id = p.activeId;
  p = step(p, { type: "uc-diagram-start", id, taskId: "diagram-empty" });
  p = step(p, { type: "uc-diagram-ready", id, taskId: "diagram-empty", state: {
    status: "empty", requestId: "diagram-empty", sourceVersion: "b".repeat(64), ucCount: 0,
    diagramFormat: null, diagramCode: null, message: "empty",
  } });
  assert.equal(p.works[id].ucDiagram.status, "empty");
  assert.equal(p.works[id].ucDiagram.diagramCode, null);
  assert.equal(p.works[id].ucDiagram.ucCount, 0);
});

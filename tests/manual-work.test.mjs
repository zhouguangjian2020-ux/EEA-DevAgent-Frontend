import test from "node:test";
import assert from "node:assert/strict";
import { loadTypescript } from "./load-typescript.mjs";
const { createProjectWorks, transitionWorkbench: act, projectWorkspaceTree, featureOverviewId, isWorkDirty } = await loadTypescript("../src/features/workbench/model.ts");
const { databaseWorkspaceWorks } = await loadTypescript("../src/features/workbench/database.ts");
const { draftBody, acceptanceIssue, acceptedPrd, acceptedUcs } = await loadTypescript("../src/features/workbench/manual-model.ts");
const { mockManualWork } = await loadTypescript("../src/mocks/manual-work.ts");
const feature = { id: "aeb", name: "AEB", description: "紧急制动" };
const base = () => act(createProjectWorks(), { type: "manual-feature", feature });
function workspace() { return { project: { id: "p" }, capabilities: ["PRD.create", "PRD.update"], functions: [{ ...feature, prd: null, use_cases: [], functional_requirements: [], fr_allocations: [], subsystems: [], accepted_use_cases: [] }] }; }

test("one feature is shared by all six modules, no fake artifacts or allocations", () => {
  let p = base();
  for (const moduleKey of ["product", "requirements", "architecture", "development", "test", "safety"]) {
    const [root] = projectWorkspaceTree(p, moduleKey);
    assert.equal(root.panorama.kind, "FEATURE_OVERVIEW"); assert.equal(root.panorama.featureId, feature.id);
    p = act(p, { type: "open-feature", featureId: feature.id });
    assert.equal(p.tabs.length, 1); assert.equal(p.activeId, featureOverviewId(feature.id));
    if (moduleKey === "requirements") { assert.deepEqual(root.children.map(c => c.name), ["UC", "FR", "FR分配"]); assert.ok(root.children.every(c => c.children.length === 0)); }
  }
  assert.equal(Object.values(p.works).filter(w => ["PRD", "UC", "FR"].includes(w.kind)).length, 0);
});
test("empty database function has feature view and empty categories, never a placeholder PRD", () => {
  const seed = databaseWorkspaceWorks(workspace());
  assert.ok(!seed.works.some(w => w.kind === "PRD"));
  const p = act(createProjectWorks(), { type: "database-seed", ...seed });
  assert.deepEqual(p.features.aeb, { ...feature, code: undefined, lockVersion: undefined, canUpdate: false, acceptedPrdRevisionId: undefined, acceptedUcs: [] });
  assert.equal(acceptedPrd(p, feature.id), undefined);
  assert.equal(projectWorkspaceTree(p, "requirements")[0].children.length, 3);
});
test("manual UC and FR are pending drafts, do not fabricate optional engineering content", () => {
  const uc = mockManualWork(feature, { kind: "UC", creation_id: "uc", name: "制动", prd_revision_id: "p1" });
  const fr = mockManualWork(feature, { kind: "FR", creation_id: "fr", description: "应制动", sources: [] });
  assert.equal(uc.session.document.status, "pending"); assert.equal(fr.session.document.status, "pending");
  assert.deepEqual(uc.session.document.content.branches, ["", "", "", ""]);
  assert.equal(uc.session.document.content.description, ""); assert.ok(acceptanceIssue(uc)); assert.ok(acceptanceIssue(fr));
  assert.deepEqual(draftBody({ ...fr, session: { ...fr.session, editDraft: fr.session.document.content } }).sources, []);
});
test("database writes cannot accidentally use mock save, accept, discard or generation reducers", () => {
  let w = mockManualWork(feature, { kind: "PRD", creation_id: "prd", name: "AEB说明" });
  w.database = { artifactId: "prd", revisionId: "r1", canUpdate: true, canAccept: true };
  w.session.editDraft = "# 修改";
  const p = act(base(), { type: "manual-work", work: w });
  for (const type of ["save", "accept", "discard", "start", "generated"]) assert.deepEqual(act(p, { type: "prd", id: w.id, action: { type } }), p);
  assert.equal(isWorkDirty(w), true);
  const closing = act(p, { type: "close", id: w.id });
  assert.equal(act(closing, { type: "resolve-close", id: w.id, choice: "save" }).activeId, w.id);
});
test("database refresh preserves dirty drafts, conversation and focus; only saved target is replaced", () => {
  let a = mockManualWork(feature, { kind: "PRD", creation_id: "a", name: "A" });
  a.session.editDraft = "# 未保存";
  let p = act(base(), { type: "manual-work", work: a });
  p = act(p, { type: "conversation", action: { type: "prompt", value: "保留对话" } });
  const fresh = { ...a, session: { ...a.session, editDraft: null } };
  const update = act(p, { type: "database-seed", works: [fresh] });
  assert.equal(update.works.a.session.editDraft, "# 未保存"); assert.equal(update.activeId, "a"); assert.equal(update.conversation.prompt, "保留对话");
  assert.equal(act(update, { type: "database-seed", works: [fresh], savedId: "a" }).works.a.session.editDraft, null);
});
test("accepted source picker uses accepted snapshot rather than unaccepted head names or revisions", () => {
  let p = base(); p.features.aeb.acceptedUcs = [{ uc_id: "uc", uc_revision_id: "accepted-r1", uc_code: "UC-1", uc_name: "已确认名称" }];
  p.features.aeb.acceptedPrdRevisionId = "accepted-prd";
  assert.equal(acceptedUcs(p, "aeb")[0].uc_revision_id, "accepted-r1"); assert.equal(acceptedPrd(p, "aeb"), "accepted-prd");
});

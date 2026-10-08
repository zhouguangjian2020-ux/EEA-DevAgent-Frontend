import test from "node:test";
import assert from "node:assert/strict";
import { loadTypescript } from "./load-typescript.mjs";
const { createProjectWorks, transitionWorkbench } = await loadTypescript("../src/features/workbench/model.ts");
const { databaseWorkspaceWorks } = await loadTypescript("../src/features/workbench/database.ts");
const { buildConversationRequest, conversationFeatures, validateConversationRequest } = await loadTypescript("../src/features/conversation/model.ts");
const chat = (state, action) => transitionWorkbench(state, { type: "conversation", action });
function databaseProject(empty = false) {
  const seed = databaseWorkspaceWorks({
    project: { id: "db-project" }, read_only: true, source: "database",
    functions: empty ? [] : [{ id: "dvr", name: "行车记录仪DVR", prd: null, use_cases: [], functional_requirements: [], fr_allocations: [], subsystems: [] }],
  });
  return transitionWorkbench(createProjectWorks(), { type: "database-seed", ...seed });
}

test("database shortcut mode selection preserves read-only objects and local draft", () => {
  let p = chat(databaseProject(), { type: "prompt", value: "DVR 功能定义" });
  const original = p.works;
  for (const mode of ["PRD", null, "UC", null]) {
    p = chat(p, { type: "mode", mode });
    assert.equal(p.conversation.mode, mode);
    assert.equal(p.conversation.prompt, "DVR 功能定义");
    assert.deepEqual(p.works, original);
    assert.ok(Object.values(p.works).every(w => w.readOnly));
  }
});

for (const mode of [null, "PRD", "UC"]) for (const empty of [false, true]) test(`database expansion updates only draft (mode=${mode}, empty=${empty})`, () => {
  let p = chat(databaseProject(empty), { type: "mode", mode });
  p = chat(p, { type: "prompt", value: "DVR 功能定义" });
  const original = structuredClone(p.works);
  const r = buildConversationRequest("db-project", p, "expansion", "expand");
  assert.equal(validateConversationRequest(p, r), "");
  assert.equal(r.featureId, null);
  p = chat(p, { type: "start", request: r });
  p = chat(p, { type: "success", id: r.id, response: { message: "", expandedPrompt: "DVR 扩写结果", expansionSource: "agent" } });
  assert.equal(p.conversation.prompt, "DVR 扩写结果");
  assert.deepEqual(p.works, original);
  assert.deepEqual(p.conversation.messages, []);
});

test("database UC selector includes only real features, never test A/B/C", () => {
  assert.deepEqual(conversationFeatures("db-project", databaseProject(), false), [{ id: "dvr", name: "行车记录仪DVR" }]);
  assert.deepEqual(conversationFeatures("db-project", databaseProject(true), false), []);
  assert.equal(conversationFeatures("A", createProjectWorks()).length, 3);
});

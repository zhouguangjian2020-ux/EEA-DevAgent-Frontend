import assert from "node:assert/strict";
import test from "node:test";
import { loadTypescript } from "./load-typescript.mjs";

const model = await loadTypescript("../src/features/projects/model.ts");
const api = await loadTypescript("../src/lib/api/client.ts");
const database = await loadTypescript("../src/features/workbench/database.ts");
const input = { creation_id: "a39f5ec0-1122-4333-8abc-0123456789ab", name: "新项目", description: null };

test("project form matches trimmed Unicode limits and optional description", () => {
  assert.ok(model.projectFormError("  ", ""));
  assert.ok(model.projectFormError("中".repeat(101), ""));
  assert.ok(model.projectFormError("a", "中".repeat(2001)));
  assert.ok(model.projectFormError("a\0b", ""));
  assert.equal(model.projectFormError("😀".repeat(100), "文".repeat(2000)), "");
  assert.deepEqual(model.projectSubmission(input.creation_id, "  新项目  ", " \n "), input);
});

test("project list merges by ID, retains same-name projects and existing selection identities", () => {
  const old = [{ id: "a", name: "同名" }, { id: "b", name: "同名" }];
  const result = model.mergeProjects(old, [{ id: "b", name: "同名", code: "updated" }, { id: "c", name: "同名" }]);
  assert.equal(result.length, 3);
  assert.equal(result[1].code, "updated");
  assert.equal(old[1].code, undefined);
  assert.equal(result[0], old[0]);
});

test("empty real project produces no mock function, PRD, UC, FR or allocation", () => {
  assert.deepEqual(database.databaseWorkspaceWorks({ project: { id: "new" }, functions: [], read_only: true, source: "database" }), { works: [], features: [], capabilities: [], openId: "" });
});

test("creation goes to same-origin backend with cookie, JSON and CSRF header; retry keeps UUID", async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push([url, init]); return new Response(JSON.stringify({ id: input.creation_id, name: input.name }), { status: seen.length === 1 ? 201 : 200 }); };
  try {
    const first = await api.createProject(input);
    assert.deepEqual(await api.createProject(input), first);
    assert.equal(seen.length, 2);
    for (const [url, init] of seen) {
      assert.equal(url, "/api/v1/projects");
      assert.equal(init.method, "POST");
      assert.equal(init.credentials, "include");
      assert.equal(init.headers["X-Project-Request"], "1");
      assert.deepEqual(JSON.parse(init.body), input);
      assert.ok(init.signal instanceof AbortSignal);
    }
  } finally { globalThis.fetch = original; }
});

for (const status of [401, 403, 409, 422, 503, 504]) {
  test(`creation ${status} never falls back to mock or auto-retries`, async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ detail: { code: "failure", message: "服务拒绝" } }), { status }); };
    try {
      await assert.rejects(api.createProject(input), error => error instanceof api.ApiError && error.status === status && error.message === "服务拒绝");
      assert.equal(calls, 1);
    } finally { globalThis.fetch = original; }
  });
}

test("validation array becomes readable error, not object coercion or echoed user input", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: [{ input: "secret", msg: "invalid" }] }), { status: 422 });
  try { await assert.rejects(api.createProject(input), error => error.message.includes("字段校验") && !error.message.includes("secret") && !error.message.includes("[object")); }
  finally { globalThis.fetch = original; }
});

test("pagination uses existing endpoint and carries no caller-controlled identity", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => { assert.equal(url, "/api/v1/projects?limit=20&offset=100"); return new Response(JSON.stringify({ items: [], capabilities: { can_create: false } })); };
  try { assert.equal((await api.getProjects(100, 20)).capabilities.can_create, false); }
  finally { globalThis.fetch = original; }
});

import assert from "node:assert/strict";
import test from "node:test";
import { loadTypescript } from "./load-typescript.mjs";

const { requestUcGeneration, requestUcDiagram } = await loadTypescript("../src/features/workbench/uc-generation-api.ts");
const input = {
  prdId: "30d4c8a0-ff3a-56c3-abf6-18dc3b531e62",
  prdRevisionId: "40d4c8a0-ff3a-56c3-abf6-18dc3b531e62",
  clientRequestId: "a0d4c8a0-ff3a-46c3-abf6-18dc3b531e62",
};

test("UC generation sends only source identities to the business backend", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/v1/agent/generations");
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "include");
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.equal(init.headers["X-Project-Request"], "1");
    assert.equal(init.headers["Idempotency-Key"], "a0d4c8a0-ff3a-46c3-abf6-18dc3b531e62");
    assert.deepEqual(JSON.parse(init.body), {
      scene: "FROM_PRD_CREATE_UC",
      project_id: "10d4c8a0-ff3a-56c3-abf6-18dc3b531e62",
      function_id: "20d4c8a0-ff3a-56c3-abf6-18dc3b531e62",
      source: { kind: "PRD", artifact_id: "30d4c8a0-ff3a-56c3-abf6-18dc3b531e62", revision_id: "40d4c8a0-ff3a-56c3-abf6-18dc3b531e62" },
      client_request_id: "a0d4c8a0-ff3a-46c3-abf6-18dc3b531e62",
    });
    return Response.json({
      generation_id: "50d4c8a0-ff3a-56c3-abf6-18dc3b531e62",
      scene: "FROM_PRD_CREATE_UC",
      status: "succeeded",
      source: { project_id: "10d4c8a0-ff3a-56c3-abf6-18dc3b531e62", function_id: "20d4c8a0-ff3a-56c3-abf6-18dc3b531e62", prd_id: "30d4c8a0-ff3a-56c3-abf6-18dc3b531e62", prd_revision_id: "40d4c8a0-ff3a-56c3-abf6-18dc3b531e62" },
    });
  });
  const result = await requestUcGeneration("10d4c8a0-ff3a-56c3-abf6-18dc3b531e62", "20d4c8a0-ff3a-56c3-abf6-18dc3b531e62", input, new AbortController().signal);
  assert.equal(result.status, "succeeded");
});

test("UC generation does not send PRD content or an Agent key", async t => {
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.headers["X-API-Key"], undefined);
    const body = JSON.parse(init.body);
    assert.equal(body.prd_content, undefined);
    assert.equal(body.message, undefined);
    return Response.json({
      generation_id: "50d4c8a0-ff3a-56c3-abf6-18dc3b531e62",
      scene: "FROM_PRD_CREATE_UC",
      status: "succeeded",
      source: { project_id: "10d4c8a0-ff3a-56c3-abf6-18dc3b531e62", function_id: "20d4c8a0-ff3a-56c3-abf6-18dc3b531e62", prd_id: "30d4c8a0-ff3a-56c3-abf6-18dc3b531e62", prd_revision_id: "40d4c8a0-ff3a-56c3-abf6-18dc3b531e62" },
    });
  });
  await requestUcGeneration("10d4c8a0-ff3a-56c3-abf6-18dc3b531e62", "20d4c8a0-ff3a-56c3-abf6-18dc3b531e62", input);
});


test("UC diagram sends only function identity and the known source fingerprint", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/v1/agent/uc-diagram");
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "include");
    assert.equal(init.headers["X-Project-Request"], "1");
    assert.equal(init.headers["Idempotency-Key"], input.clientRequestId);
    assert.deepEqual(JSON.parse(init.body), {
      scene: "FROM_UC_CREATE_UC_DIAGRAM",
      project_id: "10d4c8a0-ff3a-56c3-abf6-18dc3b531e62",
      function_id: "20d4c8a0-ff3a-56c3-abf6-18dc3b531e62",
      known_uc_source_version: "a".repeat(64),
      client_request_id: input.clientRequestId,
    });
    return Response.json({
      generation_id: input.clientRequestId,
      scene: "FROM_UC_CREATE_UC_DIAGRAM",
      status: "unchanged",
      source: { project_id: "10d4c8a0-ff3a-56c3-abf6-18dc3b531e62", function_id: "20d4c8a0-ff3a-56c3-abf6-18dc3b531e62", uc_count: 2 },
      source_version: "a".repeat(64),
    });
  });
  const result = await requestUcDiagram("10d4c8a0-ff3a-56c3-abf6-18dc3b531e62", "20d4c8a0-ff3a-56c3-abf6-18dc3b531e62", {
    knownUcSourceVersion: "a".repeat(64), clientRequestId: input.clientRequestId,
  });
  assert.equal(result.status, "unchanged");
});



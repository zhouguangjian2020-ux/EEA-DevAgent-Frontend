import assert from "node:assert/strict";
import test from "node:test";
import { loadTypescript } from "./load-typescript.mjs";

const { createPrdSession, transitionPrd } = await loadTypescript("../src/features/prd/model.ts");
const { createUcSession, transitionUc } = await loadTypescript("../src/features/uc/model.ts");
const { createFrSession, transitionFr } = await loadTypescript("../src/features/fr/model.ts");
const { generateMockPrd } = await loadTypescript("../src/mocks/prd.ts");
const { createMockUc } = await loadTypescript("../src/mocks/uc.ts");
const { createMockFr } = await loadTypescript("../src/mocks/fr.ts");

test("draft save stays permissive while PRD acceptance requires nonblank body", () => {
  const document = generateMockPrd("A", "测试功能", null, "job", "测试功能");
  let session = transitionPrd({ ...createPrdSession(), document, rootName: document.functionName, selected: true }, { type: "edit" });
  session = transitionPrd(session, { type: "edit-text", value: " \n" });
  session = transitionPrd(session, { type: "save" });
  assert.equal(session.document.content, " \n");
  assert.equal(session.document.status, "pending");
  session = transitionPrd(session, { type: "accept" });
  assert.equal(session.document.status, "pending");
});

test("UC draft does not require filling branch/exception slots, but acceptance requires three core fields", () => {
  const document = createMockUc("A", "测试功能", "source", 0);
  let session = createUcSession({ ...document, content: { ...document.content, name: "", description: "", mainFlow: "", branches: ["", "", "", ""], exceptions: ["", "", "", "", ""] } });
  session = transitionUc(session, { type: "edit" });
  session = transitionUc(session, { type: "save" });
  assert.equal(session.document.content.name, "");
  assert.equal(session.document.status, "pending");
  session = transitionUc(session, { type: "accept" });
  assert.equal(session.document.status, "pending");
});

test("FR draft may have zero displayed sources, but acceptance requires source and description", () => {
  const document = createMockFr("A", "测试功能", 0);
  let session = createFrSession({ ...document, content: { ...document.content, source: "", description: "" } });
  session = transitionFr(session, { type: "edit" });
  session = transitionFr(session, { type: "save" });
  assert.equal(session.document.content.source, "");
  assert.equal(session.document.status, "pending");
  session = transitionFr(session, { type: "accept" });
  assert.equal(session.document.status, "pending");
});

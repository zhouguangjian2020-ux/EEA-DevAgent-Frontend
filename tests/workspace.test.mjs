import assert from "node:assert/strict";
import test from "node:test";
import { loadTypescript } from "./load-typescript.mjs";
const { workspaceByProject, getTestFeatures } = await loadTypescript("../src/mocks/workspace.ts");
const { appendAttachments, collectObjects, filterWorkspaceTree } = await loadTypescript("../src/features/workspace/tree.ts");
const object = (id, name) => ({ id, type: "object", kind: "UC", name, functionName: "测试功能 A", summary: "fixture" });
const a = object("uc-a", "UC-A 正常场景"), b = object("uc-b", "UC-B 异常场景");
const roots = [{ id: "feature", type: "folder", level: "function", name: "测试功能 A", children: [{ id: "uc", type: "folder", level: "category", name: "UC", children: [a, b] }, { id: "fr", type: "folder", level: "category", name: "FR", children: [] }] }];
test("all projects start with empty artifact trees and exactly three selectable test features", () => {
  for (const [project, modules] of Object.entries(workspaceByProject)) {
    for (const tree of Object.values(modules)) assert.deepEqual(tree, []);
    assert.deepEqual(getTestFeatures(project).map(f => f.name), ["测试功能 A", "测试功能 B", "测试功能 C"]);
  }
  assert.equal(new Set([...getTestFeatures("A"), ...getTestFeatures("B")].map(f => f.id)).size, 6);
});
test("recursive collection includes only objects", () => assert.deepEqual(collectObjects(roots), [a, b]));
test("case insensitive leaf search retains category and function ancestors", () => {
  const result = filterWorkspaceTree(roots, "uc-b");
  assert.equal(result[0].id, "feature"); assert.equal(result[0].children[0].id, "uc"); assert.deepEqual(collectObjects(result), [b]);
});
test("folder search retains its complete subtree, blank search preserves reference", () => {
  assert.deepEqual(collectObjects(filterWorkspaceTree(roots, "测试功能")), [a, b]);
  assert.equal(filterWorkspaceTree(roots, "  "), roots);
  assert.deepEqual(filterWorkspaceTree(roots, "does not exist"), []);
});
test("attachments deduplicate without mutating candidates", () => {
  const input = [a]; assert.deepEqual(appendAttachments(input, [a,b,b]), [a,b]); assert.deepEqual(input,[a]);
});

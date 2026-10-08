import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./load-component.mjs";
import { loadTypescript } from "./load-typescript.mjs";
const noop = () => {};
const { createPrdSession } = await loadTypescript("../src/features/prd/model.ts");
const { createUcSession } = await loadTypescript("../src/features/uc/model.ts");
const { createFrSession } = await loadTypescript("../src/features/fr/model.ts");
const { createMockUc } = await loadTypescript("../src/mocks/uc.ts");
const { PrdWorkspace } = loadComponent("../src/components/prd/prd-workspace.tsx", { "react-markdown": await import("react-markdown"), "remark-gfm": await import("remark-gfm") });
const { UcWorkspace } = loadComponent("../src/components/uc/uc-workspace.tsx");
const { FrWorkspace } = loadComponent("../src/components/fr/fr-workspace.tsx");
const { DatabaseReview } = loadComponent("../src/components/workbench/database-review.tsx");
const persistence = { artifactId: "a", lockVersion: "1", revisionId: "r", canUpdate: true, canAccept: true, onRefresh: noop };
const prd = { ...createPrdSession(), document: { id: "prd", functionName: "功能名称", content: "# 正文", revision: 1, status: "pending" } };
const uc = createUcSession(createMockUc("p", "功能名称", "prd", 1));
uc.notice = "";
uc.document.content.sourcePrdRevisionId = "old-prd-version";
const fr = createFrSession({ id: "fr", featureName: "功能名称", content: { id: "FR-01", source: "UC-01", description: "需求描述" }, revision: 1, status: "pending" });
fr.notice = "";
const cases = [
  ["PRD", PrdWorkspace, prd, { featureName: "功能名称", onAction: noop, onGenerateUcs: noop, generatedUcs: [], onOpenUc: noop, onStopUcs: noop }],
  ["UC", UcWorkspace, uc, { featureName: "功能名称", number: "UC-01", sourceName: "来源功能", onSource: noop, onAction: noop, referenceTargets: {}, onOpenReference: noop, acceptedPrdRevisionId: "new-prd-version" }],
  ["FR", FrWorkspace, fr, { featureName: "功能名称", number: "FR-01", onAction: noop, onBack: noop, candidates: [] }],
];
for (const [kind, Component, seed, props] of cases) {
  for (const state of ["pending", "accepted", "editing"]) test(kind + " state appears once in the edit toolbar: " + state, () => {
    const session = { ...seed, document: { ...seed.document, status: state === "accepted" ? "accepted" : "pending" }, editDraft: state === "editing" ? seed.document.content : null };
    const html = renderToStaticMarkup(createElement(Component, { ...props, session, persistence }));
    const label = state === "accepted" ? "已确认" : state === "editing" ? "编辑中" : "待确认";
    assert.equal((html.match(/aria-label="文档状态"/g) || []).length, 1);
    const status = html.indexOf('aria-label="文档状态"');
    const toolbar = html.indexOf(kind === "FR" ? 'class="fr-document-toolbar' : 'class="prd-document-toolbar');
    const body = html.indexOf(kind === "PRD" ? 'class="prd-paper' : kind === "UC" ? 'class="uc-document-meta"' : 'class="fr-detail-card"');
    assert.ok(status > toolbar && status < body);
    assert.ok(html.slice(status, body).includes(label));
    const identity = kind === "FR" ? html.indexOf("<small>功能名称</small>", toolbar) : html.indexOf(">功能名称</strong>", toolbar);
    assert.ok(identity >= toolbar && identity < status, kind + " status follows the feature name");
    assert.ok(status - identity < 180, kind + " state remains visually adjacent to the feature name");
    assert.ok(html.slice(toolbar, body).includes(state === "editing" ? "保存草稿" : "编辑"));
    const review = html.indexOf('class="database-review"');
    assert.ok(review > toolbar && review < body, kind + " review controls render in the top toolbar");
    assert.ok(html.slice(toolbar, body).includes("已审阅当前版本"));
    assert.ok(html.slice(toolbar, body).includes("刷新数据"));
    assert.doesNotMatch(html, /请在需求工程工作空间打开 UC 全景/);
    assert.doesNotMatch(html, /数据库 UC；|数据库 FR；|数据库版本|引用 PRD 版本：|来源已不是当前确认版本|保存不等于确认；确认时校验/);
  });
  test(kind + " keeps real validation feedback instead of hiding all notices", () => {
    const html = renderToStaticMarkup(createElement(Component, { ...props, session: { ...seed, notice: "上游版本已变化，请检查来源" }, persistence }));
    assert.match(html, /role="status">上游版本已变化，请检查来源/);
  });
}

test("local document review actions also stay in the top toolbar", () => {
  for (const [kind, Component, seed, props] of cases) {
    const html = renderToStaticMarkup(createElement(Component, { ...props, session: seed }));
    const toolbar = html.indexOf(kind === "FR" ? 'class="fr-document-toolbar' : 'class="prd-document-toolbar');
    const body = html.indexOf(kind === "PRD" ? 'class="prd-paper' : kind === "UC" ? 'class="uc-document-meta"' : 'class="fr-detail-card"');
    if (kind === "FR") {
      const checkbox = html.indexOf('class="document-toolbar-review fr-review-selection"');
      assert.ok(checkbox > toolbar && checkbox < body);
      assert.ok(html.slice(toolbar, body).includes("确认"));
    } else {
      const review = html.indexOf('class="object-review-bar"');
      assert.ok(review > toolbar && review < body);
      assert.ok(html.slice(toolbar, body).includes("确认"));
      assert.equal(html.indexOf('class="object-review-bar"', body), -1);
    }
  }
});

test("database PRD no longer shows the bottom UC-panorama instruction", () => {
  const html = renderToStaticMarkup(createElement(PrdWorkspace, { ...cases[0][3], session: prd, persistence, readOnly: true }));
  assert.doesNotMatch(html, /请在需求工程工作空间打开 UC 全景/);
  assert.ok(html.indexOf('class="database-review"') < html.indexOf('class="prd-paper'));
});
test("stale UC source remains explicitly changeable only while editing", () => {
  for (const [editing, revision, saving, shown] of [[false, "new-prd-version", false, false], [true, "new-prd-version", false, true], [true, "old-prd-version", false, false], [true, null, false, false], [true, "new-prd-version", true, true]]) {
    const html = renderToStaticMarkup(createElement(UcWorkspace, { ...cases[1][3], session: { ...uc, editDraft: editing ? { ...uc.document.content } : null }, persistence: { ...persistence, saving }, acceptedPrdRevisionId: revision }));
    assert.match(html, /来源 PRD/);
    assert.equal(html.includes("明确改用当前已确认 PRD"), shown);
    if (shown) {
      assert.ok(html.indexOf("明确改用当前已确认 PRD") > html.indexOf('class="uc-source"'));
      assert.equal(/class="uc-source-update"[^>]*disabled/.test(html), saving);
    }
    assert.equal((html.match(/data-uc-field=/g) || []).length, 12);
    assert.match(html, /rowSpan="10"/i);
    assert.match(html, /rowSpan="5"/i);
  }
});

test("confirm guards and permission hints survive removal of static review text", () => {
  for (const [overrides, disabled] of [[{}, false], [{ selected: false }, true], [{ editing: true }, true], [{ status: "accepted" }, true], [{ persistence: { ...persistence, canAccept: false } }, true], [{ persistence: { ...persistence, saving: true } }, true]]) {
    const html = renderToStaticMarkup(createElement(DatabaseReview, { persistence, status: "pending", editing: false, selected: true, onSelect: noop, onAccept: noop, ...overrides }));
    const button = html.match(/<button class="button-primary"[^>]*>/)[0];
    assert.equal(button.includes("disabled"), disabled);
    assert.doesNotMatch(html, /<small>|保存不等于确认/);
    assert.match(html, /已审阅当前版本/);
    assert.match(html, /刷新数据/);
    if (overrides.persistence?.canAccept === false) assert.match(button, /当前账号无确认权限/);
  }
});

test("database detail sessions start without the removed technical notices", async () => {
  const { databaseWorkspaceWorks } = await loadTypescript("../src/features/workbench/database.ts");
  const revision = { revision_id: "r", revision_no: "1", status: "pending" };
  const result = databaseWorkspaceWorks({ project: { id: "p" }, functions: [{
    id: "f", code: "F", name: "功能", lock_version: "1", description: null,
    prd: { id: "prd", markdown_body: "正文", revision },
    use_cases: [{ ...uc.document.content, id: "uc", code: "UC-01", prd_revision_id: "r", main_flow: "主流程", revision }],
    functional_requirements: [{ id: "fr", code: "FR-01", description: "需求描述", sources: [], revision }],
    subsystems: [], fr_allocations: [],
  }], source: "database", read_only: false });
  const details = result.works.filter(work => ["PRD", "UC", "FR"].includes(work.kind));
  assert.equal(details.length, 3);
  for (const work of details) assert.equal(work.session.notice, "");
});

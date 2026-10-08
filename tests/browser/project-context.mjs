import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.PROJECT_CONTEXT_BASE || 'http://127.0.0.1:3142';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Local test only');
const baseline = process.env.EXPECT_CONTEXT_LOSS === '1';
const output = new URL('../../artifacts/project-context-20261002-r1/', import.meta.url);
await fs.mkdir(output, { recursive: true });
const oldId = '11111111-1111-4111-8111-111111111111';
const writes = [], errors = [], unexpected = [], checks = [];
const makeProject = (id, name) => ({ id, name, code: 'PRJ-' + id.replaceAll('-', '').toUpperCase(), description: null, lock_version: '0', can_update: true, can_delete: true, can_manage_access: true, created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' });
const projects = [makeProject(oldId, '列表首项旧项目')];
const functions = new Map([[oldId, []]]);
let inaccessible = false, lookupUnavailable = false, omitSelectedFromList = false;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url()), parts = url.pathname.split('/').filter(Boolean);
  if (url.origin !== new URL(base).origin) { unexpected.push('external:' + url.origin); return route.abort(); }
  if (!url.pathname.startsWith('/api/')) return route.continue();
  const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const method = request.method();
  if (url.pathname === '/api/v1/auth/me') return send({ id: 'fixture-engineer', username: 'fixture-engineer', department: 'QA', can_manage_accounts: false });
  if (url.pathname === '/api/v1/projects' && method === 'GET') return send({ items: omitSelectedFromList ? projects.slice(0, 1) : projects, limit: 20, offset: 0, has_more: omitSelectedFromList, capabilities: { can_create: true } });
  if (url.pathname === '/api/v1/projects' && method === 'POST') {
    const input = request.postDataJSON(), project = makeProject(input.creation_id, input.name); projects.push(project); functions.set(project.id, []); writes.push({ kind: 'project', project_id: project.id }); return send(project, 201);
  }
  if (parts[2] === 'projects' && parts[3]) {
    const id = parts[3], project = projects.find(p => p.id === id);
    if (!project || (inaccessible && id !== oldId)) return send({ detail: { code: 'project_not_found', message: '项目不存在或无权访问' } }, 404);
    if (lookupUnavailable && id !== oldId) return send({ detail: { code: 'projects_database_unavailable', message: '暂时无法读取项目' } }, 503);
    if (parts.length === 4 && method === 'GET') return send(project);
    if (parts[4] === 'workspace' && method === 'GET') return send({ project, functions: functions.get(id), source: 'database', read_only: false, can_create_function: true, capabilities: ['function.create', 'function.update', 'PRD.create', 'PRD.update', 'PRD.accept'] });
    if (parts[4] === 'functions' && parts.length === 5 && method === 'POST') {
      const input = request.postDataJSON();
      const feature = { id: input.creation_id, code: 'FUN-TEST', name: input.name, description: input.description, lock_version: '0', can_update: true, can_delete: true, prd: null, can_create_prd: true, can_create_uc: false, can_create_fr: false, accepted_use_cases: [], use_cases: [], functional_requirements: [], subsystems: [], fr_allocations: [] };
      functions.get(id).push(feature); writes.push({ kind: 'function', name: input.name, project_id: id });
      return send({ function_id: feature.id, artifact_id: null, revision_id: null, created: true }, 201);
    }
    if (parts[4] === 'functions' && parts[6] === 'artifacts' && method === 'POST') {
      const input = request.postDataJSON(), feature = functions.get(id).find(f => f.id === parts[5]); assert.ok(feature, 'Function must belong to request project');
      const revision = { revision_id: randomUUID(), revision_no: '1', status: 'pending', type_version_id: randomUUID(), created_via: 'manual', created_at: '2026-10-02T00:00:00Z', accepted_revision_id: null };
      feature.prd = { id: input.creation_id, code: 'PRD-TEST', lock_version: '0', can_delete: true, revision, markdown_body: '# ' + input.name, source: 'database' }; feature.can_create_prd = false;
      writes.push({ kind: 'PRD', project_id: id, function_id: feature.id });
      return send({ function_id: feature.id, artifact_id: feature.prd.id, revision_id: revision.revision_id, created: true }, 201);
    }
    if (parts[4] === 'artifacts' && ['revisions', 'accept'].includes(parts[6]) && method === 'POST') {
      const input = request.postDataJSON(), feature = functions.get(id).find(f => f.prd?.id === parts[5]); assert.ok(feature, 'PRD must belong to request project');
      if (parts[6] === 'revisions') { assert.equal(input.base_revision_id, feature.prd.revision.revision_id); feature.prd.markdown_body = input.content.markdown_body; feature.prd.revision = { ...feature.prd.revision, revision_id: randomUUID(), revision_no: '2', status: 'pending' }; }
      else { assert.equal(input.revision_id, feature.prd.revision.revision_id); feature.prd.revision.accepted_revision_id = input.revision_id; feature.prd.revision.status = 'accepted'; }
      writes.push({ kind: parts[6], project_id: id, function_id: feature.id, artifact_id: feature.prd.id });
      return send({ function_id: feature.id, artifact_id: feature.prd.id, revision_id: feature.prd.revision.revision_id, created: true });
    }
  }
  unexpected.push(method + ' ' + url.pathname); return send({ detail: 'Unexpected test request' }, 500);
});
const activePanel = () => page.locator('.object-panel:not([hidden])');
async function createFunction(name) {
  await page.waitForFunction(() => !document.body.textContent.includes('正在读取项目数据库数据…'));
  await page.getByRole('tab', { name: '工作台', exact: true }).click();
  await page.getByRole('button', { name: '手动新建功能', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '手动新建功能', exact: true });
  await dialog.getByLabel('功能名称', { exact: false }).fill(name);
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}
try {
  await page.goto(base, { timeout: 90000 });
  await page.locator('.project-picker').click();
  await page.getByRole('button', { name: '＋ 新增项目', exact: true }).click();
  await page.getByLabel('项目名称', { exact: false }).fill('新建隔离项目');
  await page.getByRole('button', { name: '创建并进入', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.project-picker')?.textContent.includes('新建隔离项目'));
  const selected = projects.at(-1).id;
  await createFunction('刷新前功能');
  assert.equal(writes.at(-1).project_id, selected); checks.push('创建项目后直接创建功能归属正确');
  await page.reload();
  await page.locator('.project-picker').waitFor();
  const afterReload = await page.locator('.project-picker').innerText();
  const expected = baseline ? oldId : selected;
  assert.ok(afterReload.includes(baseline ? '列表首项旧项目' : '新建隔离项目'), 'Reload must retain selected project');
  await createFunction('刷新后DVR');
  assert.equal(writes.at(-1).project_id, expected);
  await activePanel().getByRole('button', { name: '手动创建 PRD', exact: true }).click();
  const prdDialog = page.getByRole('dialog', { name: '手动新建 PRD', exact: true });
  await prdDialog.getByLabel('PRD 名称', { exact: false }).fill('DVR联调PRD');
  await prdDialog.getByRole('button', { name: '创建', exact: true }).click();
  await prdDialog.waitFor({ state: 'hidden' });
  await activePanel().getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('textbox', { name: '编辑 PRD 正文', exact: true }).fill(`# DVR联调PRD

车辆上电后开始录制，异常时提示用户。`);
  await activePanel().getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByRole('textbox', { name: '编辑 PRD 正文', exact: true }).waitFor({ state: 'hidden' });
  await activePanel().getByRole('checkbox').check();
  await activePanel().getByRole('button', { name: '确认', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.object-panel:not([hidden]) [aria-label="文档状态"]')?.textContent.includes('已确认'));
  assert.ok(writes.slice(2).every(row => row.project_id === expected));
  checks.push(baseline ? '已复现刷新后功能PRD保存确认全部落到列表首项旧项目' : '刷新后功能PRD保存确认全部保持新项目归属');
  await page.screenshot({ path: fileURLToPath(new URL(baseline ? 'before-refresh-context-loss.png' : 'after-correct-project-chain.png', output)), fullPage: true });
  if (!baseline) {
    omitSelectedFromList = true; await page.reload(); await page.locator('.project-picker').waitFor();
    assert.ok((await page.locator('.project-picker').innerText()).includes('新建隔离项目')); checks.push('选中项目不在列表第一页时按ID恢复');
    lookupUnavailable = true; await page.reload(); await page.getByRole('button', { name: '重新加载', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '手动新建功能', exact: true }).count(), 0); checks.push('恢复项目临时失败时禁止静默切换并禁止写入');
    lookupUnavailable = false; inaccessible = true; await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await page.getByRole('dialog', { name: '切换项目', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '手动新建功能', exact: true }).isDisabled(), true); checks.push('原项目无权访问时要求明确重选而非自动选择其他项目');
  }
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  const report = { mode: baseline ? 'baseline-reproduced' : 'fixed', checks, writes, errors, unexpected, noCompanyConnections: true };
  await fs.writeFile(new URL(baseline ? 'baseline.json' : 'verification.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) { console.log(JSON.stringify({ failedChecks: checks, writes, errors, unexpected })); await page.screenshot({ path: fileURLToPath(new URL('failure.png', output)), fullPage: true }); throw error; } finally { await browser.close(); }

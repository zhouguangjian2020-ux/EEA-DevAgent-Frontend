import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const live = process.env.EE_LIVE_WORKSPACE === 'true';
const base = process.env.EE_BASE_URL || 'http://127.0.0.1:3000';
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../artifacts/ui-status-composer-20260929', live ? 'live' : 'fixture');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const checks = [], errors = [], requests = [];
const check = text => { checks.push(text); console.log('PASS', text); };
let behavior = 'ok';
const text = '这是自动扩写浏览器回归测试的草稿，只回填输入框，不创建 PRD 或写入数据库。';
const fixtureProject = { id: 'readonly-project', code: 'UI-TEST', name: '测试项目1', description: null, lock_version: '1', created_at: '2026-09-22T00:00:00Z', updated_at: '2026-09-22T00:00:00Z' };
const emptyProject = { ...fixtureProject, id: 'empty-project', name: '空项目测试' };
const workspace = { project: fixtureProject, read_only: true, source: 'database', functions: [{ id: 'dvr', code: 'DVR', name: '行车记录仪DVR', description: null, prd: null, use_cases: [], functional_requirements: [], subsystems: [], fr_allocations: [] }] };
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
page.on('request', request => {
  const url = new URL(request.url());
  if (url.pathname.startsWith('/api/') && request.method() !== 'GET') {
    assert.equal(request.headers()['x-api-key'], undefined);
    requests.push({ path: url.pathname, method: request.method(), body: request.postDataJSON() });
  }
});
if (!live) await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  const fulfill = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (url.pathname === '/api/v1/auth/me') return fulfill({ id: 'test', username: 'UI回归', department: 'QA', avatar_url: null });
  if (url.pathname === '/api/v1/projects') return fulfill({ items: [fixtureProject, emptyProject], limit: 100, offset: 0, has_more: false, capabilities: { can_create: false } });
  if (url.pathname === '/api/v1/projects/readonly-project/workspace') return fulfill(workspace);
  if (url.pathname === '/api/v1/projects/empty-project/workspace') return fulfill({ ...workspace, project: emptyProject, functions: [] });
  if (url.pathname === '/api/v1/agent/prd/expand/stream') {
    const current = behavior;
    if (current === 'delay') await new Promise(resolve => setTimeout(resolve, 1200));
    if (current === 'error') return fulfill({ detail: { message: 'Agent 暂时不可用' } }, 502);
    const events = [`data: ${JSON.stringify({ type: 'token', content: text })}`, `data: ${JSON.stringify({ type: 'done', scene: 'PROMPT_EXPAND', output: text, request_id: 'ui-fixture', trace_id: null })}`].join('\n\n') + '\n\n';
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' }, body: Buffer.from(events, 'utf8') });
  }
  throw new Error('Unexpected API: ' + url.pathname);
});
const chat = () => page.locator('.project-conversation:not([hidden])');
const input = () => chat().getByRole('textbox', { name: '项目对话输入', exact: true });
const shortcut = mode => chat().getByLabel('快捷生成').getByRole('button', { name: new RegExp(mode) });
const expand = () => chat().getByRole('button', { name: '自动扩写', exact: true });
const settled = () => chat().locator('.conversation-loading').waitFor({ state: 'hidden', timeout: 145000 });
async function switchProject(name) {
  await page.locator('.project-picker').click();
  await page.locator('.project-option').filter({ hasText: name }).click();
  await page.getByRole('button', { name: '确认切换', exact: true }).click();
  await input().waitFor();
}
let before, target, responseInfo;
try {
  if (live) {
    assert.ok(process.env.EE_LOGIN_USERNAME && process.env.EE_LOGIN_PASSWORD, 'Inject login credentials; never save them in test output');
    const login = await context.request.post(base + '/api/v1/auth/login', { data: { username: process.env.EE_LOGIN_USERNAME, password: process.env.EE_LOGIN_PASSWORD } });
    assert.equal(login.status(), 200, 'live login');
    const projects = await context.request.get(base + '/api/v1/projects?limit=100&offset=0');
    assert.equal(projects.status(), 200);
    target = (await projects.json()).items.find(project => project.name === '测试项目1');
    assert.ok(target, '测试项目1 exists');
    const initial = await context.request.get(base + `/api/v1/projects/${target.id}/workspace`);
    assert.equal(initial.status(), 200);
    before = await initial.json();
  }
  await page.goto(base, { waitUntil: 'networkidle' });
  await input().waitFor();
  if (live && !(await page.locator('.project-picker').innerText()).includes(target.name)) await switchProject(target.name);
  const tabCount = await page.getByRole('tablist', { name: '对象标签', exact: true }).getByRole('tab').count();
  assert.equal(await expand().isVisible(), true);
  assert.equal(await expand().isDisabled(), true);
  await shortcut('PRD生成').click();
  assert.equal(await shortcut('PRD生成').getAttribute('aria-pressed'), 'true');
  assert.equal(await shortcut('用例生成').count(), 0);
  assert.equal(await expand().isVisible(), true);
  assert.equal(await expand().isDisabled(), true);
  assert.equal(await chat().getByRole('combobox', { name: '业务功能', exact: true }).count(), 0);
  check('automatic expansion stays visible before and after selecting PRD mode');
  await input().fill('帮我写AEB的功能定义');
  assert.equal(await expand().isEnabled(), true);
  assert.equal(await chat().getByRole('button', { name: '发送提示词', exact: true }).isDisabled(), true);
  await input().press('Control+Enter');
  assert.equal(requests.length, 0);
  assert.equal(await chat().locator('.conversation-message').count(), 0);
  check('send and keyboard submit remain blocked without disabling draft expansion');
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/agent/prd/expand/stream', { timeout: 145000 });
  await expand().click();
  const response = await responsePromise;
  const stream = await response.text();
  assert.equal(response.status(), 200, stream);
  assert.match(stream, /PROMPT_EXPAND/);
  assert.match(stream, new RegExp(text));
  const body = { text, response_mode: 'stream', trace_id: null };
  await settled();
  assert.equal(await input().inputValue(), body.text);
  assert.equal(await page.getByRole('tablist', { name: '对象标签', exact: true }).getByRole('tab').count(), tabCount);
  assert.equal(await chat().locator('.conversation-message').count(), 0);
  responseInfo = { status: response.status(), response_mode: body.response_mode, text_characters: body.text.length, has_trace_id: Boolean(body.trace_id) };
  await page.screenshot({ path: path.join(output, 'prd-expansion.png'), fullPage: true });
  check('expansion response fills draft exactly, without a new object tab or generated message');
  await shortcut('PRD生成').click();
  assert.equal(await shortcut('用例生成').isVisible(), true);
  await shortcut('用例生成').click();
  assert.equal(await shortcut('用例生成').getAttribute('aria-pressed'), 'true');
  const ucShortcutBox = await shortcut('用例生成').boundingBox();
  const featureSelector = chat().getByRole('combobox', { name: '业务功能', exact: true });
  const featureSelectorBox = await featureSelector.boundingBox();
  assert.ok(featureSelectorBox.x >= ucShortcutBox.x + ucShortcutBox.width - 1, 'business-feature selector should be to the right of the selected UC shortcut');
  assert.ok(Math.abs(featureSelectorBox.y - ucShortcutBox.y) < 8, 'business-feature selector should share the shortcut row');
  assert.equal(await expand().isVisible(), true);
  assert.equal(await expand().isEnabled(), true);
  const options = await chat().getByRole('combobox', { name: '业务功能', exact: true }).locator('option').allTextContents();
  assert.ok(options.some(option => option.includes('行车记录仪DVR')));
  assert.ok(!options.some(option => /测试功能 [ABC]/.test(option)));
  assert.equal(options.length, (live ? before.functions.length : 1) + 1);
  assert.equal(await chat().getByRole('button', { name: '发送提示词', exact: true }).isDisabled(), true);
  await page.screenshot({ path: path.join(output, 'uc-shortcut.png'), fullPage: true });
  check('UC shortcut shows only project features and retains input-only expansion without selecting a feature');
  if (!live) {
    await shortcut('用例生成').click();
    await shortcut('PRD生成').click();
    behavior = 'error';
    await input().fill('失败时原始输入');
    await expand().click();
    await chat().getByRole('alert').waitFor();
    await settled();
    assert.equal(await input().inputValue(), '失败时原始输入');
    await input().fill('新的草稿');
    behavior = 'ok';
    await chat().getByRole('button', { name: '重试本次请求', exact: true }).click();
    await settled();
    assert.equal(requests.at(-1).body.feature_name, '失败时原始输入');
    assert.equal(await input().inputValue(), text);
    check('failed expansion preserves input and retry reuses the original snapshot');
    behavior = 'delay';
    await input().fill('停止后保留');
    await expand().click();
    await chat().getByRole('button', { name: '停止', exact: true }).click();
    await page.waitForTimeout(1500);
    assert.equal(await input().inputValue(), '停止后保留');
    check('stop ignores late expansion output');
    await expand().click();
    await switchProject(emptyProject.name);
    await input().fill('空项目独立草稿');
    await page.waitForTimeout(1500);
    assert.equal(await input().inputValue(), '空项目独立草稿');
    await shortcut('用例生成').click();
    assert.equal(await chat().getByRole('combobox', { name: '业务功能', exact: true }).locator('option').count(), 1);
    await switchProject(fixtureProject.name);
    await settled();
    assert.equal(await input().inputValue(), text);
    check('background expansion remains in original project; empty project has no invented features');
  } else {
    const after = await context.request.get(base + `/api/v1/projects/${target.id}/workspace`);
    assert.equal(after.status(), 200);
    assert.deepEqual(await after.json(), before);
    check('real database workspace identical before/after expansion');
  }
  assert.ok(requests.every(request => request.path === '/api/v1/agent/prd/expand/stream' && request.method === 'POST'));
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, live, checks, errors, response: responseInfo, expansion_requests: requests.length }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: false, live, checks, errors, error: String(error) }, null, 2));
  throw error;
} finally {
  if (live) await context.request.post(base + '/api/v1/auth/logout').catch(() => {});
  await browser.close();
}

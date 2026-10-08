import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.EE_BASE_URL;
assert.equal(base, 'http://127.0.0.1:3107', 'isolated local server only');
const output = process.env.EE_MANUAL_OUTPUT;
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_BROWSER_PATH });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage(); page.setDefaultTimeout(20000);
const errors = [], checks = [];
page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
const check = name => { checks.push(name); console.log('PASS', name); };
const headers = { Origin: base, 'X-Project-Request': '1' };
const panel = () => page.locator('.object-panel:not([hidden])');
const dialog = () => page.getByRole('dialog');
async function workspace() { const r = await context.request.get(base + '/api/v1/projects/' + project.id + '/workspace'); assert.equal(r.status(), 200); return r.json(); }
async function submit() { await dialog().getByRole('button', { name: '创建', exact: true }).click(); await dialog().waitFor({ state: 'hidden' }); }
async function module(name) {
  const back = page.getByRole('button', { name: '返回全部功能', exact: false });
  if (await back.isVisible()) await back.click();
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('tab', { name: '工作空间', exact: true }).click();
}
async function overview(kind) { await module('需求工程'); await page.getByRole('button', { name: '打开 AEB浏览器 ' + kind + '全景视图', exact: true }).click(); }
async function accept() { await panel().getByRole('checkbox', { name: '已审阅当前版本' }).check(); await panel().getByRole('button', { name: '确认' }).click(); }
async function saved() { await panel().getByRole('button', { name: '保存草稿', exact: true }).click(); await panel().getByRole('button', { name: '取消编辑', exact: true }).or(panel().getByRole('button', { name: '取消', exact: true })).waitFor({ state: 'hidden' }); }
let project;
try {
  const login = await context.request.post(base + '/api/v1/auth/login', { data: { username: 'engineer01', password: 'change-me-before-demo' } }); assert.equal(login.status(), 200);
  for (const url of ['/api/health', '/api/docs', '/api/redoc', '/api/v1/auth/me']) assert.equal((await context.request.get(base + url)).status(), 200);
  const created = await context.request.post(base + '/api/v1/projects', { headers, data: { creation_id: randomUUID(), name: '000 手动流程浏览器验收', description: '' } }); assert.equal(created.status(), 201); project = await created.json();
  await page.goto(base); await page.locator('.project-picker').waitFor();
  if (!(await page.locator('.project-picker').innerText()).includes(project.name)) {
    await page.locator('.project-picker').click(); await page.locator('.project-option').filter({ hasText: project.name }).click(); await page.getByRole('button', { name: '确认切换', exact: true }).click();
  }
  await page.getByRole('tab', { name: '工作台', exact: false }).click();
  await page.getByRole('button', { name: '手动新建功能', exact: true }).click();
  await dialog().getByLabel('功能名称', { exact: false }).fill('   '); await dialog().getByRole('button', { name: '创建', exact: true }).click(); assert.ok((await dialog().innerText()).includes('不能仅包含空格'));
  await dialog().getByLabel('功能名称', { exact: false }).fill('AEB浏览器'); await dialog().getByLabel('功能描述', { exact: false }).fill('独立创建的空白功能'); await submit();
  await panel().getByRole('heading', { name: '功能全景视图' }).waitFor();
  const initial = (await workspace()).functions[0]; assert.equal(initial.prd, null); assert.deepEqual(initial.use_cases, []); assert.deepEqual(initial.functional_requirements, []); assert.deepEqual(initial.fr_allocations, []);
  check('手动功能创建、必填校验、空目录、自动打开全景');
  for (const name of ['产品工程','需求工程','架构设计','开发工程','测试工程','安全工程']) {
    await module(name); const root = page.getByRole('button', { name: '打开 AEB浏览器 功能全景视图', exact: true }); await root.click();
    assert.ok((await page.locator('.module-sidebar-header').innerText()).includes(name));
    assert.equal(await page.locator('.object-tab-wrap').count(), 1);
    assert.ok((await panel().innerText()).includes('独立创建的空白功能'));
  }
  await module('需求工程');
  const root = page.locator('[data-folder-level="function"]').first(), arrow = root.locator('> .tree-folder > .folder-drop');
  assert.equal(await arrow.getAttribute('aria-expanded'), 'true'); await arrow.click(); assert.equal(await arrow.getAttribute('aria-expanded'), 'false');
  await root.locator('> .tree-folder > .folder-open').click(); assert.equal(await arrow.getAttribute('aria-expanded'), 'false'); await arrow.click();
  assert.equal(await root.locator('[data-folder-level="category"]').count(), 3);
  assert.ok((await panel().locator('.feature-details').boundingBox()).y < 600); await page.screenshot({ path: path.join(output, '01-feature-light.png') }); check('六个模块共享同一标签；名称打开，右侧箭头独立展开');
  await overview('UC'); assert.equal(await panel().getByRole('button', { name: '手动新建 UC' }).isDisabled(), true);
  await page.getByRole('button', { name: '打开 AEB浏览器 功能全景视图', exact: true }).click();
  await panel().getByRole('button', { name: '手动创建 PRD' }).click(); await dialog().getByLabel('PRD 名称', { exact: false }).fill('AEB需求说明'); await submit();
  await panel().getByRole('heading', { name: 'AEB需求说明' }).waitFor();
  await panel().getByRole('button', { name: '编辑', exact: true }).click();
  await panel().getByLabel('编辑 PRD 正文').fill('# AEB需求说明\n\n## 功能范围\n\n- 识别风险\n- 触发制动\n\n| 字段 | 内容 |\n| --- | --- |\n| 状态 | 草稿 |\n\n<script>window.markdownUnsafe=1</script>\n\n[不安全链接](javascript:alert(1))');
  await panel().getByRole('checkbox', { name: '显示 Markdown 实时预览' }).check(); assert.equal(await panel().locator('.prd-markdown table').count(), 1); await saved();
  assert.equal(await page.evaluate(() => window.markdownUnsafe), undefined); assert.equal(await panel().locator('a[href^="javascript:"]').count(), 0);
  await accept(); await panel().getByText('当前版本已确认，可作为下游来源。', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, '02-prd-markdown.png') }); check('PRD 创建、Markdown 表格与实时预览、安全渲染、真实保存与确认');
  await module('产品工程'); await page.getByRole('button', { name: '打开 AEB浏览器 功能全景视图', exact: true }).click(); assert.equal(await panel().getByRole('button', { name: '手动创建 PRD' }).isDisabled(), true);
  await overview('UC'); await panel().getByRole('button', { name: '手动新建 UC' }).click(); await dialog().getByLabel('UC 名称', { exact: false }).fill('识别碰撞风险'); await page.screenshot({ path: path.join(output, '03-uc-create.png') }); await submit();
  await panel().getByRole('table', { name: 'UC 用例详情（表7）' }).waitFor(); await accept(); await panel().getByText('确认 UC 前需要补充名称、描述和主事件流。', { exact: true }).waitFor();
  await panel().getByRole('button', { name: '编辑', exact: true }).click(); await panel().getByLabel('编辑用例描述', { exact: true }).fill('车辆识别前方风险'); await panel().getByLabel('编辑主事件流', { exact: true }).fill('系统识别障碍物并判断制动条件'); await saved(); await accept(); await panel().getByText('当前版本已确认，可作为下游来源。', { exact: true }).waitFor();
  const uc = (await workspace()).functions[0].use_cases[0]; assert.equal(uc.revision.status, 'accepted'); assert.equal(uc.revision.revision_no, '2');
  await page.screenshot({ path: path.join(output, '04-uc-accepted.png') }); check('UC 名称最小创建、12字段保留、补齐校验、修订保存与确认');
  await overview('FR'); await panel().getByRole('button', { name: '手动新建 FR' }).click(); await dialog().getByLabel('需求描述', { exact: false }).fill('系统应提供风险制动请求'); await submit(); await panel().getByText('系统应提供风险制动请求', { exact: true }).waitFor();
  await accept(); await panel().getByText('确认 FR 前请至少选择一个已确认的 UC 来源。', { exact: true }).waitFor();
  await panel().getByRole('button', { name: '编辑', exact: true }).click(); await panel().getByRole('checkbox', { name: new RegExp(uc.code) }).check(); await panel().getByLabel('验收标准', { exact: true }).fill('验证制动请求可被接收'); await saved(); await accept(); await panel().getByText('当前版本已确认，可作为下游来源。', { exact: true }).waitFor();
  const fr = (await workspace()).functions[0].functional_requirements[0]; assert.equal(fr.revision.status, 'accepted'); assert.equal(fr.sources[0].uc_revision_id, uc.revision.revision_id); assert.equal(fr.acceptance_criteria, '验证制动请求可被接收');
  await page.evaluate(() => { localStorage.setItem('ts-theme','dark'); window.dispatchEvent(new Event('ee-theme-change')); }); await page.screenshot({ path: path.join(output,'05-fr-dark.png') });
  check('FR 无来源草稿、受控来源选择、验收标准、保存确认和深色主题');
  await panel().getByRole('button', { name: '编辑', exact: true }).click(); await panel().getByLabel('需求描述', { exact: true }).fill('已确认 FR 的新草稿');
  await page.locator('.object-tab-wrap.active .tab-close').click(); await dialog().getByRole('heading', { name: '关闭前保存修改？' }).waitFor();
  let failOnce = true;
  await page.route('**/artifacts/*/revisions', async route => {
    if (failOnce) { failOnce = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: { message: '隔离验收：写入失败' } }) }); }
    return route.continue();
  });
  await dialog().getByRole('button', { name: '保存并关闭', exact: true }).click(); await dialog().getByText(/隔离验收：写入失败/).waitFor(); assert.ok(await panel().getByLabel('需求描述', { exact: true }).inputValue() === '已确认 FR 的新草稿');
  await dialog().getByRole('button', { name: '保存并关闭', exact: true }).click(); await dialog().waitFor({ state:'hidden' }); await page.unroute('**/artifacts/*/revisions');
  const revised = (await workspace()).functions[0].functional_requirements[0]; assert.equal(revised.description, '已确认 FR 的新草稿'); assert.equal(revised.revision.status, 'pending'); assert.equal(revised.revision.accepted_revision_id, fr.revision.revision_id);
  check('已确认历史不被覆盖；保存并关闭失败保留草稿，重试成功后才关闭');
  await page.reload(); await page.locator('.project-picker').waitFor();
  assert.ok((await page.locator('.project-picker').innerText()).includes(project.name), '刷新必须恢复原项目，不允许测试脚本自动重选来掩盖错项目');
  assert.equal(new URL(page.url()).searchParams.get('project_id'), project.id);
  await panel().waitFor(); assert.equal((await workspace()).functions[0].functional_requirements[0].description, '已确认 FR 的新草稿');
  await overview('FR'); await panel().getByRole('button', { name: fr.code, exact:true }).click(); await panel().getByText('已确认 FR 的新草稿', { exact:true }).waitFor();
  assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  check('刷新后真实持久化；1440×900无横向溢出，无浏览器脚本错误');
  assert.equal((await context.request.post(base + '/api/v1/auth/logout')).status(), 204);
  check('health/docs/redoc/login/me/logout 冒烟通过');
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({status:'PASS',checks,errors},null,2));
} catch(error) { await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{}); await fs.writeFile(path.join(output,'failure.txt'), String(error) + '\n' + await page.locator('body').innerText()); throw error; }
finally { await browser.close(); }

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTypescript } from './load-typescript.mjs';
import { loadComponent } from './load-component.mjs';
const { PrdCreationSession, canNavigateCreationResult, canResetCreation, canChooseCreation, canRetryCreation } = await loadTypescript('../src/features/prd/creation.ts');
const { prdCreationApi } = await loadTypescript('../src/features/prd/creation-api.ts');
const { ApiError } = await loadTypescript('../src/lib/api/client.ts');
const { PrdCreationInline } = loadComponent('../src/components/workbench/prd-creation-inline.tsx');
const review = { status: 'ready_to_create', definition: { name: '自动录像', description: '车辆上电开始录像', description_source: 'agent_output' }, candidates: [], candidate_count: 0, can_create_new_function: true, exact_name_conflict: false, has_more: false, phase: 'plan_review' };
function setup(overrides = {}, result = async () => '已打开') {
  const calls = []; let input;
  const receipt = (extra = {}) => ({ id: 'intent', project_id: 'p', client_request_id: input.client_request_id, version: 2, status: 'planned', next_phase: 'choose', review, function_id: null, artifact_id: null, revision_id: null, error_code: null, saved_as: null, ...extra });
  const api = {
    create: async (p, i, s) => { calls.push(['create', p, i]); input = i; return overrides.create ? overrides.create(receipt, s) : receipt(); },
    read: async (p, i, intent, s) => { calls.push(['read', p, i, intent]); return overrides.read ? overrides.read(receipt, s) : receipt(); },
    execute: async (p, intent, choice, s) => { calls.push(['execute', p, intent, choice]); return overrides.execute ? overrides.execute(receipt, choice, s) : receipt({ status: 'saved', next_phase: 'open', function_id: 'f', artifact_id: 'a', revision_id: 'r', saved_as: 'pending' }); },
  };
  const session = new PrdCreationSession('p', result, api); session.setPrompt('创建录像需求');
  return { session, calls, receipt };
}
const candidate = { function_id: 'f', name: '自动录像', description: '已保存描述', match: 'exact_name', prd_artifact_id: null, can_reuse_for_prd: true, blocked_reason: null };
const selection = r => r({ review: { ...review, status: 'needs_selection', candidates: [candidate], candidate_count: 1, exact_name_conflict: true } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('one submit chains plan then auto; duplicate clicks never duplicate intent', async () => {
  const { session, calls } = setup(); await Promise.all([session.submit(), session.submit()]);
  assert.deepEqual(calls.map(c => c[0]), ['create', 'execute']); assert.deepEqual(calls[1][3], { action: 'auto' });
  assert.equal(session.snapshot().intent.saved_as, 'pending'); assert.equal(session.snapshot().busy, false);
  assert.match(calls[0][2].client_request_id, /^[a-f0-9-]{36}$/); await session.submit(); assert.equal(calls.length, 2);
});
test('candidates wait; cancellation/reset makes no business execute; explicit renamed create only', async () => {
  const { session, calls } = setup({ create: selection }); await session.submit();
  assert.equal(calls.length, 1); assert.ok(canChooseCreation(session.snapshot()));
  session.reset(); assert.equal(session.snapshot().intent, null); assert.equal(calls.length, 1);
  session.setPrompt('另一项'); await session.submit(); await session.choose({ action: 'create', name: '事件录像' });
  assert.deepEqual(calls.at(-1)[3], { action: 'create', name: '事件录像' });
});
test('reuse sends only chosen function, not plan, name or description', async () => {
  const { session, calls } = setup({ create: selection }); await session.submit(); await session.choose({ action: 'reuse', function_id: 'f' });
  assert.deepEqual(calls.at(-1)[3], { action: 'reuse', function_id: 'f' });
});
test('concurrent candidate from auto response pauses rather than retrying auto', async () => {
  const { session, calls } = setup({ execute: selection }); await session.submit();
  assert.equal(calls.length, 2); assert.ok(canChooseCreation(session.snapshot()));
});
test('lost create response performs read only and never implicitly starts PRD', async () => {
  const { session, calls } = setup({ create: () => { throw new TypeError('network'); } }); await session.submit();
  assert.deepEqual(calls.map(c => c[0]), ['create', 'read']); assert.equal(session.snapshot().intent.status, 'planned');
});
test('lost execution response recovers saved receipt without a second execute', async () => {
  const { session, calls } = setup({ execute: () => { throw new TypeError('lost'); }, read: r => r({ status: 'saved', function_id: 'f', artifact_id: 'a' }) });
  await session.submit(); assert.deepEqual(calls.map(c => c[0]), ['create', 'execute', 'read']); assert.equal(session.snapshot().intent.status, 'saved');
});
test('missing initial receipt resends exact original input and ID only on explicit action', async () => {
  let count = 0;
  const { session, calls } = setup({ create: r => { if (++count === 1) throw new Error('lost'); return r(); }, read: () => { throw new ApiError('not found', 404); } });
  await session.submit(); assert.ok(session.snapshot().notFound); assert.equal(calls.length, 2); await session.resend();
  assert.deepEqual(calls[0][2], calls[2][2]); assert.equal(session.snapshot().intent.status, 'saved');
});
test('failed PRD keeps bound function and continue; cannot select a different function or reset', async () => {
  let count = 0;
  const { session, calls } = setup({ execute: r => r(++count === 1 ? { status: 'failed', function_id: 'f', error_code: 'agent_failed' } : { status: 'saved', function_id: 'f', artifact_id: 'a' }) });
  await session.submit(); assert.ok(canRetryCreation(session.snapshot())); assert.equal(canResetCreation(session.snapshot()), false);
  await session.choose({ action: 'reuse', function_id: 'other' }); assert.equal(calls.length, 2);
  await session.retry(); assert.deepEqual(calls.at(-1)[3], { action: 'continue' }); assert.equal(session.snapshot().intent.function_id, 'f');
});
test('plan failure retries original intent and automatically advances only when ready', async () => {
  let count = 0; const { session, calls } = setup({ create: r => r({ status: 'failed', review: null }), execute: r => ++count === 1 ? r() : r({ status: 'saved', artifact_id: 'a' }) });
  await session.submit(); await session.retry(); assert.deepEqual(calls.filter(c => c[0] === 'execute').map(c => c[3]), [{ action: 'continue' }, { action: 'auto' }]);
});
test('stop ignores late non-abortable response; GET recovery never generates', async () => {
  const d = deferred(); const { session, calls } = setup({ create: async r => { await d.promise; return r(); } });
  const pending = session.submit(); session.stop(); d.resolve(); await pending;
  assert.equal(session.snapshot().intent, null); assert.ok(session.snapshot().uncertain); assert.equal(canResetCreation(session.snapshot()), false);
  await session.refresh(); assert.deepEqual(calls.map(c => c[0]), ['create', 'read']); assert.equal(session.snapshot().intent.status, 'planned');
});
test('saved receipt remains successful when workspace read fails; opening retries read, not Agent', async () => {
  let results = 0; const { session, calls } = setup({}, async () => { if (!results++) throw new Error('workspace unavailable'); return 'opened'; });
  await session.submit(); assert.equal(session.snapshot().intent.status, 'saved'); assert.match(session.snapshot().notice, /已保存.*刷新失败/); assert.equal(session.snapshot().uncertain, false);
  await session.open(); assert.equal(session.snapshot().notice, 'opened'); assert.equal(calls.length, 2);
});
test('blocked existing PRD is open-only; explicit open does not create or execute', async () => {
  const opened = []; const { session, calls } = setup({ create: r => r({ status: 'blocked', artifact_id: 'existing', function_id: 'f' }) }, async (r, auto) => { opened.push([r.artifact_id, auto]); return 'opened'; });
  await session.submit(); assert.equal(opened.length, 0); await session.open(); assert.deepEqual(opened, [['existing', false]]); assert.equal(calls.length, 1);
});
test('foreign receipt is never accepted or navigated', async () => {
  const { session, calls } = setup({ create: r => r({ project_id: 'foreign' }), read: () => { throw new ApiError('forbidden', 403); } }, async () => { assert.fail('foreign navigation'); });
  await session.submit(); assert.equal(session.snapshot().intent, null); assert.equal(calls.filter(c => c[0] === 'execute').length, 0);
});
test('active receipt has no retry/reset and refresh remains a GET', async () => {
  const { session, calls } = setup({ create: r => r({ status: 'generating', function_id: 'f' }) }); await session.submit();
  assert.equal(canResetCreation(session.snapshot()), false); assert.equal(canRetryCreation(session.snapshot()), false); await session.refresh(); assert.equal(calls.at(-1)[0], 'read');
});
test('invalid prompt is rejected before any request; session projects are independent', async () => {
  const a = setup(), b = setup(); a.session.setPrompt('a'.repeat(4001)); await a.session.submit(); assert.equal(a.calls.length, 0);
  await b.session.submit(); assert.equal(b.session.snapshot().intent.status, 'saved'); assert.equal(a.session.snapshot().intent, null);
});
test('candidate UI shows reason, existing PRD and permission; no operation selector or chat ID', async () => {
  const { session } = setup({ create: r => r({ review: { ...review, status: 'needs_selection', candidate_count: 2, candidates: [{ ...candidate, prd_artifact_id: 'old', can_reuse_for_prd: false }, { ...candidate, function_id: 'no', name: '受限功能', can_reuse_for_prd: false }] } }) });
  await session.submit(); const html = renderToStaticMarkup(createElement(PrdCreationInline, { session, onExit() {} }));
  for (const text of ['打开已有PRD', '名称相同', '无该功能的PRD创建权限', '仍新建并生成PRD']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /role="dialog"|<select|thread_id|操作<|<option/);
});
test('API protocol uses cookie, write guard, current version and no-store GET', async t => {
  const requests = []; t.mock.method(globalThis, 'fetch', async (url, init) => { requests.push([url, init]); return Response.json({}); });
  const ac = new AbortController(), input = { client_request_id: 'request', message: 'need' }, intent = { id: 'intent', version: 7 };
  await prdCreationApi.create('p', input, ac.signal); await prdCreationApi.execute('p', intent, { action: 'reuse', function_id: 'f' }, ac.signal);
  await prdCreationApi.read('p', input, intent, ac.signal); await prdCreationApi.read('p', input, null, ac.signal);
  assert.deepEqual(JSON.parse(requests[1][1].body), { expected_version: 7, action: 'reuse', function_id: 'f' });
  assert.equal(requests[0][1].headers['X-Project-Request'], '1'); assert.equal(requests[0][1].credentials, 'include');
  assert.equal(requests[2][1].cache, 'no-store'); assert.ok(requests[3][0].endsWith('?client_request_id=request'));
  assert.equal(requests[2][1].body, undefined);
});

test('expired old wait timer cannot abort a later readonly recovery', async t => {
  const timers=[];t.mock.method(globalThis,'setTimeout',callback=>{timers.push(callback);return timers.length;});t.mock.method(globalThis,'clearTimeout',()=>{});
  const first=deferred(), read=deferred();
  const {session}=setup({create:async r=>{await first.promise;return r();},read:async r=>{await read.promise;return r();}});
  const submission=session.submit();session.stop();const recovery=session.refresh();timers[0]();
  assert.equal(session.snapshot().busy,true);assert.equal(session.snapshot().phase,'read');
  first.resolve();read.resolve();await Promise.all([submission,recovery]);assert.equal(session.snapshot().intent.status,'planned');
});

test('navigation guard keeps automatic result in originating visible project and unchanged conversation', () => {
  const origin={project:'p',thread:'t',epoch:1};
  assert.equal(canNavigateCreationResult('p',origin,'p',origin,true,false),true);
  assert.equal(canNavigateCreationResult('p',{...origin,project:'other'},'p',origin,true,false),false);
  assert.equal(canNavigateCreationResult('p',{...origin,thread:'other'},'p',origin,true,false),false);
  assert.equal(canNavigateCreationResult('p',{...origin,epoch:2},'p',origin,true,false),false);
  assert.equal(canNavigateCreationResult('p',origin,null,origin,true,false),false);
  assert.equal(canNavigateCreationResult('p',origin,'p',origin,true,true),false);
  assert.equal(canNavigateCreationResult('p',{...origin,thread:'new',epoch:2},'p',origin,false,false),true);
});

test('thread transitions lock the composer until the selected draft is ready', async () => {
  const { readFile }=await import('node:fs/promises');
  const source=await readFile(new URL('../src/components/workbench/live-project-conversation.tsx',import.meta.url),'utf8');
  assert.match(source,/disabledReason=\{loading \?/);
  const { ChatComposer }=loadComponent('../src/components/workspace/chat-composer.tsx');
  const html=renderToStaticMarkup(createElement(ChatComposer,{value:'existing draft',onChange(){},onSend(){},disabledReason:'正在切换会话，请稍候…'}));
  assert.match(html,/<textarea[^>]*disabled/);assert.match(html,/<button[^>]*disabled/);assert.ok(html.includes('existing draft'));
});

test('inline candidate name survives component remount and receipt updates, but resets for a new intent', async () => {
  const { session } = setup({ create: selection, read: selection });
  await session.submit();session.setCandidateName('后窗除霜');
  const render=()=>renderToStaticMarkup(createElement(PrdCreationInline,{session}));
  assert.match(render(),/value="后窗除霜"/);
  await session.refresh();assert.match(render(),/value="后窗除霜"/);
  session.reset();assert.equal(session.snapshot().candidateName,null);
});

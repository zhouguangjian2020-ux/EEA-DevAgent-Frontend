import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescript } from './load-typescript.mjs';
const { taskLabel, conversationTimeline, readTaskRecords } = await loadTypescript('../src/features/workbench/task-records.ts');
const { PrdCreationSession } = await loadTypescript('../src/features/prd/creation.ts');
const record = (patch = {}) => ({ id: 'task', task_kind: 'UC', status: 'succeeded', stage: 'completed', result_count: 3, result_refs: [], result_available: false, created_at: '2026-10-07T12:00:00Z', updated_at: '2026-10-07T12:01:00Z', ...patch });
test('saved counts are distinct from preview, empty, failed and uncertain statuses', () => {
  assert.equal(taskLabel(record()), '已新增 3 条待确认UC');
  assert.match(taskLabel(record({ task_kind: 'FR_ALLOCATION', status: 'preview' })), /3.*尚未保存或确认/);
  assert.match(taskLabel(record({ task_kind: 'PRD', status: 'preview' })), /尚未保存/);
  assert.doesNotMatch(taskLabel(record({ status: 'failed' })), /已新增/);
  assert.match(taskLabel(record({ status: 'needs_verification' })), /待核实/);
  assert.match(taskLabel(record({ task_kind: 'UC_DIAGRAM', status: 'preview', unchanged: true })), /未变化/);
  assert.match(taskLabel(record({ task_kind: 'UC_DIAGRAM', status: 'empty' })), /未调用Agent/);
  assert.doesNotMatch(taskLabel(record({ result_count: null })), /null|3 条/);
});
test('system cards interleave by creation instant, not completion time or timezone spelling', () => {
  const turns = [{ client_request_id: 't1', created_at: '2026-10-07T19:59:00+08:00' }, { client_request_id: 't2', created_at: '2026-10-07T20:01:00+08:00' }];
  const task = record();
  const entries = conversationTimeline(turns, [task]);
  assert.deepEqual(entries.map(e => e.key), ['turn-t1', 'task-task', 'turn-t2']);
  assert.equal(entries[1].task, task); assert.equal(entries[1].turn, undefined);
  assert.deepEqual(conversationTimeline(turns, [record({ updated_at: '2026-10-08T00:00:00Z' })]).map(e => e.key), entries.map(e => e.key));
});
test('task history loads all bounded pages from the selected thread with cookies', async t => {
  const paths = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    paths.push(url); assert.equal(init.credentials, 'include');
    assert.equal(init.cache, 'no-store');
    return new Response(JSON.stringify({ tasks: [record({ id: String(paths.length) })], next_offset: paths.length === 1 ? 50 : null }), { headers: { 'Content-Type': 'application/json' } });
  });
  assert.equal((await readTaskRecords('p', 'original-thread', new AbortController().signal)).length, 2);
  assert.ok(paths.every(url => url.includes('/conversations/original-thread/tasks')));
  assert.match(paths[1], /offset=50$/);
});
test('invalid pagination cannot loop forever or silently truncate tasks', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ tasks: [], next_offset: 0 }), { headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(readTaskRecords('p', 't', new AbortController().signal), /分页/);
});
test('PRD creation captures original thread once across explicit lost-response resend', async () => {
  let selected = 'thread-a'; const inputs = [];
  const api = { create: async (p, input) => { inputs.push(input); throw new Error('connection lost'); }, read: async () => { throw new Error('read failed'); } };
  const session = new PrdCreationSession('p', async () => '', api, () => selected);
  session.setPrompt('需求'); await session.submit(); selected = 'thread-b';
  assert.equal(session.snapshot().input.thread_id, 'thread-a');
  assert.equal(inputs.length, 1);
});
test('PRD generation waits for a usable thread without spending an Agent request', async () => {
  const session = new PrdCreationSession('p', async () => '', { create: async () => assert.fail('must not create') }, () => { throw new Error('会话尚未就绪'); });
  session.setPrompt('需求'); await session.submit();
  assert.equal(session.snapshot().input, null); assert.match(session.snapshot().error, /会话尚未就绪/);
});

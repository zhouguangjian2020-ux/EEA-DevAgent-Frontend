import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTypescript } from './load-typescript.mjs';
const selection = await loadTypescript('../src/features/projects/selection.ts');
const { ApiError } = await loadTypescript('../src/lib/api/client.ts');
const first = { id: '11111111-1111-4111-8111-111111111111', name: '旧项目' };
const created = { id: '22222222-2222-4222-8222-222222222222', name: '新项目' };
const noFetch = async () => { throw new Error('Unexpected lookup'); };
test('URL retains an explicit project without removing other parameters or hash', () => {
  const next = selection.projectSelectionUrl('http://localhost/?view=prd#section', created.id);
  assert.equal(next, '/?view=prd&project_id=' + created.id + '#section');
  assert.equal(selection.projectIdFromUrl('http://localhost' + next), created.id);
  assert.equal(selection.projectSelectionUrl('http://localhost' + next, ''), '/?view=prd#section');
});
test('first entry is used only when no project was requested', async () => {
  assert.deepEqual(await selection.resolveProjectSelection(null, [first, created], noFetch), { project: first, unavailable: false });
  assert.deepEqual(await selection.resolveProjectSelection(null, [], noFetch), { project: null, unavailable: false });
});
test('refresh restores newly created project rather than first project', async () => {
  assert.deepEqual(await selection.resolveProjectSelection(created.id, [first, created], noFetch), { project: created, unavailable: false });
});
test('project outside the first page is fetched by ID', async () => {
  let calls = 0;
  const result = await selection.resolveProjectSelection(created.id, [first], async id => { calls++; assert.equal(id, created.id); return created; });
  assert.equal(result.project.id, created.id); assert.equal(calls, 1);
});
for (const status of [403, 404]) test('unavailable project ' + status + ' never falls back to another project', async () => {
  const result = await selection.resolveProjectSelection(created.id, [first], async () => { throw new ApiError('不可访问', status); });
  assert.deepEqual(result, { project: null, unavailable: true });
});
for (const status of [401, 500, 503, 504]) test('project recovery ' + status + ' stays blocked and retryable', async () => {
  await assert.rejects(selection.resolveProjectSelection(created.id, [first], async () => { throw new ApiError('服务失败', status); }), error => error.status === status);
});
test('network failure does not silently change project', async () => {
  await assert.rejects(selection.resolveProjectSelection(created.id, [first], async () => { throw new Error('offline'); }), /offline/);
});
for (const invalid of ['', 'not-a-uuid', '../projects', '  ']) test('invalid explicit project is not treated as an absent selection: ' + JSON.stringify(invalid), async () => {
  assert.deepEqual(await selection.resolveProjectSelection(invalid, [first], noFetch), { project: null, unavailable: true });
});
test('an unexpected lookup identity is rejected instead of displayed or written', async () => {
  await assert.rejects(selection.resolveProjectSelection(created.id, [first], async () => first), /项目/);
});

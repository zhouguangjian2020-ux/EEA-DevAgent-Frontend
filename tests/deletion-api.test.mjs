import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypescript} from './load-typescript.mjs';
const api=await loadTypescript('../src/lib/api/client.ts');

test('single delete keeps bigint version as text and sends no body; cookie and CSRF header retained', async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,init)=>{calls.push({url,init}); return new Response(JSON.stringify({deleted:true}),{status:200});});
  await api.deleteResource('project/x',{kind:'FR',id:'artifact/x'},'mutation','9223372036854775806');
  assert.equal(calls.length,1); const {url,init}=calls[0];
  assert.equal(url,'/api/v1/projects/project%2Fx/artifacts/artifact%2Fx?mutation_id=mutation&base_lock_version=9223372036854775806');
  assert.equal(init.method,'DELETE'); assert.equal(init.body,undefined);
  assert.equal(init.credentials,'include'); assert.equal(init.headers['X-Project-Request'],'1');
  assert.ok(init.signal instanceof AbortSignal);
});

test('batch preview strips UI-only fields; batch commit uses one request, not a per-item DELETE loop', async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,init)=>{calls.push({url,init}); return new Response('{}',{status:200});});
  const items=[{id:'one',kind:'FR',base_lock_version:'9007199254740993'}, {id:'two',kind:'function',base_lock_version:'1'}];
  await api.getBulkDeletionImpact('p',items.map(i=>({...i,label:'local',hasUnsavedChanges:true})));
  assert.deepEqual(JSON.parse(calls[0].init.body),{items:items.map(({id,kind})=>({id,kind}))});
  const input={mutation_id:'same-mutation',items};
  await api.deleteResources('p',input);
  assert.equal(calls.length,2); assert.equal(calls[1].init.method,'POST');
  assert.equal(calls[1].url,'/api/v1/projects/p/deletion-batch');
  assert.deepEqual(JSON.parse(calls[1].init.body),input);
});

test('unknown commit outcome is not retried automatically; an explicit retry retains the complete original input', async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,init)=>{calls.push(init.body); if(calls.length===1) throw new TypeError('network lost'); return new Response('{}',{status:200});});
  const input={mutation_id:'original-id',items:[{id:'fr',kind:'FR',base_lock_version:'12'}]};
  await assert.rejects(api.deleteResources('p',input),/network lost/); assert.equal(calls.length,1);
  await api.deleteResources('p',input); assert.equal(calls[0],calls[1]);
});

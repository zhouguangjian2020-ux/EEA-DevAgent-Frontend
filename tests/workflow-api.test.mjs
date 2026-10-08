import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypescript} from './load-typescript.mjs';
const {readChatStream,workflowPost}=await loadTypescript('../src/features/workbench/workflow-api.ts');
const sse=events=>events.map(e=>'data: '+JSON.stringify(e)+String.fromCharCode(10).repeat(2)).join('');
for(const [name,events,ok] of [['done',[{type:'token',content:'中文'},{type:'done',status:'completed'}],true],['EOF',[{type:'token',content:'部分'}],false],['error',[{type:'error',message:'失败'}],false],['incomplete done',[{type:'done',status:'failed'}],false]]){
 test('project chat stream '+name,async t=>{
  const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);const received=[];
  globalThis.fetch=async(url,opts)=>{assert.equal(opts.credentials,'include');assert.equal(opts.headers['X-Project-Request'],'1');assert.equal(opts.headers['X-API-Key'],undefined);const bytes=new TextEncoder().encode(sse(events));return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});};
  const run=()=>readChatStream('/v1/projects/project/conversations/thread/messages/stream',{message:'input'},new AbortController().signal,e=>received.push(e));
  if(ok){await run();assert.equal(received[0].content,'中文');assert.equal(received.at(-1).status,'completed');}else await assert.rejects(run);
 });
}
test('chat cancellation rejects late output',async t=>{const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);const ac=new AbortController();globalThis.fetch=async()=>{ac.abort();return new Response(sse([{type:'token',content:'late'},{type:'done',status:'completed'}]),{headers:{'Content-Type':'text/event-stream'}});};let count=0;await assert.rejects(()=>readChatStream('/p',{},ac.signal,()=>count++));assert.equal(count,0);});
test('workflow posts only to business backend with cookie and CSRF header',async t=>{const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);globalThis.fetch=async(url,o)=>{assert.equal(url,'/api/v1/projects/p/functions/f/fr-generations');assert.equal(o.credentials,'include');assert.equal(o.headers['X-Project-Request'],'1');assert.deepEqual(JSON.parse(o.body),{client_request_id:'x'});return new Response('{}',{headers:{'Content-Type':'application/json'}});};await workflowPost('/v1/projects/p/functions/f/fr-generations',{client_request_id:'x'});});

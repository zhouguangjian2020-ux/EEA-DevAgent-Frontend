import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTypescript } from './load-typescript.mjs';
const { createProjectWorks, transitionWorkbench: act, workbenchReducer, featureUcs, projectWorkspaceTree, canGenerateUcBatch, hasGeneratedUcBatch } = await loadTypescript('../src/features/workbench/model.ts');
const { panoramaId } = await loadTypescript('../src/features/panorama/model.ts');
const overviewId=panoramaId('A-new-feature','UC_OVERVIEW');
const { createPrdSession } = await loadTypescript('../src/features/prd/model.ts');
const { generateMockPrd } = await loadTypescript('../src/mocks/prd.ts');
const { createMockUcBatch, requestMockUcBatch } = await loadTypescript('../src/mocks/uc-batch.ts');
const { buildConversationRequest } = await loadTypescript('../src/features/conversation/model.ts');
const { requestMockConversation } = await loadTypescript('../src/mocks/conversation.ts');
function initial(status='accepted') {
  const source={id:'prd-source',kind:'PRD',featureId:'A-new-feature',featureName:'自动紧急制动AEB',attachments:[],ucTask:null,session:{...createPrdSession(),document:{...generateMockPrd('A','AEB自动紧急制动',null,'prd-source','自动紧急制动AEB'),status}}};
  return {...createProjectWorks(),works:{[source.id]:source},activeId:source.id,tabs:[source.id],mru:[source.id]};
}
const start=p=>act(p,{type:'uc-start',id:'prd-source',taskId:'batch-001'});
const response=p=>createMockUcBatch('A',p.works['prd-source'],'batch-001');
const ready=(p,works=response(p))=>act(p,{type:'uc-ready',id:'prd-source',taskId:'batch-001',works});
const ucs=p=>featureUcs(p,'A-new-feature');
test('batch requires accepted PRD and locks duplicate starts without touching project conversation',()=>{
  const pending=initial('pending');assert.equal(start(pending),pending);assert.equal(canGenerateUcBatch(pending.works['prd-source']),false);
  let p=initial();const conversation=p.conversation;p=start(p);assert.equal(p.activeId,'prd-source');assert.equal(p.conversation,conversation);assert.equal(p.works['prd-source'].ucTask,'batch-001');assert.equal(canGenerateUcBatch(p.works['prd-source']),false);
  assert.equal(act(p,{type:'uc-start',id:'prd-source',taskId:'double-click'}),p);
});
test('batch commits 3 UC and activates exactly one panorama while keeping the PRD tab',()=>{
  let p=start(initial());const conversation=p.conversation;p=ready(p);
  assert.equal(ucs(p).length,3);assert.deepEqual(p.tabs,['prd-source',overviewId]);assert.equal(p.activeId,overviewId);assert.equal(p.works[overviewId].kind,'UC_OVERVIEW');assert.deepEqual(p.ucBatchReveal,{workId:overviewId,requestId:'batch-001'});assert.equal(p.conversation,conversation);
  assert.equal(projectWorkspaceTree(p,'requirements')[0].children[0].children.length,3);
  assert.equal(new Set(ucs(p).map(w=>w.id)).size,3);assert.equal(new Set(ucs(p).map(w=>w.session.document.content.mainFlow)).size,3);
  for(const w of ucs(p)){assert.equal(w.featureId,'A-new-feature');assert.equal(w.sourcePrdWorkId,'prd-source');assert.equal(w.session.document.status,'pending');assert.equal(w.session.document.content.branches.length,4);assert.equal(w.session.document.content.exceptions.length,5);assert.match(w.session.document.content.description,/Mock.*需人工审阅/);}
  assert.equal(hasGeneratedUcBatch(p.works['prd-source']),true);assert.equal(start(p),p);assert.equal(ready(p),p);
});
test('existing supplemental UC does not block a batch and is never overwritten',()=>{
  let p=initial();const prior=createMockUcBatch('A',p.works['prd-source'],'single-before')[0];p={...p,works:{...p.works,[prior.id]:prior}};
  p=ready(start(p));assert.equal(ucs(p).length,4);assert.equal(p.works[prior.id],prior);
});
test('batch preserves drafts, messages, attachments and selected single-UC mode',()=>{
  let p=initial();p={...p,conversation:{...p.conversation,prompt:'下一条草稿',mode:'UC',featureId:'A-new-feature',messages:[{id:'chat',role:'user',content:'你好'}],attachments:[{id:'ref',name:'引用',type:'object',kind:'PRD',functionName:'功能',summary:'正文',status:'accepted'}]}};
  const c=p.conversation;p=ready(start(p));assert.equal(p.conversation,c);
});
test('empty or conflicting batch is rejected atomically and permits retry',()=>{
  for(const mutate of [()=>[],ws=>[ws[0],ws[0]],ws=>[ws[0],{...ws[1],featureId:'other-feature'}],ws=>[ws[0],{...ws[1],sourcePrdWorkId:'other-prd'}]]){
    const p=start(initial()),done=ready(p,mutate(response(p)));assert.equal(ucs(done).length,0);assert.equal(done.works['prd-source'].ucTask,null);assert.equal(canGenerateUcBatch(done.works['prd-source']),true);
  }
});
test('existing work/object identity collisions do not partially insert the batch',()=>{
  let p=start(initial());const works=response(p),prior={...works[1],id:'existing'};p={...p,works:{...p.works,existing:prior}};
  const done=ready(p,works);assert.equal(ucs(done).length,1);assert.equal(done.works.existing,prior);assert.equal(done.works[works[0].id],undefined);
});
test('failure/stop releases busy state and rejects late success; retry creates exactly one batch',()=>{
  let p=start(initial());const result=response(p);p=act(p,{type:'uc-failed',id:'prd-source',taskId:'batch-001',message:'停止测试'});
  assert.equal(ready(p,result),p);assert.equal(ucs(p).length,0);assert.equal(canGenerateUcBatch(p.works['prd-source']),true);
  p=act(p,{type:'uc-start',id:'prd-source',taskId:'retry-batch'});assert.equal(ready(p,result),p);
  p=act(p,{type:'uc-ready',id:'prd-source',taskId:'retry-batch',works:createMockUcBatch('A',p.works['prd-source'],'retry-batch')});assert.equal(ucs(p).length,3);
});
test('source edits or revoked acceptance reject the batch at completion without leaving it busy',()=>{
  for(const patch of [{status:'pending'},{revision:2},{content:'different body'},{id:'other-version'}]){
    let p=start(initial());const works=response(p),w=p.works['prd-source'];p={...p,works:{...p.works,[w.id]:{...w,session:{...w.session,document:{...w.session.document,...patch}}}}};
    p=ready(p,works);assert.equal(ucs(p).length,0);assert.equal(p.works['prd-source'].ucTask,null);assert.match(p.works['prd-source'].session.notice,/来源 PRD 已变化/);
  }
});
test('background batch opens its own project panorama without changing the other project',()=>{
  let p=start(initial());p=act(p,{type:'home'});const b=createProjectWorks(),store=workbenchReducer({A:p,B:b},{project:'A',action:{type:'uc-ready',id:'prd-source',taskId:'batch-001',works:response(p)}});
  assert.equal(store.B,b);assert.equal(store.A.activeId,overviewId);assert.equal(store.B.activeId,null);assert.equal(ucs(store.A).length,3);
});
test('closing a running PRD asks before stopping; cancellation does not resurrect it',()=>{
  let p=start(initial());p=act(p,{type:'close',id:'prd-source'});assert.equal(p.closeRequest.reason,'running');
  p=act(p,{type:'uc-failed',id:'prd-source',taskId:'batch-001',message:'stopped'});p=act(p,{type:'resolve-close',id:'prd-source',choice:'stop'});assert.equal(p.activeId,null);assert.equal(ready(p),p);
});
test('Mock batch request supports abort rather than creating partial UC results',async()=>{
  const p=start(initial()),controller=new AbortController();const promise=requestMockUcBatch('A',p.works['prd-source'],'aborted',controller.signal);controller.abort();await assert.rejects(promise,{name:'AbortError'});
});
test('single-UC shortcut still appends exactly one after a successful batch',async()=>{
  let p=ready(start(initial()));const prior=ucs(p);p=act(p,{type:'conversation',action:{type:'mode',mode:'UC',featureId:'A-new-feature'}});p=act(p,{type:'conversation',action:{type:'prompt',value:'补充遗漏的低电压场景'}});
  const r=buildConversationRequest('A',p,'single-after','send');p=act(p,{type:'conversation',action:{type:'start',request:r}});
  p=act(p,{type:'conversation',action:{type:'success',id:r.id,response:await requestMockConversation(r,new AbortController().signal)}});
  assert.equal(ucs(p).length,4);assert.equal(p.works[p.activeId].kind,'UC');for(const w of prior)assert.equal(p.works[w.id],w);
});


test('an existing UC panorama is reused, reactivated and receives a fresh reveal event',()=>{
  let p=initial();p=act(p,{type:'open-panorama',kind:'UC_OVERVIEW',featureId:'A-new-feature',featureName:'自动紧急制动AEB'});
  const overview=p.works[overviewId];p=act(p,{type:'open',id:'prd-source'});p=ready(start(p));
  assert.equal(p.activeId,overviewId);assert.equal(p.tabs.filter(id=>id===overviewId).length,1);assert.equal(p.works[overviewId],overview);
  assert.equal(p.ucBatchReveal.requestId,'batch-001');assert.equal(ucs(p).length,3);
});
test('completion reveals the folder even when its UC panorama is already active',()=>{
  let p=start(initial());p=act(p,{type:'open-panorama',kind:'UC_OVERVIEW',featureId:'A-new-feature',featureName:'自动紧急制动AEB'});
  const before=p.activeId;p=ready(p);assert.equal(p.activeId,before);assert.deepEqual(p.ucBatchReveal,{workId:overviewId,requestId:'batch-001'});
  assert.equal(p.tabs.length,2);assert.equal(ucs(p).length,3);
});
test('failure or stop never opens a panorama or schedules automatic sidebar navigation',()=>{
  for(const action of [{type:'uc-ready',id:'prd-source',taskId:'batch-001',works:[]},{type:'uc-failed',id:'prd-source',taskId:'batch-001',message:'停止'}]){
    const p=act(start(initial()),action);assert.equal(p.activeId,'prd-source');assert.deepEqual(p.tabs,['prd-source']);assert.equal(p.ucBatchReveal,undefined);assert.equal(p.works[overviewId],undefined);
  }
});

test('database-style candidate result disables duplicate generation without creating formal UC objects',()=>{
  let p=start(initial());
  const candidates=[{candidate_id:'candidate-1',ordinal:1,name:'记录事件',description:'候选描述',actors:'系统',preconditions:'已上电',main_flow:'触发并记录',branches:['分支1','分支2','分支3','分支4'],exceptions:['车辆','机械','环境','误用','电源'],postconditions:'已记录',extensions:'',hmi:'',regulations:'',performance:'',nonfunctional:''}];
  p=act(p,{type:'uc-candidates-ready',id:'prd-source',taskId:'batch-001',candidates});
  assert.equal(p.works['prd-source'].ucTask,null);
  assert.equal(p.works['prd-source'].ucBatchComplete,true);
  assert.deepEqual(p.works['prd-source'].ucGenerationCandidates,candidates);
  assert.equal(hasGeneratedUcBatch(p.works['prd-source']),true);
  assert.equal(canGenerateUcBatch(p.works['prd-source']),false);
  assert.equal(ucs(p).length,0);
  assert.match(p.works['prd-source'].session.notice,/尚未写入正式 UC/);
});

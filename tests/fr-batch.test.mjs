import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTypescript } from './load-typescript.mjs';
const { createProjectWorks, transitionWorkbench: act, workbenchReducer, featureFrs, frOverviewId, projectWorkspaceTree, isWorkRunning } = await loadTypescript('../src/features/workbench/model.ts');
const { frGenerationGate, snapshotFrSources } = await loadTypescript('../src/features/workbench/fr-generation.ts');
const { createMockUc } = await loadTypescript('../src/mocks/uc.ts');
const { createUcSession } = await loadTypescript('../src/features/uc/model.ts');
const { createMockFrBatch, requestMockFrBatch } = await loadTypescript('../src/mocks/fr-batch.ts');
const feature='feature-test';
function uc(id,index,status='accepted',featureId=feature) {
  const document={...createMockUc('A','测试功能',id,index),status};
  return {id,kind:'UC',featureId,featureName:'测试功能',attachments:[],sourcePrdWorkId:'prd',objectId:document.id,number:document.content.number,originalName:document.content.name,session:createUcSession(document)};
}
function initial(status='accepted') {
  const works=Object.fromEntries([uc('uc-1',0,status),uc('uc-2',1,status),uc('uc-3',2,status)].map(w=>[w.id,w]));
  return act({...createProjectWorks(),works},{type:'open-panorama',kind:'UC_OVERVIEW',featureId:feature,featureName:'测试功能'});
}
const source=p=>Object.values(p.works).find(w=>w.kind==='UC_OVERVIEW');
const start=p=>act(p,{type:'fr-batch-start',id:source(p).id,taskId:'batch-fr'});
const results=p=>createMockFrBatch('A',feature,'测试功能',frOverviewId(p,feature),source(p).frBatch);
const ready=(p,works=results(p))=>act(p,{type:'fr-batch-ready',id:source(p).id,taskId:'batch-fr',works});
const frs=p=>featureFrs(p,feature);

test('one-click FR rejects zero UC, pending UC, edited UC and running UC; reports exact unconfirmed list',()=>{
  let p=initial('pending');assert.equal(frGenerationGate(p,feature).unconfirmed.length,3);p=start(p);assert.equal(source(p).frBatch,undefined);assert.match(source(p).session.notice,/3 个 UC 未确认/);assert.equal(frs(p).length,0);
  p=initial();for(const id of ['uc-1','uc-2','uc-3'])delete p.works[id];p=start(p);assert.match(source(p).session.notice,/还没有 UC/);
  for(const change of [{editDraft:initial().works['uc-1'].session.document.content},{operation:{id:'running'}}]){
    p=initial();p.works['uc-1'].session={...p.works['uc-1'].session,...change};p=start(p);assert.equal(source(p).frBatch,undefined);assert.equal(frGenerationGate(p,feature).unconfirmed[0].id,'uc-1');
  }
});
test('one pending among accepted UC still prevents generation; other features do not block',()=>{
  let p=initial();p.works['uc-2']=uc('uc-2',1,'pending');p.works.other=uc('other',0,'pending','other-feature');
  assert.deepEqual(frGenerationGate(p,feature).unconfirmed.map(w=>w.id),['uc-2']);assert.equal(source(start(p)).frBatch,undefined);
  p.works['uc-2']=uc('uc-2',1);assert.ok(source(start(p)).frBatch);
});
test('in-flight single-UC generation blocks the FR batch until the source set is settled',()=>{
  let p=initial();p.conversation.operation={id:'uc-task',kind:'send',mode:'UC',featureId:feature};p=start(p);assert.equal(source(p).frBatch,undefined);assert.match(source(p).session.notice,/仍在生成 UC/);
});
test('all accepted creates six distinct pending FR with exact UC provenance, opens FR overview and preserves chat',()=>{
  let p=initial();const c=p.conversation,ucOverview=source(p).id;p=start(p);assert.ok(isWorkRunning(source(p)));assert.equal(start(p),p);p=ready(p);
  assert.equal(frs(p).length,6);assert.equal(p.works[p.activeId].kind,'FR_OVERVIEW');assert.deepEqual(p.frBatchReveal,{workId:p.activeId,requestId:'batch-fr'});assert.ok(p.tabs.includes(ucOverview));assert.equal(p.conversation,c);assert.equal(source(p).frBatchComplete,true);assert.equal(isWorkRunning(source(p)),false);
  assert.equal(new Set(frs(p).map(w=>w.id)).size,6);assert.equal(new Set(frs(p).map(w=>w.number)).size,6);
  for(const fr of frs(p)){assert.equal(fr.session.document.status,'pending');assert.equal(fr.featureId,feature);assert.equal(fr.session.document.content.source,p.works[fr.sourceUcWorkId].number);assert.equal(fr.sourceOverviewId,p.activeId);assert.match(fr.session.document.content.description,/Mock 测试需求/);}
  assert.equal(projectWorkspaceTree(p,'requirements')[0].children.find(n=>n.name==='FR').children.length,6);assert.equal(ready(p,[]),p);
  const again=start(p);assert.equal(source(again).frBatch,null);assert.equal(frs(again).length,6);
});
test('FR panorama is reused and existing unrelated FR are never overwritten',()=>{
  let p=act(initial(),{type:'open-fr-overview',featureId:feature}),existingOverview=p.works[p.activeId];p=start(p);
  const prior={...results(p)[0],id:'existing-fr',objectId:'existing-doc',number:'existing-number',session:{...results(p)[0].session,document:{...results(p)[0].session.document,id:'existing-doc',content:{...results(p)[0].session.document.content,id:'existing-number'}}}};
  p={...p,works:{...p.works,[prior.id]:prior}};p=ready(p);assert.equal(frs(p).length,7);assert.equal(p.works[prior.id],prior);assert.equal(p.works[p.activeId],existingOverview);assert.equal(p.tabs.filter(id=>id===existingOverview.id).length,1);
});
test('source snapshots are deep copies and source text/version/status/addition/removal changes reject results atomically',()=>{
  for(const mutate of [p=>{p.works['uc-1'].session.document.content.description='changed';},p=>{p.works['uc-1'].session.document.revision++;},p=>{p.works['uc-1'].session.document.status='pending';},p=>{p.works['uc-4']=uc('uc-4',3);},p=>{delete p.works['uc-3'];}]){
    let p=start(initial()),works=results(p),before=JSON.stringify(source(p).frBatch.sources);p=structuredClone(p);mutate(p);assert.equal(JSON.stringify(source(p).frBatch.sources),before);p=ready(p,works);assert.equal(frs(p).length,0);assert.equal(p.frBatchReveal,undefined);assert.equal(source(p).frBatch,null);assert.match(source(p).session.notice,/来源 UC/);
  }
});
test('empty, duplicate, wrong feature, wrong source and incomplete coverage reject the whole FR batch',()=>{
  for(const corrupt of [()=>[],ws=>[ws[0],ws[0]],ws=>ws.map((w,i)=>i===1?{...w,featureId:'wrong'}:w),ws=>ws.map((w,i)=>i===1?{...w,sourceUcWorkId:'unknown'}:w),ws=>ws.slice(0,2)]){
    let p=start(initial());p=ready(p,corrupt(results(p)));assert.equal(frs(p).length,0);assert.equal(source(p).frBatch,null);assert.equal(p.frBatchReveal,undefined);assert.ok(source(start(p)).frBatch);
  }
});
test('failure/cancel retains sources, rejects late results and retry succeeds without duplicate FR',()=>{
  let p=start(initial()),works=results(p);p=act(p,{type:'fr-batch-failed',id:source(p).id,taskId:'batch-fr',message:'stopped'});assert.equal(ready(p,works),p);assert.equal(frs(p).length,0);assert.equal(p.works['uc-1'].session.document.status,'accepted');
  p=act(p,{type:'fr-batch-start',id:source(p).id,taskId:'retry'});assert.equal(ready(p,works),p);const fresh=createMockFrBatch('A',feature,'测试功能',frOverviewId(p,feature),source(p).frBatch);p=act(p,{type:'fr-batch-ready',id:source(p).id,taskId:'retry',works:fresh});assert.equal(frs(p).length,6);
});
test('background FR generation stays in the origin project and active close requires stopping',()=>{
  let p=start(initial());p=act(p,{type:'close',id:source(p).id});assert.equal(p.closeRequest.reason,'running');p=act(p,{type:'resolve-close',id:source(p).id,choice:'cancel'});
  const b=createProjectWorks(),store=workbenchReducer({A:p,B:b},{project:'A',action:{type:'fr-batch-ready',id:source(p).id,taskId:'batch-fr',works:results(p)}});assert.equal(store.B,b);assert.equal(store.B.activeId,null);assert.equal(store.A.works[store.A.activeId].kind,'FR_OVERVIEW');
});
test('mock FR async adapter supports stop without a result',async()=>{
  const p=start(initial()),controller=new AbortController();const result=requestMockFrBatch('A',feature,'测试功能',frOverviewId(p,feature),source(p).frBatch,controller.signal);controller.abort();await assert.rejects(result,{name:'AbortError'});
});
test('FR detail editing updates the data used by overview and allocation; new FR are not auto-accepted',()=>{
  let p=ready(start(initial()));const fr=frs(p)[0];p=act(p,{type:'fr',id:fr.id,action:{type:'edit'}});p=act(p,{type:'fr',id:fr.id,action:{type:'edit-content',value:{...fr.session.document.content,description:'更新后的测试需求'}}});p=act(p,{type:'fr',id:fr.id,action:{type:'save'}});
  assert.equal(frs(p).find(w=>w.id===fr.id).session.document.content.description,'更新后的测试需求');assert.equal(p.works[fr.id].session.document.status,'pending');assert.equal(snapshotFrSources(p,feature).length,3);
});

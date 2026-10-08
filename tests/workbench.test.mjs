import assert from "node:assert/strict";
import test from "node:test";
import { loadTypescript } from "./load-typescript.mjs";
const { createProjectWorks, transitionWorkbench, workbenchReducer, projectWorkspaceTree, featureUcs, workObject } = await loadTypescript("../src/features/workbench/model.ts");
const { buildConversationRequest, conversationFeatures, featureDisabledReason, validateConversationRequest } = await loadTypescript("../src/features/conversation/model.ts");
const { generateMockPrd } = await loadTypescript("../src/mocks/prd.ts");
const { createPrdSession } = await loadTypescript("../src/features/prd/model.ts");
const { createMockUc } = await loadTypescript("../src/mocks/uc.ts");
const { createUcSession, UC_FIELDS } = await loadTypescript("../src/features/uc/model.ts");
const featureId="A-feature-seed", featureName="用户输入";
let seq=0;
const chat=(p,action)=>transitionWorkbench(p,{type:"conversation",action});
function request(p,mode="PRD",kind="send") {
  p=chat(p,{type:"mode",mode,...(mode==="UC"?{featureId}:{})}); p=chat(p,{type:"prompt",value:"用户输入"});
  const id=mode==="PRD"&&!Object.keys(p.works).length?"seed":`req-${++seq}`;
  const r=buildConversationRequest("A",p,id,kind); return {p:chat(p,{type:"start",request:r}),r};
}
function response(r){
  const id=`work-${r.id}`, {featureId,featureName}=r;
  if(r.mode==="PRD") return { message:"PRD done",work:{id,kind:"PRD",featureId,featureName,attachments:[],ucTask:null,session:{...createPrdSession(),rootName:featureName,document:generateMockPrd("A",r.prompt,null,id,featureName)}}};
  const document=createMockUc("A",featureName,r.id,0);
  return {message:"UC done",work:{id,kind:"UC",featureId,featureName,objectId:document.id,number:document.content.number,originalName:document.content.name,sourcePrdWorkId:r.sourcePrd.workId,attachments:[],session:createUcSession(document)}};
}
function generate(p,mode="PRD") { const {p:started,r}=request(p,mode);return chat(started,{type:"success",id:r.id,response:response(r)}); }
function accepted(){let p=generate(createProjectWorks());const id=p.activeId;p=transitionWorkbench(p,{type:"prd",id,action:{type:"select",selected:true}});return transitionWorkbench(p,{type:"prd",id,action:{type:"accept"}});}

test("home starts with no artifacts and independent empty project conversation",()=>{const p=createProjectWorks();assert.equal(p.activeId,null);assert.equal(p.conversation.mode,null);assert.deepEqual(projectWorkspaceTree(p,"product"),[]);assert.deepEqual(projectWorkspaceTree(p,"requirements"),[]);});
test("PRD success atomically creates both module directories, empty requirement categories and one active tab",()=>{const p=generate(createProjectWorks());assert.equal(p.tabs.length,1);assert.equal(p.works[p.activeId].kind,"PRD");const product=projectWorkspaceTree(p,"product"),requirements=projectWorkspaceTree(p,"requirements");assert.equal(product[0].name,featureName);assert.equal(product[0].children[0].kind,"PRD");assert.deepEqual(requirements[0].children.map(f=>[f.name,f.children.length]),[["UC",0],["FR",0],["FR分配",0]]);assert.equal(p.conversation.messages.length,2);assert.equal(p.conversation.mode,null);});
test("PRD needs only a prompt, reserves a new identity and never overwrites existing features",()=>{
  let p=createProjectWorks();p=chat(p,{type:"mode",mode:"PRD",featureId:"A-test-feature-a"});
  assert.equal(p.conversation.featureId,null);
  assert.match(validateConversationRequest(p,buildConversationRequest("A",p,"empty","send")),/请输入/);
  p=chat(p,{type:"prompt",value:"用户输入"});
  const r=buildConversationRequest("A",p,"first","send");
  assert.equal(validateConversationRequest(p,r),"");assert.equal(r.featureId,"A-feature-first");
  p=generate(createProjectWorks());const original=p.works[p.activeId];
  const {p:started,r:next}=request(p);assert.notEqual(next.featureId,original.featureId);assert.equal(next.featureName,"用户输入（2）");
  const done=chat(started,{type:"success",id:next.id,response:response(next)});
  assert.equal(done.works[original.id],original);assert.equal(Object.keys(done.works).length,2);
  assert.match(validateConversationRequest(p,{...next,featureId:original.featureId}),/已存在/);
});
test("UC requires accepted PRD, each request adds one new UC without replacing existing siblings",()=>{assert.match(featureDisabledReason(createProjectWorks(),"UC",featureId),/尚未生成/);let p=generate(createProjectWorks());assert.match(featureDisabledReason(p,"UC",featureId),/尚未确认/);p=accepted();p=generate(p,"UC");const first=p.activeId;p=generate(p,"UC");assert.equal(featureUcs(p,featureId).length,2);assert.notEqual(p.activeId,first);assert.equal(p.works[first].kind,"UC");assert.equal(projectWorkspaceTree(p,"requirements")[0].children[0].children.length,2);});
test("ordinary Q&A creates no artifact and has an output transcript",()=>{let {p,r}=request(createProjectWorks(),null);p=chat(p,{type:"success",id:r.id,response:{message:"mock answer"}});assert.equal(Object.keys(p.works).length,0);assert.equal(p.activeId,null);assert.equal(p.conversation.messages.at(-1).content,"mock answer");});
test("expansion only fills prompt; cancel and repeated stale callbacks create nothing",()=>{let {p,r}=request(createProjectWorks(),"PRD","expand");p=chat(p,{type:"success",id:r.id,response:{message:"expanded",expandedPrompt:"expanded input"}});assert.equal(p.conversation.prompt,"expanded input");assert.equal(p.conversation.messages.length,0);assert.equal(Object.keys(p.works).length,0);({p,r}=request(p));p=chat(p,{type:"cancel",id:r.id});p=chat(p,{type:"success",id:r.id,response:response(r)});assert.equal(Object.keys(p.works).length,0);assert.equal(p.conversation.prompt,"用户输入");});
test("failure retains input; retry uses original snapshot without duplicating the user message",()=>{let {p,r}=request(createProjectWorks());p=chat(p,{type:"failed",id:r.id,message:"failure"});assert.equal(p.conversation.prompt,r.prompt);assert.deepEqual(projectWorkspaceTree(p,"product"),[]);const retried={...p.conversation.error.request,id:"retry"};p=chat(p,{type:"start",request:retried,retry:true});p=chat(p,{type:"success",id:retried.id,response:response(retried)});assert.equal(p.conversation.messages.filter(m=>m.role==="user").length,1);assert.equal(p.tabs.length,1);assert.equal(p.conversation.prompt,"");});
test("attachments work with no active tab; attaching cancels mode and choosing mode clears attachments",()=>{let p=accepted();const o=workObject(p.works[p.activeId]);p=transitionWorkbench(p,{type:"home"});p=chat(p,{type:"mode",mode:"UC",featureId});p=chat(p,{type:"attach",objects:[o,o]});assert.equal(p.activeId,null);assert.equal(p.conversation.attachments.length,1);assert.equal(p.conversation.mode,null);assert.equal(p.conversation.featureId,null);p=chat(p,{type:"mode",mode:"PRD"});assert.deepEqual(p.conversation.attachments,[]);});
test("opening switching and closing tabs never switches conversation, prompt, attachments or transcript",()=>{let p=generate(accepted(),"UC");const ucId=p.activeId,prd=Object.values(p.works).find(w=>w.kind==="PRD");p=chat(p,{type:"attach",objects:[workObject(prd)]});p=chat(p,{type:"prompt",value:"same draft"});const c=p.conversation;for(const a of [{type:"home"},{type:"open",id:prd.id},{type:"open",id:ucId},{type:"close",id:ucId}]){p=transitionWorkbench(p,a);assert.equal(p.conversation,c);}assert.equal(p.conversation.attachments.length,1);});
test("in-flight references are snapshotted; modes and attachments cannot mutate a running request",()=>{let p=accepted();const o=workObject(p.works[p.activeId]);p=chat(p,{type:"attach",objects:[o]});p=chat(p,{type:"prompt",value:"question"});const r=buildConversationRequest("A",p,"snapshot","send");p=chat(p,{type:"start",request:r});p=chat(p,{type:"mode",mode:"UC"});p=chat(p,{type:"remove-attachment",objectId:o.id});assert.equal(p.conversation.mode,null);assert.equal(p.conversation.attachments.length,1);assert.notEqual(r.references[0],p.conversation.attachments[0]);assert.equal(r.references[0].summary,o.summary);});
test("pending generation is single-flight; stale/double success cannot duplicate an object",()=>{let {p,r}=request(createProjectWorks());const other={...r,id:"other"};p=chat(p,{type:"start",request:other});assert.equal(p.conversation.operation.id,r.id);p=chat(p,{type:"success",id:r.id,response:response(r)});const again=chat(p,{type:"success",id:r.id,response:response(r)});assert.equal(again,p);assert.equal(p.tabs.length,1);});
test("project stores and background results stay isolated",()=>{const {p,r}=request(createProjectWorks());let store={A:p,B:chat(createProjectWorks(),{type:"prompt",value:"B input"})};const b=store.B;store=workbenchReducer(store,{project:"A",action:{type:"conversation",action:{type:"success",id:r.id,response:response(r)}}});assert.equal(store.B,b);assert.equal(store.B.activeId,null);assert.equal(store.B.conversation.prompt,"B input");assert.equal(store.A.tabs.length,1);});
test("UC source validation rejects changed/revoked acceptance at completion",()=>{let {p,r}=request(accepted(),"UC");const source=p.works[r.sourcePrd.workId];p={...p,works:{...p.works,[source.id]:{...source,session:{...source.session,document:{...source.session.document,status:"pending"}}}}};p=chat(p,{type:"success",id:r.id,response:response(r)});assert.equal(featureUcs(p,featureId).length,0);assert.match(p.conversation.error.message,/尚未确认/);});
test("empty FR and allocation panoramas can open without generating fake data",()=>{let p=accepted();p=transitionWorkbench(p,{type:"open-fr-overview",featureId});assert.equal(p.works[p.activeId].kind,"FR_OVERVIEW");p=transitionWorkbench(p,{type:"open-panorama",kind:"FR_ALLOCATION_OVERVIEW",featureId,featureName});assert.deepEqual(p.works[p.activeId].assignments,{});assert.equal(Object.values(p.works).filter(w=>w.kind==="FR").length,0);});
test("UC retains 12 fields, four branches, five exceptions and read-only identity",()=>{let p=generate(accepted(),"UC");const id=p.activeId,original=p.works[id].session.document;assert.equal(UC_FIELDS.length,12);assert.equal(original.content.branches.length,4);assert.equal(original.content.exceptions.length,5);p=transitionWorkbench(p,{type:"uc",id,action:{type:"edit"}});p=transitionWorkbench(p,{type:"uc",id,action:{type:"edit-content",value:{...original.content,name:"Changed",number:"WRONG"}}});p=transitionWorkbench(p,{type:"uc",id,action:{type:"save"}});assert.equal(p.works[id].session.document.content.number,original.content.number);assert.equal(p.works[id].session.document.status,"pending");});
test("dirty close validation, save without accept, MRU and reopen preserve objects",()=>{let p=generate(accepted(),"UC"),id=p.activeId;const c=p.conversation;p=transitionWorkbench(p,{type:"uc",id,action:{type:"edit"}});p=transitionWorkbench(p,{type:"uc",id,action:{type:"edit-content",value:{...p.works[id].session.editDraft,name:"Changed"}}});p=transitionWorkbench(p,{type:"close",id});assert.equal(p.closeRequest.reason,"dirty");p=transitionWorkbench(p,{type:"resolve-close",id,choice:"save"});assert.notEqual(p.activeId,id);assert.equal(p.conversation,c);assert.equal(p.works[id].session.document.status,"pending");p=transitionWorkbench(p,{type:"open",id});assert.equal(p.works[id].session.document.content.name,"Changed");});

test("retry keeps a different next-message draft while using the failed request snapshot",()=>{let {p,r}=request(createProjectWorks());p=chat(p,{type:"failed",id:r.id,message:"failure"});p=chat(p,{type:"prompt",value:"下一条新问题"});const retried={...p.conversation.error.request,id:"retry-with-draft"};p=chat(p,{type:"start",request:retried,retry:true});assert.equal(p.conversation.operation.prompt,r.prompt);p=chat(p,{type:"success",id:retried.id,response:response(retried)});assert.equal(p.conversation.prompt,"下一条新问题");assert.equal(p.conversation.messages.filter(m=>m.role==="user").length,1);});


test("new PRD features join UC candidates dynamically and cannot bypass acceptance",()=>{
  let p=generate(createProjectWorks());
  const choices=conversationFeatures("A",p);assert.equal(choices.length,4);assert.equal(choices.find(f=>f.id===featureId).name,featureName);
  p=chat(p,{type:"mode",mode:"UC"});p=chat(p,{type:"prompt",value:"正常用例"});
  assert.match(validateConversationRequest(p,buildConversationRequest("A",p,"uc","send")),/选择/);
  p=chat(p,{type:"feature",featureId});
  assert.match(validateConversationRequest(p,buildConversationRequest("A",p,"uc","send")),/尚未确认/);
  assert.equal(validateConversationRequest(p,buildConversationRequest("A",p,"uc","expand")),"");
  p=accepted();p=chat(p,{type:"mode",mode:"UC",featureId});p=chat(p,{type:"prompt",value:"正常用例"});
  assert.equal(validateConversationRequest(p,buildConversationRequest("A",p,"uc","send")),"");
  assert.equal(conversationFeatures("B",createProjectWorks()).some(f=>f.id===featureId),false);
});
test("automatic expansion retains the original short feature name without allocating artifacts",()=>{
  let p=chat(createProjectWorks(),{type:"mode",mode:"PRD"});p=chat(p,{type:"prompt",value:"新功能：智能雨刷，自动检测雨量"});
  for(const id of ["expand-1","expand-2"]){
    const r=buildConversationRequest("A",p,id,"expand");assert.equal(r.featureId,null);assert.equal(r.featureName,"智能雨刷");
    p=chat(p,{type:"start",request:r});assert.equal(p.conversation.operation.id,id);
    p=chat(p,{type:"success",id,response:{message:"",expandedPrompt:"请根据以下详细需求生成完整产品文档。\n"+"详细说明".repeat(100),expansionSource:"agent"}});
    assert.equal(Object.keys(p.works).length,0);assert.equal(p.conversation.prdNameHint,"智能雨刷");
  }
  assert.equal(buildConversationRequest("A",p,"send","send").featureName,"智能雨刷");
  p=chat(p,{type:"prompt",value:"新功能：自动泊车，支持泊出"});assert.equal(p.conversation.prdNameHint,null);
  assert.equal(buildConversationRequest("A",p,"send","send").featureName,"自动泊车");
});
test("failed PRD retry keeps the new feature identity and rejects a mismatched result",()=>{
  let {p,r}=request(createProjectWorks());p=chat(p,{type:"failed",id:r.id,message:"failure"});
  const retry={...p.conversation.error.request,id:"retry-new-feature"};assert.equal(retry.featureId,r.featureId);
  p=chat(p,{type:"start",request:retry,retry:true});
  const wrong=response(retry);wrong.work.featureId="different-feature";
  const rejected=chat(p,{type:"success",id:retry.id,response:wrong});assert.equal(Object.keys(rejected.works).length,0);
  p=chat(p,{type:"success",id:retry.id,response:response(retry)});assert.equal(p.works[p.activeId].featureId,r.featureId);
  assert.equal(projectWorkspaceTree(p,"product").length,1);assert.equal(projectWorkspaceTree(p,"requirements").length,1);
});


test('database UC append reveals only the sidebar and preserves active tab and tab order',()=>{
 let p=accepted();const id=p.activeId;
 p=transitionWorkbench(p,{type:'uc-start',id,taskId:'append-sidebar'});
 const previous={activeId:p.activeId,tabs:[...p.tabs],mru:[...p.mru]};
 const next=transitionWorkbench(p,{type:'uc-appended',id,taskId:'append-sidebar',count:2});
 assert.equal(next.activeId,previous.activeId);assert.deepEqual(next.tabs,previous.tabs);assert.deepEqual(next.mru,previous.mru);
 assert.equal(next.ucBatchReveal.sidebarOnly,true);assert.equal(next.ucBatchReveal.requestId,'append-sidebar');
 assert.equal(next.works[id].ucTask,null);
 assert.equal(transitionWorkbench(next,{type:'uc-appended',id,taskId:'stale-result',count:2}),next);
});

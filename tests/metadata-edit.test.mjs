import test from "node:test";
import assert from "node:assert/strict";
import { loadTypescript } from "./load-typescript.mjs";
const { metadataDraft, metadataDirty, metadataError, metadataInput, newerVersion } = await loadTypescript("../src/features/metadata/model.ts");
const { createProjectWorks, transitionWorkbench: act, featureOverviewId, isWorkDirty, projectWorkspaceTree, workbenchReducer } = await loadTypescript("../src/features/workbench/model.ts");
const { mergeProjects } = await loadTypescript("../src/features/projects/model.ts");
const { mockManualWork } = await loadTypescript("../src/mocks/manual-work.ts");
const f = { id: "function-a", name: "旧功能", description: "旧描述", lockVersion: "9007199254740993", canUpdate: true };
const base = () => act(createProjectWorks(), { type: "manual-feature", feature: f });
const id = featureOverviewId(f.id);

test("metadata validates Unicode lengths, nullable description, forbidden NUL and normalized input", () => {
  for (const name of ["", " ", "a".repeat(101), "a\0"]) assert.ok(metadataError(name, "", "功能"));
  assert.ok(metadataError("ok", "x".repeat(2001), "项目"));
  assert.equal(metadataError("😀".repeat(100), "字".repeat(2000), "功能"), "");
  const draft = metadataDraft({ name: " old ", description: null, lock_version: f.lockVersion });
  assert.equal(metadataDirty(draft), false);
  assert.deepEqual(metadataInput({ ...draft, name: " 新名称 ", description: "   " }, "mutation"), { mutation_id: "mutation", base_lock_version: f.lockVersion, name: "新名称", description: null });
});

test("feature editing reuses the same tab, cancels only metadata, and detects unsaved changes", () => {
  let p = base(), old = p.works[id];
  p = act(p, { type: "feature-edit", id });
  assert.deepEqual(p.tabs, [id]); assert.equal(isWorkDirty(p.works[id]), false);
  p = act(p, { type: "feature-field", id, field: "name", value: "未保存" });
  assert.equal(isWorkDirty(p.works[id]), true); assert.equal(p.features[f.id].name, "旧功能");
  p = act(p, { type: "feature-cancel", id });
  assert.equal(isWorkDirty(p.works[id]), false); assert.equal(p.features[f.id].name, "旧功能");
  assert.deepEqual(p.works[id].session, old.session);
});

test("dirty metadata survives navigation and close cancellation; discard never changes saved value", () => {
  let p = act(base(), { type: "feature-edit", id });
  p = act(p, { type: "feature-field", id, field: "description", value: "draft" });
  p = act(p, { type: "home" }); p = act(p, { type: "open-feature", featureId: f.id });
  p = act(p, { type: "close", id }); assert.equal(p.closeRequest.reason, "dirty");
  assert.deepEqual(act(p, { type: "resolve-close", id, choice: "save" }), p); // hook must await HTTP
  p = act(p, { type: "resolve-close", id, choice: "cancel" }); assert.equal(p.works[id].metadataDraft.description,"draft");
  p = act(p, { type: "close", id }); p = act(p, { type: "resolve-close", id, choice: "discard" });
  assert.equal(p.tabs.length, 0); assert.equal(p.features[f.id].description,"旧描述"); assert.equal(p.works[id].metadataDraft, undefined);
});

test("uncertain metadata request freezes input and cannot be accidentally discarded", () => {
  let p = act(base(), { type: "feature-edit", id });
  p = act(p, { type: "replace-work", work: { ...p.works[id], metadataAttempt: { input: metadataInput(p.works[id].metadataDraft,"one-id") } } });
  for (const action of [{type:"feature-cancel",id},{type:"feature-field",id,field:"name",value:"different"}]) assert.deepEqual(act(p,action),p);
  p=act(p,{type:"close",id}); assert.deepEqual(act(p,{type:"resolve-close",id,choice:"discard"}),p);
});

test("rename by stable ID synchronizes six trees, tabs and context without changing PRD body or unrelated draft", () => {
  let p=base(); const prd=mockManualWork(f,{kind:"PRD",creation_id:"prd",name:"旧功能历史正文"});
  prd.session.editDraft="# 尚未保存的PRD正文";
  p=act(p,{type:"manual-work",work:prd}); p=act(p,{type:"conversation",action:{type:"prompt",value:"项目对话草稿"}});
  const conversation=p.conversation, body=prd.session.document.content;
  p=act(p,{type:"feature-updated",feature:{...f,name:"新功能",description:"新描述",lockVersion:"9007199254740994"}});
  for(const moduleKey of ["product","requirements","architecture","development","test","safety"]) assert.equal(projectWorkspaceTree(p,moduleKey)[0].name,"新功能");
  assert.ok(Object.values(p.works).every(w=>w.featureName==="新功能"));
  assert.equal(p.works[prd.id].session.document.content,body);
  assert.equal(p.works[prd.id].session.editDraft,"# 尚未保存的PRD正文");
  assert.equal(p.conversation.prompt,conversation.prompt); assert.deepEqual(p.conversation.messages,conversation.messages);
});

test("metadata updates stay in originating project, even with equal feature IDs", () => {
  const state={a:base(),b:base()};
  const next=workbenchReducer(state,{project:"a",action:{type:"feature-updated",feature:{...f,name:"A changed"}}});
  assert.equal(next.a.features[f.id].name,"A changed");assert.equal(next.b,state.b);
});

test("bigint version ordering prevents late project/feature responses from reverting new metadata", () => {
  assert.equal(newerVersion("9007199254740993","9007199254740994"),false);
  const current={id:"p",lock_version:"9007199254740994",name:"current"};
  assert.deepEqual(mergeProjects([current],[{...current,lock_version:"9007199254740993",name:"old"}]),[current]);
  const p=base(); assert.deepEqual(act(p,{type:"feature-updated",feature:{...f,lockVersion:"9007199254740992",name:"old"}}),p);
});

test("database refresh preserves even untouched metadata edit session and current draft base version", () => {
  const p=act(base(),{type:"feature-edit",id});
  const incoming={...p.works[id],metadataDraft:undefined};
  const next=act(p,{type:"database-seed",works:[incoming],features:[{...f,name:"external",lockVersion:"9007199254740994"}]});
  assert.equal(next.works[id].metadataDraft.name,"旧功能");assert.equal(next.works[id].metadataDraft.baseVersion,f.lockVersion);
});

test("reader capability cannot enter metadata editing or synthesize update authority", () => {
  const p={...base(),capabilities:[]};assert.deepEqual(act(p,{type:"feature-edit",id}),p);
});

test("metadata API uses PATCH, cookie and CSRF marker with exact operation identity", async () => {
  const { updateProject, updateFunction } = await loadTypescript("../src/lib/api/client.ts");
  const prior=global.fetch,calls=[];global.fetch=async (url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({id:"result"})};};
  try {const input={mutation_id:"stable-id",base_lock_version:f.lockVersion,name:"new"};await updateProject("p",input);await updateFunction("p","f",input);await updateFunction("p","f",input);
    assert.ok(calls.every(c=>c.options.method==="PATCH"&&c.options.credentials==="include"&&c.options.headers["X-Project-Request"]==="1"));
    assert.deepEqual(JSON.parse(calls[1].options.body),input);assert.equal(calls[1].options.body,calls[2].options.body);
  } finally {global.fetch=prior;}
});

test("late workspace snapshots cannot roll back newly saved feature metadata or remove a concurrently created feature", () => {
  let p=act(base(),{type:"feature-updated",feature:{...f,name:"new metadata",lockVersion:"9007199254740994"}});
  p=act(p,{type:"manual-feature",feature:{id:"new-id",name:"new concurrent feature",description:""}});
  const oldWork={...p.works[id],featureName:"旧功能"};
  const next=act(p,{type:"database-seed",features:[f],works:[oldWork]});
  assert.equal(next.features[f.id].name,"new metadata");assert.equal(next.features[f.id].lockVersion,"9007199254740994");
  assert.equal(next.works[id].featureName,"new metadata");assert.ok(next.features["new-id"]);
});

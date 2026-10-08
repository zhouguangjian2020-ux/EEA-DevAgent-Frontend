import test from "node:test";
import assert from "node:assert/strict";
import { loadTypescript } from "./load-typescript.mjs";
const { databaseWorkspaceWorks } = await loadTypescript("../src/features/workbench/database.ts");
const { createProjectWorks, transitionWorkbench, projectWorkspaceTree } = await loadTypescript("../src/features/workbench/model.ts");

const feature = { id: "f1", code: "F-1", name: "行车记录仪", description: "功能", lock_version: "7", can_update: true, can_delete: true, prd: null, use_cases: [], functional_requirements: [
  { id: "fr1", code: "FR-001", lock_version: "2", can_delete: true, revision: { revision_id: "fr1-r", accepted_revision_id: "fr1-r", revision_no: "1", status: "accepted", type_version_id: "t", created_via: "test", created_at: "2026-01-01T00:00:00Z" }, description: "显示视频", sources: [], acceptance_criteria: "" },
  { id: "fr2", code: "FR-002", lock_version: "3", can_delete: true, revision: { revision_id: "fr2-r", accepted_revision_id: "fr2-r", revision_no: "1", status: "accepted", type_version_id: "t", created_via: "test", created_at: "2026-01-01T00:00:00Z" }, description: "保存视频", sources: [], acceptance_criteria: "" },
], fr_allocations: [
  { id: "a1", lock_version: "8", can_delete: true, fr_id: "fr1", fr_code: "FR-001", revision: { revision_id: "a1-r", accepted_revision_id: "a1-r", revision_no: "1", status: "accepted", type_version_id: "t", created_via: "test", created_at: "2026-01-01T00:00:00Z" }, fr_revision_id: "fr1-r", design_version_id: "d", design_version_no: 1, note: null, targets: [
    { subsystem_id: "s1", subsystem_code: "VID", subsystem_name: "视频", domain_group: null, rationale: null },
    { subsystem_id: "s2", subsystem_code: "STO", subsystem_name: "存储", domain_group: null, rationale: null },
  ] },
  { id: "a2", lock_version: "9", can_delete: true, fr_id: "fr2", fr_code: "FR-002", revision: { revision_id: "a2-r", accepted_revision_id: "a2-r", revision_no: "1", status: "pending", type_version_id: "t", created_via: "test", created_at: "2026-01-01T00:00:00Z" }, fr_revision_id: "fr2-r", design_version_id: "d", design_version_no: 1, note: null, targets: [] },
], subsystems: [
  { id: "s1", code: "VID", name: "视频", description: "", responsibility_in: null, responsibility_out: null, domain_group: null, is_allocatable: true, sort_order: 1, design_version_id: "d", design_version_no: 1 },
  { id: "s2", code: "STO", name: "存储", description: "", responsibility_in: null, responsibility_out: null, domain_group: null, is_allocatable: true, sort_order: 2, design_version_id: "d", design_version_no: 1 },
  { id: "s3", code: "GPS", name: "定位", description: "", responsibility_in: null, responsibility_out: null, domain_group: null, is_allocatable: true, sort_order: 3, design_version_id: "d", design_version_no: 1 },
], accepted_use_cases: [] };
const workspace = { project: { id: "p", code: "P", name: "P", description: null, lock_version: "1", created_at: "", updated_at: "", can_delete: true }, functions: [feature], capabilities: ["function.archive", "FR_ALLOCATION.archive", "FR.archive"], read_only: false, source: "database" };

test("stage 3 allocation tree preserves real allocation identity and hides empty subsystems", () => {
  const seed = databaseWorkspaceWorks(workspace);
  let p = transitionWorkbench(createProjectWorks(), { type: "database-seed", ...seed });
  const allocationFolder = projectWorkspaceTree(p, "requirements")[0].children.find(n => n.name === "FR分配");
  assert.deepEqual(allocationFolder.children.map(n => n.name), ["VID · 视频", "STO · 存储", "未选择子系统"]);
  assert.equal(allocationFolder.children.find(n => n.name.startsWith("VID")).children[0].deletion.id, "a1");
  assert.equal(allocationFolder.children.find(n => n.name.startsWith("STO")).children[0].deletion.id, "a1");
  assert.equal(allocationFolder.children.find(n => n.name === "未选择子系统").children[0].deletion.id, "a2");
  assert.equal(allocationFolder.children.some(n => n.name.includes("GPS")), false);
});

test("stage 3 refresh removes deleted artifact tabs while preserving an unrelated draft and conversation", () => {
  const seed = databaseWorkspaceWorks(workspace);
  let p = transitionWorkbench(createProjectWorks(), { type: "database-seed", ...seed });
  p = transitionWorkbench(p, { type: "open", id: "db-fr-fr1" });
  p = transitionWorkbench(p, { type: "conversation", action: { type: "prompt", value: "保留" } });
  p = transitionWorkbench(p, { type: "database-seed", works: [], features: [], capabilities: seed.capabilities, removedArtifactIds: ["fr1"] });
  assert.equal(p.works["db-fr-fr1"], undefined);
  assert.equal(p.tabs.includes("db-fr-fr1"), false);
  assert.equal(p.activeId, "panorama:f1:UC_OVERVIEW");
  assert.equal(p.conversation.prompt, "保留");
  assert.ok(p.works["db-fr-fr2"]);
});


const { collectDeletionTargets, toggleDeletionSelection, deletionKey } = await loadTypescript('../src/features/workspace/deletion.ts');
const { collectObjects } = await loadTypescript('../src/features/workspace/tree.ts');
const seedProject = () => transitionWorkbench(createProjectWorks(), { type: 'database-seed', ...databaseWorkspaceWorks(workspace) });

test('batch selection deduplicates real allocation projections; feature never selects descendants', () => {
  const p = seedProject(); const all = collectDeletionTargets(projectWorkspaceTree(p, 'requirements'));
  assert.equal(all.filter(i => i.id === 'a1').length, 1);
  const f = all.find(i => i.kind === 'function');
  let selection = toggleDeletionSelection([], f);
  assert.deepEqual(selection.map(i => i.id), ['f1']);
  const allocation = all.find(i => i.id === 'a1');
  selection = toggleDeletionSelection(selection, allocation);
  assert.equal(selection.length, 2);
  assert.equal(toggleDeletionSelection(selection, { ...allocation }).length, 1);
  assert.equal(deletionKey(allocation), 'FR_ALLOCATION:a1');
});

test('delete selection is independent of AI attachments and rejects unauthorized or oversized additions', () => {
  const attachments = ['fr1'];
  const target = {kind:'FR',id:'x',canDelete:true,label:'X'};
  assert.deepEqual(toggleDeletionSelection([], {...target,canDelete:false}), []);
  const full = Array.from({length:200}, (_,i)=>({...target,id:String(i)}));
  assert.equal(toggleDeletionSelection(full,target),full);
  assert.equal(toggleDeletionSelection(full,full[0]).length,199);
  assert.deepEqual(attachments,['fr1']);
});

test('removing allocation locally also removes every projection and unused subsystem while preserving FR tab', () => {
  let p = transitionWorkbench(seedProject(), {type:'open',id:'db-fr-fr1'});
  p = transitionWorkbench(p, {type:'database-seed',works:[],removedArtifactIds:['a1']});
  const allocationTree = projectWorkspaceTree(p,'requirements')[0].children.find(n=>n.name==='FR分配');
  assert.deepEqual(allocationTree.children.map(n=>n.name),['未选择子系统']);
  assert.ok(p.works['db-fr-fr1']); assert.equal(p.activeId,'db-fr-fr1');
  assert.ok(p.tabs.includes('db-fr-fr1'));
  const allocations = Object.values(p.works).find(w=>w.kind==='FR_ALLOCATION_OVERVIEW');
  assert.equal(allocations.assignments['db-fr-fr1'],undefined);
});

test('deleting one of two FR relations keeps the shared subsystem group', () => {
  const copy = structuredClone(workspace);
  copy.functions[0].fr_allocations[1].targets=[copy.functions[0].fr_allocations[0].targets[0]];
  let p = transitionWorkbench(createProjectWorks(),{type:'database-seed',...databaseWorkspaceWorks(copy)});
  p=transitionWorkbench(p,{type:'database-seed',works:[],removedArtifactIds:['a1']});
  const group=projectWorkspaceTree(p,'requirements')[0].children.find(n=>n.name==='FR分配');
  assert.deepEqual(group.children.map(n=>n.name),['VID · 视频']);
  assert.equal(group.children[0].children[0].deletion.id,'a2');
});

test('deletion does not reopen a tab when the user is at home', () => {
  let p=transitionWorkbench(seedProject(),{type:'open',id:'db-fr-fr1'});
  p=transitionWorkbench(p,{type:'home'});
  p=transitionWorkbench(p,{type:'database-seed',works:[],removedArtifactIds:['a1']});
  assert.equal(p.activeId,null);
});

test('bulk result closes selected feature tabs, purges deleted attachments, preserves other feature drafts and conversation', () => {
  const other={...structuredClone(feature),id:'f2',name:'另一功能',fr_allocations:[],functional_requirements:[{...feature.functional_requirements[0],id:'other-fr'}]};
  let p=transitionWorkbench(createProjectWorks(),{type:'database-seed',...databaseWorkspaceWorks({...workspace,functions:[feature,other]})});
  p=transitionWorkbench(p,{type:'open',id:'db-fr-other-fr'});
  const draft={...p.works['db-fr-other-fr'],session:{...p.works['db-fr-other-fr'].session,editDraft:{...p.works['db-fr-other-fr'].session.document.content,description:'未保存'}}};
  p=transitionWorkbench(p,{type:'replace-work',work:draft});
  p=transitionWorkbench(p,{type:'open',id:'db-fr-fr1'});
  const objects=collectObjects(projectWorkspaceTree(p,'requirements'));
  p=transitionWorkbench(p,{type:'conversation',action:{type:'attach',objects:objects.filter(o=>o.id==='fr1'||o.id==='other-fr')}});
  p=transitionWorkbench(p,{type:'conversation',action:{type:'prompt',value:'继续讨论'}});
  p=transitionWorkbench(p,{type:'database-seed',works:[],removedFeatureIds:['f1'],removedArtifactIds:['fr1','a1','fr2','a2']});
  assert.ok(!Object.values(p.works).some(w=>w.featureId==='f1'));
  assert.ok(p.tabs.every(id=>p.works[id].featureId!=='f1'));
  assert.equal(p.works['db-fr-other-fr'].session.editDraft.description,'未保存');
  assert.equal(p.conversation.prompt,'继续讨论');
  assert.deepEqual(p.conversation.attachments.map(a=>a.id),['other-fr']);
  assert.equal(p.activeId,'db-fr-other-fr');
});

test('late old snapshot cannot resurrect a deleted artifact, feature, allocation or tab', () => {
  const seed=databaseWorkspaceWorks(workspace);
  let p=seedProject();
  p=transitionWorkbench(p,{type:'database-seed',works:[],removedArtifactIds:['fr1','a1']});
  p=transitionWorkbench(p,{type:'database-seed',...seed});
  assert.equal(p.works['db-fr-fr1'],undefined);
  assert.equal(collectObjects(projectWorkspaceTree(p,'requirements')).some(n=>n.id==='a1'),false);
  p=transitionWorkbench(p,{type:'database-seed',works:[],removedFeatureIds:['f1']});
  p=transitionWorkbench(p,{type:'database-seed',...seed});
  assert.equal(p.features.f1,undefined); assert.equal(projectWorkspaceTree(p,'requirements').length,0);
});

test('database never synthesizes allocation objects when an FR has no allocation',()=>{
  const copy=structuredClone(workspace);copy.functions[0].fr_allocations=[];
  const p=transitionWorkbench(createProjectWorks(),{type:'database-seed',...databaseWorkspaceWorks(copy)});
  assert.equal(projectWorkspaceTree(p,'requirements')[0].children.find(n=>n.name==='FR分配').children.length,0);
});

test('Mock feature does not expose a pretend server deletion menu',()=>{
  const p=transitionWorkbench(createProjectWorks(),{type:'manual-feature',feature:{id:'local',name:'Mock',description:''}});
  assert.equal(projectWorkspaceTree(p,'requirements')[0].deletion,undefined);
});


test('late metadata and content responses cannot revive explicitly deleted objects', () => {
  const before=seedProject(); const fr=before.works['db-fr-fr1'];
  const after=transitionWorkbench(before,{type:'database-seed',works:[],removedFeatureIds:['f1'],removedArtifactIds:['fr1']});
  assert.equal(transitionWorkbench(after,{type:'feature-updated',feature:before.features.f1}),after);
  assert.equal(transitionWorkbench(after,{type:'replace-work',work:fr}),after);
  assert.equal(transitionWorkbench(after,{type:'manual-work',work:fr}),after);
});

test('deleting a project purges only that project cache; other project identity and drafts stay intact', async () => {
  const {forgetDeletedProjects}=await loadTypescript('../src/features/workbench/model.ts');
  const a=seedProject(), b=seedProject(); b.conversation.prompt='其他项目草稿';
  const store={a,b}; const next=forgetDeletedProjects(store,['a']);
  assert.deepEqual(Object.keys(next),['b']); assert.equal(next.b,b);
  assert.equal(next.b.conversation.prompt,'其他项目草稿'); assert.equal(store.a,a);
  assert.equal(forgetDeletedProjects(next,['a']),next);
});

test('mock assignment navigation remains FR references without fabricated allocation delete IDs', () => {
  const p=seedProject(); delete p.capabilities;
  const a=Object.values(p.works).find(w=>w.kind==='FR_ALLOCATION_OVERVIEW');
  a.readOnly=false; a.allocations={}; a.assignments={'db-fr-fr1':['hmi']};
  const fr=p.works['db-fr-fr1']; delete fr.database;
  const groups=projectWorkspaceTree(p,'requirements')[0].children.find(n=>n.name==='FR分配').children;
  assert.equal(groups.length,1); assert.equal(groups[0].name,'HMI 子系统');
  assert.equal(groups[0].children[0].kind,'FR'); assert.equal(groups[0].children[0].deletion,undefined);
});

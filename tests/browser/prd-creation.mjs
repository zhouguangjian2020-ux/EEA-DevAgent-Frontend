import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH);
const base=process.env.EE_BASE_URL;assert.equal(base,'http://127.0.0.1:3109');
const fixture=JSON.parse(await fs.readFile(process.env.EE_WORKFLOW_FIXTURE,'utf8')), output=process.env.EE_WORKFLOW_OUTPUT;
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_BROWSER_PATH});
const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(60000);
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const done=name=>{checks.push(name);console.log('PASS',name);};
const project=fixture.project.id,p='/api/v1/projects/'+project,headers={Origin:base,'X-Project-Request':'1'};
const creation=()=>chat().getByRole('region',{name:'PRD生成任务',exact:true});
const quick=()=>chat().getByLabel('快捷生成').getByRole('button',{name:/PRD生成/});
async function noDialog(){assert.equal(await page.getByRole('dialog',{name:'生成PRD',exact:true}).count(),0);}
const chat=()=>page.locator('.live-project-conversation:not([hidden])');
const taskChecks=process.env.EE_TASK_RECORDS_ENABLED==='1';
async function taskRows(tid){const r=await context.request.get(base+p+'/conversations/'+tid+'/tasks');assert.equal(r.status(),200);return (await r.json()).tasks;}
async function post(path,data){const r=await context.request.post(base+path,{headers,data});assert.ok([200,201].includes(r.status()),await r.text());return r.json();}
async function ws(){const r=await context.request.get(base+p+'/workspace');assert.equal(r.status(),200);return r.json();}
async function agents(){return (await context.request.get('http://127.0.0.1:8419/requests')).json();}
async function control(name,extra={}){assert.equal((await context.request.post('http://127.0.0.1:8419/control',{data:{name,delay:0,fail_next_prd:false,...extra}})).status(),200);}
async function poll(fn){const deadline=Date.now()+60000;while(Date.now()<deadline){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('poll timeout');}
async function show(){if(await quick().getAttribute('aria-pressed')!=='true')await quick().click();await noDialog();}
let latestCreationRequestId=null;
async function waitForPlannedReceipt(){
  assert.ok(latestCreationRequestId);
  await poll(async()=>{
    const r=await context.request.get(base+p+'/prd-creations/intents?client_request_id='+encodeURIComponent(latestCreationRequestId));
    if(r.status()===404)return false;
    assert.equal(r.status(),200);return (await r.json()).status==='planned';
  });
}
async function begin(name,extra={}){
  await control(name,extra);await show();const another=creation().getByRole('button',{name:'开始另一项需求',exact:true});if(await another.isVisible())await another.click();
  await chat().getByRole('textbox',{name:'项目对话输入',exact:true}).fill('请实现'+name+'的功能。');
  const request=page.waitForRequest(r=>r.url().endsWith('/prd-creations/intents')&&r.method()==='POST');
  await chat().getByRole('button',{name:'发送提示词',exact:true}).click();
  latestCreationRequestId=(await request).postDataJSON().client_request_id;
  await noDialog();
}
async function closed(){await poll(async()=>await quick().getAttribute('aria-pressed')==='false'&&await creation().getAttribute('aria-busy')==='false');await noDialog();}
async function created(name){return (await ws()).functions.find(f=>f.name===name);}
try{
  await post('/api/v1/auth/login',{username:'engineer01',password:process.env.DEMO_PASSWORD});
  await page.goto(base+'/?project_id='+project);await page.getByText('产品工程 / PRD生成 / 工作流验收',{exact:true}).waitFor();
  await chat().getByRole('combobox',{name:'选择会话'}).waitFor();
  await poll(async()=>!!(await chat().getByRole('combobox',{name:'选择会话'}).inputValue()));
  await page.getByText('正在读取项目数据库数据…',{exact:true}).waitFor({state:'hidden'});
  const initialTab=await page.locator('.object-tab[aria-selected=true]').getAttribute('id');
  const initialCalls=(await agents()).length;
  await page.getByRole('button',{name:'新建 PRD 任务',exact:true}).click();await noDialog();
  await poll(async()=>await quick().getAttribute('aria-pressed')==='true');
  assert.equal(await page.locator('.object-tab[aria-selected=true]').getAttribute('id'),initialTab);
  await quick().click();await poll(async()=>await quick().getAttribute('aria-pressed')==='false');
  await page.getByRole('button',{name:'产品工程',exact:true}).click();
  await page.getByRole('tab',{name:'工作空间',exact:true}).click();
  await page.getByRole('button',{name:'＋ PRD生成',exact:true}).click();await noDialog();
  await poll(async()=>await quick().getAttribute('aria-pressed')==='true');await quick().click();
  await page.getByRole('tab',{name:'工作台',exact:true}).click();
  await page.getByRole('button',{name:'生成PRD',exact:true}).click();await noDialog();
  await poll(async()=>await quick().getAttribute('aria-pressed')==='true');await quick().click();
  await page.locator('[id="'+initialTab+'"]').click();
  assert.equal((await agents()).length,initialCalls);
  done('all PRD shortcuts enter the same composer, never open a modal or call Agent on selection');
  await chat().getByRole('textbox',{name:'项目对话输入'}).fill('保留普通聊天输入');
  const originalThreads=await (await context.request.get(base+p+'/conversations')).json();
  const originalThread=await chat().getByLabel('选择会话').inputValue();
  await begin('霜冻感知');await closed();const first=await created('霜冻感知');assert.ok(first?.prd);assert.equal(first.prd.revision.status,'pending');
  assert.equal(await chat().getByRole('textbox',{name:'项目对话输入'}).inputValue(),'');
  assert.equal(await chat().getByLabel('选择会话').inputValue(),originalThread);
  assert.equal(await page.locator('.object-tab[aria-selected=true]').getAttribute('id'),'tab-'+project+'-db-prd-'+first.id);
  assert.deepEqual((await agents()).slice(-2).map(r=>[r.scene,r.response_format]),[['FEATURE_DEFINITION','text'],['FROM_DEFINITION_CREATE_PRD','text']]);
  done('one submit creates function then pending PRD using real HTTP and disposable DB; requirement sent through the existing composer on the same thread');
  if(taskChecks){
    await poll(async()=>await chat().getByText('PRD已保存为待确认版本',{exact:true}).count()===1);
    const records=await taskRows(originalThread);assert.equal(records.length,1);assert.equal(records[0].result_count,1);assert.equal(records[0].status,'succeeded');
    assert.equal((await (await context.request.get(base+p+'/conversations/'+originalThread)).json()).turns.length,0);
    done('PRD plan/create/generate/save updates one persisted task; no synthetic turn or title change');
  }

  await begin('霜冻感知');await creation().getByRole('button',{name:'打开已有PRD：霜冻感知',exact:true}).waitFor();
  const before=(await ws()).functions.length;
  await page.screenshot({path:output+'/prd-candidates.png',fullPage:true});
  await creation().getByRole('button',{name:'退出PRD生成',exact:true}).click();assert.equal((await ws()).functions.length,before);
  await show();await creation().getByRole('button',{name:'打开已有PRD：霜冻感知',exact:true}).click();await closed();
  assert.equal(await page.locator('[id="tab-'+project+'-db-prd-'+first.id+'"]').count(),1);
  done('candidate cancel creates nothing; existing PRD opens unique tab');
  let delayTaskReceipt=taskChecks;
  if(taskChecks)await page.route('**/conversations/*/tasks',async route=>{
    if(route.request().method()==='GET'&&delayTaskReceipt){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks:[]})});}
    else await route.continue();
  });
  await begin('霜冻感知');await creation().getByRole('button',{name:'仍新建并生成PRD',exact:true}).waitFor();
  await creation().getByRole('button',{name:'仍新建并生成PRD',exact:true}).click();await creation().getByRole('alert').waitFor();assert.equal((await ws()).functions.length,before);
  await creation().getByRole('textbox',{name:'新功能名称',exact:true}).fill('后窗除霜');
  if(taskChecks){
    delayTaskReceipt=false;await chat().getByRole('button',{name:'刷新任务记录',exact:true}).click();
    await chat().locator('.conversation-task-card .prd-creation-inline').waitFor();
    assert.equal(await creation().getByRole('textbox',{name:'新功能名称',exact:true}).inputValue(),'后窗除霜');
    await page.unroute('**/conversations/*/tasks');
    done('late task receipt preserves the edited candidate name when inline controls move into the persisted card');
  }
  await creation().getByRole('button',{name:'仍新建并生成PRD',exact:true}).click();await closed();assert.ok((await created('后窗除霜')).prd);
  done('exact-name conflict rejected by backend; explicit rename creates separate pending PRD');
  const reusable=await post(p+'/functions',{creation_id:randomUUID(),name:'座椅通风',description:'保留此原始描述'});
  await begin('座椅通风');await creation().getByRole('button',{name:'复用并生成：座椅通风',exact:true}).click();await closed();
  assert.equal((await created('座椅通风')).id,reusable.function_id);assert.equal((await created('座椅通风')).description,'保留此原始描述');
  done('explicit reuse preserves original ID, name and description');
  await begin('轮胎监控',{fail_next_prd:true});await creation().getByRole('button',{name:'继续原功能生成PRD',exact:true}).waitFor();const failed=await created('轮胎监控');assert.ok(failed);assert.equal(failed.prd,null);
  let failedTask;
  if(taskChecks){failedTask=(await taskRows(originalThread)).at(-1);assert.equal(failedTask.status,'failed');}
  await creation().getByRole('button',{name:'继续原功能生成PRD',exact:true}).click();await closed();assert.equal((await created('轮胎监控')).id,failed.id);assert.ok((await created('轮胎监控')).prd);
  if(taskChecks){const retried=(await taskRows(originalThread)).filter(t=>t.id===failedTask.id);assert.equal(retried.length,1);assert.equal(retried[0].status,'succeeded');}

  done('failed generation retains function and retry uses original intent/function');
  let lost=true;await page.route('**/prd-creations/intents/*/execute',async route=>{if(lost){lost=false;await route.fetch();await route.abort('failed');}else await route.continue();});
  await begin('天窗防夹');await closed();await page.unroute('**/prd-creations/intents/*/execute');assert.ok((await created('天窗防夹')).prd);
  done('lost execute response recovered through readonly receipt; no duplicate generation');
  let failWorkspace=false;await page.route('**/prd-creations/intents/*/execute',async route=>{const response=await route.fetch();failWorkspace=true;await route.fulfill({response});});
  await page.route('**/workspace',async route=>{if(failWorkspace){failWorkspace=false;await route.fulfill({status:503,json:{detail:{message:'本地模拟目录读取失败'}}});}else await route.continue();});
  await begin('儿童遗留检测');await creation().getByText(/PRD已保存，但目录刷新失败/).waitFor();assert.ok((await created('儿童遗留检测')).prd);
  await page.unroute('**/workspace');await page.unroute('**/prd-creations/intents/*/execute');await creation().getByRole('button',{name:'打开已保存PRD',exact:true}).click();await closed();
  done('saved PRD plus directory failure is not misreported as generation failure');
  await begin('全景泊车',{delay:1});await creation().getByRole('button',{name:'停止等待',exact:true}).click();await creation().getByText(/已停止等待/).waitFor();
  await waitForPlannedReceipt();await creation().getByRole('button',{name:'读取回执',exact:true}).click();await creation().getByRole('button',{name:'仍新建并生成PRD',exact:true}).waitFor();assert.equal(await created('全景泊车'),undefined);
  await creation().getByRole('button',{name:'仍新建并生成PRD',exact:true}).click();await closed();
  done('stopping wait during plan has no implicit second phase; explicit receipt recovery resumes');
  const activeBefore=await page.locator('.object-tab[aria-selected=true]').getAttribute('id');
  await begin('风噪抑制',{delay:1});await creation().getByText('正在创建或复用功能并生成PRD…',{exact:true}).waitFor();await noDialog();
  await chat().getByRole('button',{name:/新建会话/}).click();
  await poll(async()=>!!(await created('风噪抑制'))?.prd);await new Promise(r=>setTimeout(r,300));assert.equal(await page.locator('.object-tab[aria-selected=true]').getAttribute('id'),activeBefore);
  assert.equal(await creation().count(),0);
  const newThread=await chat().getByLabel('选择会话').inputValue();
  assert.notEqual(newThread,originalThread);
  done('background completion after chat switch does not steal active tab or leak the inline task');
  if(taskChecks){
    await poll(async()=>chat().getByLabel('选择会话').inputValue().then(id=>id!==originalThread));
    assert.equal((await taskRows(await chat().getByLabel('选择会话').inputValue())).length,0);
    assert.equal(await chat().locator('.conversation-task-card').count(),0);
    const originalTask=(await taskRows(originalThread)).at(-1);assert.equal(originalTask.status,'succeeded');
    done('background task stays on original thread after conversation switch; new thread remains empty');
  }

  await chat().getByLabel('选择会话').selectOption(originalThread);await creation().getByRole('button',{name:'打开已保存PRD',exact:true}).waitFor();await show();await creation().getByRole('button',{name:'打开已保存PRD',exact:true}).click();await closed();
  const afterThreads=await (await context.request.get(base+p+'/conversations')).json();assert.equal(afterThreads.threads.length,originalThreads.threads.length+1);
  for(const t of afterThreads.threads){const history=await (await context.request.get(base+p+'/conversations/'+t.id)).json();assert.equal(history.turns.length,0);}
  await begin('电动尾门',{delay:1});await creation().getByRole('button',{name:'停止等待',exact:true}).click();await creation().getByRole('button',{name:'退出PRD生成',exact:true}).click();
  await waitForPlannedReceipt();assert.equal(await created('电动尾门'),undefined);await show();await creation().getByRole('button',{name:'读取回执',exact:true}).click();await creation().getByRole('button',{name:'开始另一项需求',exact:true}).waitFor();await creation().getByRole('button',{name:'退出PRD生成',exact:true}).click();
  done('closing planning phase does not advance into function/PRD creation');
  // A fresh second project is created via the same normal authorized API, never direct SQL.
  const other={name:'PRD项目隔离验收 '+Date.now()};
  async function switchProject(name){await page.locator('.project-picker').click();await page.locator('.project-option').filter({hasText:name}).click();await page.getByRole('button',{name:'确认切换',exact:true}).click();await poll(async()=>(await page.locator('.project-picker').innerText()).includes(name));}
  await page.locator('.project-picker').click();await page.getByRole('button',{name:'＋ 新增项目',exact:true}).click();await page.getByLabel('项目名称',{exact:false}).fill(other.name);await page.getByRole('button',{name:'创建并进入',exact:true}).click();await poll(async()=>(await page.locator('.project-picker').innerText()).includes(other.name));other.id=new URL(page.url()).searchParams.get('project_id');assert.ok(other.id);await switchProject(fixture.project.name);
  await begin('舱内净化',{delay:2});await creation().getByText('正在创建或复用功能并生成PRD…',{exact:true}).waitFor();await noDialog();
  await switchProject(other.name);await poll(async()=>!!(await created('舱内净化'))?.prd);
  assert.ok((await page.locator('.project-picker').innerText()).includes(other.name));assert.equal(await page.locator('.object-panel:not([hidden])').count(),0);
  const otherWs=await (await context.request.get(base+'/api/v1/projects/'+other.id+'/workspace')).json();assert.equal(otherWs.functions.length,0);
  await switchProject(fixture.project.name);await show();await creation().getByRole('button',{name:'打开已保存PRD',exact:true}).click();await closed();
  done('project switch leaves new project untouched; original result can be opened explicitly');
  await control('舱内净化');
  const panel=page.locator('.object-panel:not([hidden])');const original=(await created('舱内净化')).prd;
  await panel.getByRole('button',{name:'生成 PRD',exact:true}).click();await panel.getByText(/生成完成 · 未保存、未确认/).waitFor();
  assert.equal((await created('舱内净化')).prd.revision.revision_id,original.revision.revision_id);
  done('existing PRD preview remains unsaved until manual save; new workflow does not replace it');
  if(taskChecks){
    await poll(async()=>await chat().getByText('PRD预览已生成，尚未保存或确认',{exact:true}).count()===1);
    const before=await taskRows(originalThread);
    await page.reload();await chat().getByLabel('选择会话').selectOption(originalThread);
    await poll(async()=>await chat().locator('.conversation-task-card').count()===before.length);
    assert.deepEqual(await chat().locator('.conversation-task-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.taskId).sort()),before.map(t=>t.id).sort());
    const history=chat().locator('.conversation-output');await history.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
    await Promise.all([page.waitForResponse(r=>r.url().includes('/'+originalThread+'/tasks')),chat().getByRole('button',{name:'刷新任务记录',exact:true}).click()]);
    assert.ok(await history.evaluate(el=>el.scrollTop)<3);
    await chat().getByLabel('项目对话输入').fill('请总结本会话完成的任务');await chat().getByRole('button',{name:'发送提示词'}).click();
    await chat().getByText('[契约Mock] 已读取附件与会话历史。',{exact:true}).waitFor();
    const request=(await agents()).filter(r=>r.reference_data?.thread_id===originalThread&&r.response_format==='text').at(-1);
    assert.equal(request.reference_data.attachments.length,0);assert.equal(request.reference_data.messages.length,0);
    assert.ok(request.reference_data.task_receipts.some(t=>t.source==='server_task_receipt'&&t.status==='succeeded'&&t.count===1));
    done('task history restores from backend after refresh; scroll is stable; separately marked receipts reach Agent without attachments');
    await page.screenshot({path:output+'/task-history.png'});
  }

  assert.deepEqual(errors,[]);await page.screenshot({path:output+'/prd-created.png',fullPage:true});done('no synthetic chat turns, no JS errors, original conversation isolation retained');
  // Existing UC/FR and conversation regression is run separately against a fresh project by the same runner.
} catch(e){await page.screenshot({path:output+'/prd-failure.png',fullPage:true});throw e;}
finally{await fs.writeFile(output+'/prd-browser-verification.json',JSON.stringify({fixture,checks,errors},null,2));await browser.close();}

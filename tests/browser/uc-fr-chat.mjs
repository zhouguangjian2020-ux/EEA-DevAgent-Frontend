import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH);
const base=process.env.EE_BASE_URL;assert.equal(base,'http://127.0.0.1:3109');
const fixture=JSON.parse(await fs.readFile(process.env.EE_WORKFLOW_FIXTURE,'utf8')),output=process.env.EE_WORKFLOW_OUTPUT;await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_BROWSER_PATH});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(60000);
const taskChecks=process.env.EE_TASK_RECORDS_ENABLED==='1';
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const check=name=>{checks.push(name);console.log('PASS',name);};
const headers={Origin:base,'X-Project-Request':'1'},p='/api/v1/projects/'+fixture.project.id;
const active=()=>page.locator('.object-panel:not([hidden])'),chat=()=>page.locator('.live-project-conversation:not([hidden])');
async function workspace(){const r=await context.request.get(base+p+'/workspace');assert.equal(r.status(),200);return (await r.json()).functions.find(f=>f.id===fixture.function_id);}
async function poll(fn){const end=Date.now()+60000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,150));}throw new Error('Condition timed out');}
async function overview(){const back=page.getByRole('button',{name:'返回全部功能',exact:false});if(await back.isVisible())await back.click();await page.getByRole('button',{name:'需求工程',exact:true}).click();await page.getByRole('tab',{name:'工作空间',exact:true}).click();await page.getByRole('button',{name:'打开 工作流验收 UC全景视图',exact:true}).click();}
async function requests(){return (await context.request.get('http://127.0.0.1:8419/requests')).json();}
async function graphCount(){return (await requests()).filter(r=>r.scene==='FROM_UC_CREATE_UC_DIAGRAM').length;}
async function accept(item){const r=await context.request.post(base+p+'/artifacts/'+item.id+'/accept',{headers,data:{mutation_id:randomUUID(),revision_id:item.revision.revision_id}});assert.equal(r.status(),201,await r.text());}
try{
  const login=await context.request.post(base+'/api/v1/auth/login',{data:{username:'engineer01',password:process.env.DEMO_PASSWORD}});assert.equal(login.status(),200);
  for(const url of ['/api/health','/api/docs','/api/redoc','/api/v1/auth/me'])assert.equal((await context.request.get(base+url)).status(),200);
  await page.goto(base+'/?project_id='+fixture.project.id);await page.getByText('产品工程 / PRD生成 / 工作流验收',{exact:true}).waitFor();
  const prdTabId=await page.locator('.object-tab[aria-selected=true]').getAttribute('id');assert.ok(prdTabId);
  await active().getByRole('button',{name:'生成 UC',exact:true}).click();
  await poll(async()=>(await workspace()).use_cases.length===3);
  await page.getByRole('button',{name:/打开 工作流验收 .*用例1/}).waitFor();
  assert.equal(await page.locator('.object-tab[aria-selected=true]').getAttribute('id'),prdTabId);
  assert.equal((await workspace()).use_cases.filter(x=>x.revision.status==='pending').length,2);check('UC生成直接追加2条待确认实例，保留原UC和中间标签，仅展开左侧UC目录');
  await page.locator('#'+prdTabId).click();assert.equal(await active().locator('.uc-generation-candidates,.generated-uc-list').count(),0);
  await active().getByRole('button',{name:'生成 UC',exact:true}).click();await poll(async()=>(await workspace()).use_cases.length===5);check('重复UC生成追加新批次，PRD页不显示候选列表');
  if(taskChecks){await poll(async()=>await chat().getByText('已新增 2 条待确认UC',{exact:true}).count()===2);assert.equal(await chat().locator('.conversation-task-card').count(),2);}
  await overview();
  await active().getByAltText('基于已确认UC生成的用例关系图').waitFor();
  await poll(async()=>await active().getByAltText('基于已确认UC生成的用例关系图').evaluate(img=>img.complete&&img.naturalWidth>0));
  const before=await graphCount();assert.ok(before>=1);
  const initialGraph=(await requests()).filter(r=>r.scene==='FROM_UC_CREATE_UC_DIAGRAM').at(-1);
  assert.equal(initialGraph.reference_data.uc_list.length,1);
  assert.equal(initialGraph.reference_data.uc_list[0].uc_id,fixture.uc.artifact_id);
  await page.locator('#'+prdTabId).click();
  const cachedResponse=page.waitForResponse(r=>r.url().includes('/uc-diagram')&&r.request().method()==='POST');
  await overview();
  assert.equal((await (await cachedResponse).json()).status,'unchanged');
  assert.equal(await graphCount(),before);
  if(taskChecks)assert.equal(await chat().locator('.conversation-task-card').count(),2);
  await active().getByRole('button',{name:'刷新 UC 图',exact:true}).click();await poll(async()=>await graphCount()>before);
  await active().getByRole('button',{name:'刷新 UC 图',exact:true}).waitFor();
  const graphRequests=(await requests()).filter(r=>r.scene==='FROM_UC_CREATE_UC_DIAGRAM');assert.equal(graphRequests.length,before+1);
  await page.screenshot({path:path.join(output,'01-real-mermaid-diagram.png')});check('UC图自动获取并实际渲染图片；强制刷新再次调用Agent');
  const graphImage=active().getByAltText('基于已确认UC生成的用例关系图');
  const previousImage=await graphImage.getAttribute('src');
  let validGraph;
  await page.route('**/api/v1/agent/uc-diagram',async route=>{
    const response=await route.fetch();validGraph=await response.json();
    await route.fulfill({response,json:{...validGraph,diagram_code:'flowchart LR'+String.fromCharCode(10)+'  A['}});
  },{times:1});
  await active().getByRole('button',{name:'刷新 UC 图',exact:true}).click();
  await active().getByText(/仍显示上次成功的图，当前图并非最新结果/).waitFor();
  assert.equal(await graphImage.getAttribute('src'),previousImage);
  assert.equal(await graphImage.evaluate(img=>img.complete&&img.naturalWidth>0),true);
  await active().getByRole('button',{name:'刷新 UC 图',exact:true}).click();
  await poll(async()=>await active().getByText(/图形渲染失败/).count()===0);
  await poll(async()=>await graphImage.evaluate(img=>img.complete&&img.naturalWidth>0));
  assert.ok(validGraph.diagram_code);check('非法新图代码不抹掉旧图，显示失败警告，刷新可恢复');
  const pending=(await workspace()).use_cases.filter(x=>x.revision.status==='pending');for(const uc of pending)await accept(uc);
  const confirmedRefresh=page.waitForResponse(r=>r.url().includes('/uc-diagram')&&r.request().method()==='POST');
  await active().getByRole('button',{name:'刷新 UC 图',exact:true}).click();
  assert.equal((await (await confirmedRefresh).json()).status,'succeeded');
  const confirmedGraph=(await requests()).filter(r=>r.scene==='FROM_UC_CREATE_UC_DIAGRAM').at(-1);
  assert.equal(confirmedGraph.reference_data.uc_list.length,5);
  await poll(async()=>await active().getByAltText('基于已确认UC生成的用例关系图').evaluate(img=>img.complete&&img.naturalWidth>0));
  check('未确认UC不入图，来源不变复用；确认新增UC后刷新包含最新五条来源');
  await page.reload();
  // Hydration seeds the initial PRD tab and navigation; wait before changing modules.
  await page.getByText('产品工程 / PRD生成 / 工作流验收',{exact:true}).waitFor();
  // Observe the UI's save receipt before asserting the directory. A separate concurrent-read
  // backend defect was found while polling before commit (tracked in audit 54); do not hide
  // 500s with retry. This test validates the normal completed-action UI, not snapshot isolation.
  async function generateFr(){
    const response=page.waitForResponse(r=>r.url().endsWith('/fr-generations/append')&&r.request().method()==='POST');
    await active().getByRole('button',{name:'生成 FR',exact:true}).click();
    assert.equal((await response).status(),200);
  }
  await overview();await generateFr();
  await poll(async()=>(await workspace()).functional_requirements.length===1);await active().getByRole('button',{name:'生成 FR',exact:true}).waitFor();
  await generateFr();await poll(async()=>(await workspace()).functional_requirements.length===2);
  assert.ok((await workspace()).functional_requirements.every(x=>x.revision.status==='pending'));check('FR生成直接追加待确认实例，第二批不覆盖第一批');
  if(taskChecks){await poll(async()=>await chat().getByText('已新增 1 条待确认FR',{exact:true}).count()===2);check('UC/FR每批数量依据落库回执；自动获取和缓存读取UC图不产生任务卡');}
  assert.equal(await chat().getByLabel('对话操作').count(),0);
  await chat().getByRole('button',{name:'新建会话',exact:true}).click();
  await chat().getByLabel('项目对话输入').fill('请分析需求');await chat().getByRole('button',{name:'发送提示词'}).click();await chat().getByText('[契约Mock] 已读取附件与会话历史。',{exact:true}).waitFor();
  const tid=await chat().getByLabel('选择会话').inputValue();
  const outgoing=(await requests()).filter(r=>r.reference_data?.thread_id===tid);assert.equal(outgoing.length,2);assert.ok(outgoing.every(r=>r.reference_data.attachments.length===0));check('无操作选择器；无附件请求为空，Agent识别意图后真实流式回答');
  const ucCheck=page.getByRole('checkbox',{name:/选择 工作流验收 .*记录事件/});await ucCheck.check();await page.getByRole('button',{name:'添加到 AI 对话',exact:false}).click();
  await chat().getByLabel('项目对话输入').fill('修改附件中的描述');await chat().getByRole('button',{name:'发送提示词'}).click();
  await chat().getByRole('button',{name:'应用为待确认版本'}).waitFor();
  assert.equal((await workspace()).use_cases.find(x=>x.id===fixture.uc.artifact_id).description,'完整用例正文');
  await page.screenshot({path:path.join(output,'02-auto-modification-preview.png')});
  await chat().getByRole('button',{name:'丢弃建议'}).click();check('自然语言修改返回预览，未采纳不写业务对象');
  for(const viewport of [{width:1440,height:1000},{width:1100,height:720}]){
    await page.setViewportSize(viewport);
    const bounds=await chat().evaluate(el=>{const box=x=>{const r=x.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}};return {root:box(el),top:box(el.querySelector('.conversation-thread-toolbar')),messages:box(el.querySelector('.conversation-output')),bottom:box(el.querySelector('.conversation-composer-area'))};});
    assert.ok(bounds.top.bottom<=bounds.messages.top+1,JSON.stringify(bounds));assert.ok(bounds.messages.bottom<=bounds.bottom.top+1,JSON.stringify(bounds));assert.ok(bounds.messages.height>40,JSON.stringify(bounds));
  }
  await page.screenshot({path:path.join(output,'03-chat-layout-narrow.png')});check('会话顶部、消息独立滚动和底部输入在常规与窄窗口均不重叠');
  await page.reload();await chat().getByLabel('选择会话').selectOption(tid);await chat().locator('.conversation-output').getByText('请分析需求',{exact:true}).waitFor();check('刷新后保留私有会话与历史');
  const beforeShortcut=(await workspace()).use_cases.map(u=>u.id),centerBeforeShortcut=await page.locator('.object-tab[aria-selected=true]').getAttribute('id');
  await chat().getByLabel('项目对话输入').fill('保留我的下一条聊天草稿');
  await chat().getByLabel('快捷生成').getByRole('button',{name:/用例生成/}).click();
  assert.equal(await chat().getByRole('button',{name:'生成UC',exact:true}).isDisabled(),true);
  await chat().getByLabel('业务功能',{exact:true}).selectOption(fixture.function_id);
  await chat().getByRole('button',{name:'生成UC',exact:true}).click();
  await poll(async()=>(await workspace()).use_cases.length===beforeShortcut.length+2);
  const afterShortcut=(await workspace()).use_cases;
  assert.ok(beforeShortcut.every(id=>afterShortcut.some(u=>u.id===id)));
  assert.equal(afterShortcut.filter(u=>!beforeShortcut.includes(u.id)&&u.revision.status==='pending').length,2);
  assert.equal(await page.locator('.object-tab[aria-selected=true]').getAttribute('id'),centerBeforeShortcut);
  assert.equal(await chat().getByLabel('项目对话输入').inputValue(),'保留我的下一条聊天草稿');
  check('真实用例快捷入口复用已确认PRD追加UC，保留已有实例、聊天草稿和中间标签');
  await page.screenshot({path:path.join(output,'04-uc-shortcut.png')});
  const logout=await context.request.post(base+'/api/v1/auth/logout');assert.equal(logout.status(),204);assert.equal((await context.request.get(base+'/api/v1/auth/me')).status(),401);
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'result.json'),JSON.stringify({status:'PASS',checks,errors},null,2));
}catch(e){await page.screenshot({path:path.join(output,'failure.png')});await fs.writeFile(path.join(output,'failure.html'),await page.content());throw e;}finally{await browser.close();}

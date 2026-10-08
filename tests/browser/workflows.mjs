import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const base=process.env.EE_BASE_URL;assert.equal(base,'http://127.0.0.1:3109');
const fixture=JSON.parse(await fs.readFile(process.env.EE_WORKFLOW_FIXTURE,'utf8'));
const output=process.env.EE_WORKFLOW_OUTPUT;await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_BROWSER_PATH});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage();page.setDefaultTimeout(25000);
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const check=name=>{checks.push(name);console.log('PASS',name);};
const headers={Origin:base,'X-Project-Request':'1'},p='/api/v1/projects/'+fixture.project.id;
const active=()=>page.locator('.object-panel:not([hidden])');
const chat=()=>page.locator('.live-project-conversation:not([hidden])');
async function workspace(){const r=await context.request.get(base+p+'/workspace');assert.equal(r.status(),200);return (await r.json()).functions.find(f=>f.id===fixture.function_id);}
async function poll(fn){const end=Date.now()+60000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,150));}throw new Error('Condition timed out');}
async function post(url,body,status=200){const r=await context.request.post(base+p+url,{headers,data:body});assert.equal(r.status(),status,await r.text());return r.json();}
async function openModule(name){const back=page.getByRole('button',{name:'返回全部功能',exact:false});if(await back.isVisible())await back.click();await page.getByRole('button',{name,exact:true}).click();await page.getByRole('tab',{name:'工作空间',exact:true}).click();}
async function overview(kind){await openModule('需求工程');await page.getByRole('button',{name:'打开 工作流验收 '+kind+'全景视图',exact:true}).click();}
try{
  const login=await context.request.post(base+'/api/v1/auth/login',{data:{username:'engineer01',password:process.env.DEMO_PASSWORD}});assert.equal(login.status(),200,await login.text());
  for(const endpoint of ['/api/health','/api/docs','/api/redoc','/api/v1/auth/me'])assert.equal((await context.request.get(base+endpoint)).status(),200);
  await page.goto(base+'/?project_id='+fixture.project.id);await page.locator('.project-picker').waitFor();await page.locator('.object-tab-wrap.active').waitFor();await page.getByText('产品工程 / PRD生成 / 工作流验收',{exact:true}).waitFor();
  // Independent console uses real backend/database/mock, not synthetic replay.
  const consoleBase='http://127.0.0.1:7219';
  const consoleLogin=await context.request.post(consoleBase+'/api/login',{headers:{Origin:consoleBase},data:{username:'engineer01',password:process.env.DEMO_PASSWORD}});assert.equal(consoleLogin.status(),200,await consoleLogin.text());
  const catalogResponse=await context.request.get(consoleBase+'/api/catalog');assert.equal(catalogResponse.status(),200);
  async function consoleRun(case_id,payload){
    const r=await context.request.post(consoleBase+'/api/runs',{headers:{Origin:consoleBase},data:{case_id,payload}});assert.equal(r.status(),202,await r.text());const started=await r.json();let run;
    for(let i=0;i<100;i++){run=await (await context.request.get(consoleBase+'/api/runs/'+started.id)).json();if(run.state!=='running')break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(run.state,'succeeded',JSON.stringify(run.result));assert.equal(run.capture_status,'complete');assert.ok(run.events.some(e=>e.channel==='backend.database'));return run;
  }
  const consoleFr=await consoleRun('fr-generation',{project_id:fixture.project.id,function_id:fixture.function_id,client_request_id:randomUUID()});assert.ok(consoleFr.events.some(e=>e.channel==='backend.agent'));
  const consoleThread=await consoleRun('chat-thread',{project_id:fixture.project.id,client_request_id:randomUUID(),title:'联调台私有会话'});
  const consoleChat=await consoleRun('project-chat',{project_id:fixture.project.id,thread_id:consoleThread.result.id,client_request_id:randomUUID(),message:'联调台真实流式',mode:'question',attachments:[],retry:false});assert.ok(consoleChat.text.includes('契约Mock'));
  check('独立联调台：固定路由、真实SQL/Agent出入站、聊天done及捕获完整性');
  await overview('UC');
  await active().getByRole('button',{name:'生成 FR',exact:true}).click();
  await poll(async()=>(await workspace()).functional_requirements.length===1);
  let fr=(await workspace()).functional_requirements[0];assert.equal(fr.revision.status,'pending');
  check('FR生成成功后直接追加待确认实例，已有FR不被覆盖');
  await post('/artifacts/'+fr.id+'/accept',{mutation_id:randomUUID(),revision_id:fr.revision.revision_id},201);
  await poll(async()=>await chat().getByText('已新增 1 条待确认FR',{exact:true}).count()>0);check('FR实例可单独确认；任务卡依据已提交回执显示新增数量');
  await consoleRun('allocation-generation',{project_id:fixture.project.id,function_id:fixture.function_id,client_request_id:randomUUID()});
  await overview('FR分配');await active().getByRole('button',{name:'一键生成FR分配',exact:true}).click();await poll(async()=>await chat().getByText(/分配建议，尚未保存或确认/).count()>0);await active().getByLabel('分配说明').fill('人工核对职责');
  await active().getByRole('button',{name:'保存草稿',exact:true}).click();await active().getByText('分配草稿已保存，尚未确认。').waitFor();
  let alloc=(await workspace()).fr_allocations[0];assert.equal(alloc.targets.length,2);assert.equal(alloc.revision.status,'pending');
  await active().getByRole('button',{name:'确认分配',exact:true}).click();await active().getByText('分配已确认。',{exact:true}).waitFor();const accepted=(await workspace()).fr_allocations[0].revision.revision_id;
  await active().getByLabel('分配说明').fill('新的待确认说明');await active().getByRole('button',{name:'保存草稿',exact:true}).click();await active().getByText('分配草稿已保存，尚未确认。').waitFor();
  alloc=(await workspace()).fr_allocations[0];assert.equal(alloc.revision.accepted_revision_id,accepted);assert.notEqual(alloc.revision.revision_id,accepted);check('分配一对多、保存、确认及历史确认版本保留');
  await page.screenshot({path:path.join(output,'01-allocation-review.png')});
  await chat().getByRole('button',{name:'新建会话',exact:true}).click();assert.equal(await chat().getByLabel('对话操作').count(),0);await chat().getByLabel('项目对话输入').fill('第一次问答');await chat().getByRole('button',{name:'发送提示词'}).click();await chat().getByText('[契约Mock] 已读取附件与会话历史。',{exact:true}).waitFor();
  const t1=await chat().getByLabel('选择会话').inputValue();await chat().getByRole('button',{name:'新建会话',exact:true}).click();
  await page.waitForFunction(previous => { const select = document.querySelector('.live-project-conversation:not([hidden]) select'); return select && select.value !== previous; }, t1);
  const t2=await chat().getByLabel('选择会话').inputValue();assert.notEqual(t1,t2);assert.equal(await chat().locator('.conversation-output').getByText('第一次问答',{exact:true}).count(),0);
  await chat().getByLabel('选择会话').selectOption(t1);await chat().locator('.conversation-output').getByText('第一次问答',{exact:true}).waitFor();check('同用户多会话切换且历史隔离');
  await page.reload();await chat().getByLabel('选择会话').selectOption(t1);await chat().locator('.conversation-output').getByText('第一次问答',{exact:true}).waitFor();check('刷新后会话历史由后端恢复');
  const logout=await context.request.post(base+'/api/v1/auth/logout');assert.equal(logout.status(),204);assert.equal((await context.request.get(base+p+'/conversations')).status(),401);
  const relogin=await context.request.post(base+'/api/v1/auth/login',{data:{username:'engineer01',password:process.env.DEMO_PASSWORD}});assert.equal(relogin.status(),200);await page.reload();await chat().getByLabel('选择会话').selectOption(t1);await chat().locator('.conversation-output').getByText('第一次问答',{exact:true}).waitFor();check('退出重新登录后私有历史仍可恢复');

  await overview('UC');
  await active().getByRole('button',{name:'刷新 UC 图',exact:true}).click();
  await poll(async()=>await chat().getByText('UC图已生成；请在UC视图查看',{exact:true}).count()>0);
  check('显式刷新UC图创建任务卡，自动读取不创建任务卡');
  // Add the actual workspace UC through selection, never inject a fake body.
  const ucCheck=page.getByRole('checkbox',{name:/选择 工作流验收 .*记录事件/});
  if(!await ucCheck.isVisible()){await page.getByRole('button',{name:'展开 工作流验收 UC 文件夹',exact:true}).click();}
  await ucCheck.check();await page.getByRole('button',{name:'添加到 AI 对话',exact:false}).click();
  assert.equal(await chat().getByLabel('对话操作').count(),0);await chat().getByLabel('项目对话输入').fill('改写附件描述');await chat().getByRole('button',{name:'发送提示词'}).click();
  await chat().getByRole('button',{name:'丢弃建议'}).waitFor();assert.equal((await workspace()).use_cases[0].description,'完整用例正文');
  await chat().getByRole('button',{name:'丢弃建议'}).click();assert.equal((await workspace()).use_cases[0].description,'完整用例正文');check('聊天修改先预览，丢弃不改原对象');
  await chat().getByLabel('项目对话输入').fill('重新改写附件描述');await chat().getByRole('button',{name:'发送提示词'}).click();await chat().getByRole('button',{name:'应用为待确认版本'}).click();await chat().getByText('已应用为新的待确认版本；历史确认版本保留，请到原对象页面确认。').waitFor();
  const updated=(await workspace()).use_cases[0];assert.equal(updated.revision.status,'pending');assert.equal(updated.revision.accepted_revision_id,fixture.uc.revision_id);assert.equal(updated.description,'[契约Mock] 人工审阅后应用的修改');check('显式应用生成新草稿，不覆盖旧确认历史');
  await page.screenshot({path:path.join(output,'02-chat-modification.png')});
  await chat().getByRole('button',{name:/移除附件 .*记录事件/}).click();assert.equal(await chat().getByLabel('对话操作').count(),0);
  await chat().getByLabel('项目对话输入').fill('断流测试');await chat().getByRole('button',{name:'发送提示词'}).click();await chat().getByRole('button',{name:'重试原请求'}).waitFor();check('缺失done的流不会标为成功');
  await chat().getByLabel('项目对话输入').fill('慢速请求');await chat().getByRole('button',{name:'发送提示词'}).click();await chat().getByRole('button',{name:'停止',exact:true}).click();await chat().getByText('已停止，当前回复未完成。').waitFor();check('停止保留未完成状态，不自动应用内容');
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({status:'PASS',checks,errors},null,2));
} catch(e){await page.screenshot({path:path.join(output,'failure.png')});await fs.writeFile(path.join(output,'failure.html'),await page.content());throw e;}finally{await browser.close();}

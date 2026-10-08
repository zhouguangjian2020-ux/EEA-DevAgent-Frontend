import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const live=process.env.EE_LIVE_EXPAND==='true';
const base=process.env.EE_BASE_URL || 'http://127.0.0.1:3000';
const output=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../artifacts/prd-new-feature-2026-09-21',live?'live-browser':'expand-browser');
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_PATH?{executablePath:process.env.PLAYWRIGHT_BROWSER_PATH}:{})});
const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
const page=await context.newPage();page.setDefaultTimeout(12000);
const checks=[],errors=[],requests=[];let behavior='ok';
const finalText='AEB 自动紧急制动功能用于辅助驾驶员识别潜在碰撞风险。请围绕使用场景、激活条件、触发边界、退出条件与驾驶员提示继续梳理；阈值与验证标准需要结合具体项目确认。此段是浏览器测试替身，不是实际 Agent 的专业结论。';
page.on('pageerror',e=>errors.push(e.message));
page.on('dialog',d=>d.accept());
if(!live)await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/v1/auth/me')return route.fulfill({contentType:'application/json',body:JSON.stringify({id:'test',username:'接口测试',department:'QA',avatar_url:null})});
  if(url.pathname!=='/api/v1/agent/prd/expand')throw Error('Unexpected API '+url.pathname);
  requests.push(request.postDataJSON());assert.equal(request.headers()['x-api-key'],undefined);
  const current=behavior;
  if(current==='delay')await new Promise(resolve=>setTimeout(resolve,900));
  if(current==='error'||current==='unauthorized')return route.fulfill({status:current==='error'?502:401,contentType:'application/json',body:JSON.stringify({detail:{message:current==='error'?'Agent 暂时不可用':'登录已过期'}})});
  return route.fulfill({contentType:'application/json',body:JSON.stringify({text:finalText,request_id:'browser-fixture',trace_id:null,response_mode:'buffered'})});
});
else page.on('request',request=>{if(new URL(request.url()).pathname==='/api/v1/agent/prd/expand'){assert.equal(request.headers()['x-api-key'],undefined);requests.push(request.postDataJSON());}});
if(live && process.env.EE_BACKEND_OVERRIDE) await page.route('**/api/v1/agent/prd/expand', async route=>{
  const response=await route.fetch({url:process.env.EE_BACKEND_OVERRIDE+'/v1/agent/prd/expand',timeout:145000});
  await route.fulfill({response});
});
const chat=()=>page.locator('.project-conversation:not([hidden])');
const input=()=>chat().getByRole('textbox',{name:'项目对话输入',exact:true});
const expand=()=>chat().getByRole('button',{name:'自动扩写',exact:true});
const tabs=()=>page.getByRole('tablist',{name:'对象标签',exact:true});
const settled=()=>chat().locator('.conversation-loading').waitFor({state:'hidden',timeout:145000});
const check=name=>{checks.push(name);console.log('PASS',name);};
async function switchProject(key){await page.locator('.project-picker').click();await page.locator('.project-option').filter({hasText:'项目'+key}).click();await page.getByRole('button',{name:'确认切换',exact:true}).click();}
async function waitPreview(){await page.waitForFunction(()=>{const e=document.querySelector('.project-conversation:not([hidden]) .conversation-loading');return e?.textContent.includes('逐字回填');},{},{timeout:145000});}
try {
  if(live){
    assert.ok(process.env.EE_LOGIN_USERNAME&&process.env.EE_LOGIN_PASSWORD,'live test credentials must be injected, never saved');
    const login=await context.request.post(base+'/api/v1/auth/login',{data:{username:process.env.EE_LOGIN_USERNAME,password:process.env.EE_LOGIN_PASSWORD}});
    assert.equal(login.status(),200);assert.ok((await context.cookies()).some(c=>c.name==='ts_session'&&c.httpOnly));
  }
  await page.goto(base,{waitUntil:'networkidle'});await input().waitFor();
  await chat().getByLabel('快捷生成').getByRole('button',{name:/PRD生成/}).click();
  assert.equal(await chat().getByRole('combobox',{name:'业务功能',exact:true}).count(),0);
  await input().fill('AEB自动紧急制动');
  const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/agent/prd/expand',{timeout:145000});
  await expand().click();
  const response=await responsePromise;assert.equal(response.status(),200);const body=await response.json();assert.equal(body.response_mode,'buffered');
  await waitPreview();const first=await input().inputValue();assert.notEqual(first,body.text);assert.ok(body.text.startsWith(first));assert.equal(await input().getAttribute('readonly'),'');
  await page.screenshot({path:path.join(output,'01-progress.png')});
  const lengths=new Set([first.length]);for(let n=0;n<8;n++){await page.waitForTimeout(100);lengths.add((await input().inputValue()).length);}
  await settled();assert.equal(await input().inputValue(),body.text);assert.ok(lengths.size>=3);assert.equal(requests.length,1);assert.deepEqual(requests[0],{feature_name:'AEB自动紧急制动'});assert.equal(await tabs().getByRole('tab').count(),1);assert.equal(await chat().locator('.conversation-message').count(),0);assert.ok(await input().isEditable());
  await page.screenshot({path:path.join(output,'02-complete.png')});check(live?'real cookie-authenticated frontend -> backend -> Agent expansion, progressive display, no artifact creation':'progressive buffered display, single request, no API key, no artifact creation');
  if(!live){
    behavior='delay';await input().fill('等待时停止的原文');await expand().click();await chat().getByRole('button',{name:'停止',exact:true}).click();await page.waitForTimeout(1100);assert.equal(await input().inputValue(),'等待时停止的原文');check('stop during network wait restores original text and ignores late response');
    behavior='ok';await input().fill('回填时停止的原文');await expand().click();await waitPreview();await chat().getByRole('button',{name:'停止',exact:true}).click();await page.waitForTimeout(500);assert.equal(await input().inputValue(),'回填时停止的原文');check('stop during typewriter cancels timer and restores original draft');
    behavior='error';await input().fill('失败后要保留');await expand().click();await settled();assert.equal(await input().inputValue(),'失败后要保留');assert.match(await chat().getByRole('alert').innerText(),/Agent 暂时不可用/);await input().fill('输入改过，重试仍使用旧快照');behavior='ok';await chat().getByRole('button',{name:'重试本次请求',exact:true}).click();await settled();assert.equal(requests.at(-1).feature_name,'失败后要保留');assert.equal(await input().inputValue(),finalText);check('backend failure preserves original and retry uses failed snapshot rather than Mock fallback');
    behavior='unauthorized';await input().fill('过期登录原文');await expand().click();await settled();assert.equal(await input().inputValue(),'过期登录原文');assert.match(await chat().getByRole('alert').innerText(),/登录已过期/);check('expired login reports an actionable error without replacing input');
    behavior='delay';await input().fill('项目 A 后台扩写');await expand().click();await switchProject('B');await input().fill('项目 B 独立草稿');await page.waitForTimeout(4200);assert.equal(await input().inputValue(),'项目 B 独立草稿');await switchProject('A');await settled();assert.equal(await input().inputValue(),finalText);check('background expansion stays in original project while another draft remains isolated');
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({passed:true,live,backend_proxy_override:process.env.EE_BACKEND_OVERRIDE || null,checks,errors,requests,progress_samples:[...lengths],response_mode:body.response_mode,request_id:body.request_id,trace_id:body.trace_id,text_characters:body.text.length},null,2));
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});await fs.writeFile(path.join(output,'results.json'),JSON.stringify({passed:false,checks,errors,error:String(error)},null,2));throw error;} finally {await browser.close();}

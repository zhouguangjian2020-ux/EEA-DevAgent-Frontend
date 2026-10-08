import test from "node:test";
import assert from "node:assert/strict";
import { loadTypescript } from "./load-typescript.mjs";
const { requestPrdExpansion, streamPrdExpansion } = await loadTypescript("../src/features/conversation/api.ts");
const { revealExpansion } = await loadTypescript("../src/features/conversation/reveal.ts");
const { createProjectWorks, transitionWorkbench, workbenchReducer } = await loadTypescript("../src/features/workbench/model.ts");
const { buildConversationRequest } = await loadTypescript("../src/features/conversation/model.ts");
const action=(p,a)=>transitionWorkbench(p,{type:"conversation",action:a});
function pending(){let p=createProjectWorks();p=action(p,{type:"mode",mode:"PRD"});p=action(p,{type:"prompt",value:"AEB自动紧急制动"});const r=buildConversationRequest("A",p,"expand-request","expand");return {p:action(p,{type:"start",request:r}),r};}
const ok={text:"扩写后的内容",request_id:"request-test",trace_id:"trace-test",response_mode:"buffered"};

test("PRD expansion calls only business backend with cookie, never an Agent key",async t=>{t.mock.method(globalThis,"fetch",async(url,init)=>{assert.equal(url,"/api/v1/agent/prd/expand");assert.equal(init.credentials,"include");assert.deepEqual(init.headers,{"Content-Type":"application/json"});assert.deepEqual(JSON.parse(init.body),{feature_name:"AEB自动紧急制动"});return Response.json(ok);});assert.deepEqual(await requestPrdExpansion("AEB自动紧急制动",new AbortController().signal),ok);});
for(const [status,detail,pattern] of [[401,"expired",/登录已过期/],[422,[],/4000/],[504,{message:"Agent 扩写超时"},/超时/],[502,{message:"暂时无法连接 Agent"},/无法连接/]])test("backend expansion error "+status+" does not fall back to Mock",async t=>{t.mock.method(globalThis,"fetch",async()=>Response.json({detail},{status}));await assert.rejects(requestPrdExpansion("AEB",new AbortController().signal),pattern);});
test("empty or wrong expansion response is rejected",async t=>{t.mock.method(globalThis,"fetch",async()=>Response.json({...ok,text:""}));await assert.rejects(requestPrdExpansion("AEB",new AbortController().signal),/有效扩写文本/);});
test("aborting fetch stays an AbortError",async t=>{const c=new AbortController();t.mock.method(globalThis,"fetch",async(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true})));const promise=requestPrdExpansion("AEB",c.signal);c.abort();await assert.rejects(promise,{name:"AbortError"});});
test("progressive reveal preserves complete Unicode characters and finishes exactly",async()=>{const frames=[];await revealExpansion("自动🚗制动",new AbortController().signal,text=>frames.push(text),false,0);assert.ok(frames.length>1);assert.equal(frames.at(-1),"自动🚗制动");assert.ok(frames.includes("自动🚗"));assert.ok(frames.every(text=>!/[\uD800-\uDBFF]$/.test(text)));});
test("cancel stops progressive reveal without a later final frame",async()=>{const frames=[],c=new AbortController();await assert.rejects(revealExpansion("AEB自动紧急制动",c.signal,text=>{frames.push(text);c.abort();},false,0),{name:"AbortError"});assert.equal(frames.length,1);});
test("reduced motion reveals once without animation",async()=>{const frames=[];await revealExpansion("完整结果",new AbortController().signal,text=>frames.push(text),true);assert.deepEqual(frames,["完整结果"]);});
test("expansion preview never replaces original draft before success; cancellation rejects late chunks",()=>{let {p,r}=pending();p=action(p,{type:"expansion-progress",id:r.id,text:"部分结果"});assert.equal(p.conversation.expansionPreview,"部分结果");assert.equal(p.conversation.prompt,r.prompt);p=action(p,{type:"cancel",id:r.id});assert.equal(p.conversation.expansionPreview,null);assert.equal(p.conversation.prompt,r.prompt);assert.equal(action(p,{type:"expansion-progress",id:r.id,text:"迟到"}),p);assert.equal(action(p,{type:"success",id:r.id,response:{message:"",expandedPrompt:"迟到",expansionSource:"agent"}}),p);});
test("real expansion commits text only, creates no artifact/message, and can fail without losing draft",()=>{let {p,r}=pending();p=action(p,{type:"success",id:r.id,response:{message:"",expandedPrompt:"完整结果",expansionSource:"agent"}});assert.equal(p.conversation.prompt,"完整结果");assert.match(p.conversation.notice,/扩写完成/);assert.equal(p.conversation.messages.length,0);assert.equal(p.tabs.length,0);({p,r}=pending());p=action(p,{type:"expansion-progress",id:r.id,text:"部分"});p=action(p,{type:"failed",id:r.id,message:"错误"});assert.equal(p.conversation.prompt,r.prompt);assert.equal(p.conversation.expansionPreview,null);});
test("background expansion preview is isolated by project",()=>{const {p,r}=pending();const b=createProjectWorks();const store=workbenchReducer({A:p,B:b},{project:"A",action:{type:"conversation",action:{type:"expansion-progress",id:r.id,text:"A 的结果"}}});assert.equal(store.B,b);assert.equal(store.A.conversation.expansionPreview,"A 的结果");});

test("PRD expansion starts without a selected feature or new feature identity",()=>{const {p,r}=pending();assert.equal(p.conversation.featureId,null);assert.equal(r.featureId,null);assert.equal(p.conversation.operation.id,r.id);assert.equal(Object.keys(p.works).length,0);});

function streamResponse(chunks, status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

test("streaming expansion parses split SSE frames and reports token progress", async t => {
  const frames = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/v1/agent/prd/expand/stream");
    assert.equal(init.credentials, "include");
    assert.deepEqual(init.headers, { Accept: "text/event-stream", "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(init.body), { feature_name: "AEB自动紧急制动" });
    return streamResponse([
      'data: {"type":"token","content":"自动"}\n\n',
      'data: {"type":"token","content":"🚗制动"}\n\n',
      'data: {"type":"done","scene":"PROMPT_EXPAND","output":"自动🚗制动","trace_id":"trace-stream"}\n\n',
    ]);
  });
  const result = await streamPrdExpansion("AEB自动紧急制动", new AbortController().signal, text => frames.push(text));
  assert.deepEqual(frames, ["自动", "自动🚗制动"]);
  assert.deepEqual(result, { text: "自动🚗制动", request_id: "stream-request", trace_id: "trace-stream", response_mode: "stream" });
});

test("streaming expansion accepts a JSON done frame without leaking private fields", async t => {
  t.mock.method(globalThis, "fetch", async () => streamResponse([
    'data: {"type":"token","content":"完整"}\n\n',
    'data: {"type":"done","scene":"PROMPT_EXPAND","output":"完整结果","task_id":"private-task"}\n\n',
  ]));
  const result = await streamPrdExpansion("AEB", new AbortController().signal, () => {});
  assert.equal(result.text, "完整结果");
  assert.equal(result.trace_id, null);
});

test("streaming expansion turns SSE error into a user-safe exception", async t => {
  t.mock.method(globalThis, "fetch", async () => streamResponse([
    'data: {"type":"error","code":"agent_upstream_error","message":"Agent 扩写失败，请稍后重试或联系管理员。","task_id":"private-task"}\n\n',
  ]));
  await assert.rejects(streamPrdExpansion("AEB", new AbortController().signal, () => {}), /Agent 扩写失败/);
});

test("streaming expansion aborts without a late progress callback", async t => {
  const controller = new AbortController();
  const frames = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = new ReadableStream({
      start(streamController) {
        init.signal.addEventListener("abort", () => streamController.error(new DOMException("Aborted", "AbortError")), { once: true });
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  });
  const promise = streamPrdExpansion("AEB", controller.signal, text => frames.push(text));
  controller.abort();
  await assert.rejects(promise, { name: "AbortError" });
  assert.deepEqual(frames, []);
});
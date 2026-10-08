import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadComponent} from './load-component.mjs';
import {loadTypescript} from './load-typescript.mjs';
const {LiveProjectConversation}=loadComponent('../src/components/workbench/live-project-conversation.tsx');
const {createProjectWorks}=await loadTypescript('../src/features/workbench/model.ts');
const noop=()=>{};
function render(mode=null){const state=createProjectWorks();state.conversation.mode=mode;return renderToStaticMarkup(createElement(LiveProjectConversation,{project:'p',state,visible:true,docked:true,onAction:noop,onMode:noop,onSend:noop,onStop:noop,onOpenObject:noop,onOpenWork:noop}));}
test('real database conversation renders both quick entries and keeps My Conversations above history',()=>{
 const html=render();assert.ok(html.includes('PRD生成'));assert.ok(html.includes('用例生成'));assert.ok(html.includes('自动扩写'));
 assert.ok(html.indexOf('conversation-thread-toolbar')<html.indexOf('conversation-output'));
 assert.ok(html.indexOf('conversation-output')<html.indexOf('conversation-composer-area'));
 assert.doesNotMatch(html,/role="dialog"|chat-mode-selector/);
});
test('UC quick source is explicit and does not inject mock features into an empty real project',()=>{
 const html=render('UC');assert.ok(html.includes('业务功能'));assert.ok(html.includes('生成UC'));assert.ok(html.includes('聊天草稿保留'));
 assert.doesNotMatch(html,/测试功能 A|测试功能 B|测试功能 C/);
});
test('PRD quick mode uses the existing composer, not a second prompt form',()=>{
 const html=render('PRD');assert.equal((html.match(/<textarea/g)||[]).length,1);assert.ok(html.includes('输入新功能名称与需求'));
 assert.doesNotMatch(html,/role="dialog"|发送并生成PRD/);
});
test('workbench uses reactive per-thread creation sessions and has no obsolete dialog entry',async()=>{
 const src=await readFile(new URL('../src/components/workbench/object-workbench.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(src,/PrdCreationDialog|prd-creation-dialog/);assert.match(src,/projectKey \+ '\/' \+ thread/);assert.match(src,/prdCreation=\{databaseMode \? creationSessionMap\[key\]/);
 const sidebar=await readFile(new URL('../src/components/navigation/app-sidebar.tsx',import.meta.url),'utf8');
 assert.match(sidebar,/navigation.primary === "product" && props.onNewPrd &&/);
});

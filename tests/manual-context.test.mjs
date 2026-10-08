import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadComponent } from './load-component.mjs';
const { ManualCreateDialog } = loadComponent('../src/components/workbench/manual-create-dialog.tsx', {
  './work-dialog': { WorkDialog: ({ title, children }) => React.createElement('section', { 'aria-label': title }, children) },
  './uc-source-picker': { UcSourcePicker: () => null },
});
const target = { project: '22222222-2222-4222-8222-222222222222', projectLabel: '隔离项目 · PRJ-2222', kind: 'function', candidates: [] };
function render(props = {}) { return renderToStaticMarkup(React.createElement(ManualCreateDialog, { target, onCreate: async () => {}, onClose() {}, ...props })); }
test('manual creation explicitly identifies its fixed project', () => {
  const html = render(); assert.ok(html.includes('所属项目：')); assert.ok(html.includes('隔离项目 · PRJ-2222'));
});
test('changed project context locks the form and warns without rebinding its target', () => {
  const html = render({ contextValid: false }); assert.ok(html.includes('当前项目已切换'));
  assert.match(html, /<fieldset disabled=/); assert.match(html, /<button class="button-primary" disabled=/);
  assert.ok(html.includes('隔离项目 · PRJ-2222'));
});
test('PRD creation identifies both project and parent function', () => {
  const html = render({ target: { ...target, kind: 'PRD', feature: { id: 'fixture-function', name: 'DVR功能' } } });
  assert.ok(html.includes('所属项目：')); assert.ok(html.includes('所属功能：')); assert.ok(html.includes('DVR功能'));
});

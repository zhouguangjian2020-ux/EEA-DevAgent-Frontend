import { conversationFeatures, featureDisabledReason } from './model';
import type { ProjectWorks } from '../workbench/model';
export type PrdCommand = { kind: 'generate'; targetFunctionId?: string; newFunctionName?: string } | { kind: 'clarify'; message: string } | null;
// Deliberately a small explicit-command grammar, not a general intent model.
// No history, current tab, quoted paragraph, question or keyword substring can authorize a write.
export function parsePrdCommand(message: string, project: string, state: ProjectWorks): PrdCommand {
  const text = message.trim();
  const prefix = '(?:请帮我|帮我|请|麻烦)?';
  const name = '[「『“"]([^「」『』“”"\r\n]{1,100})[」』”"]';
  const end = '(?:一份)?\\s*PRD[。！!]?';
  const existing = new RegExp('^' + prefix + '(?:给|为)(?:已有)?功能\\s*' + name + '\\s*(?:生成|创建)' + end + '$', 'i').exec(text);
  const creating = new RegExp('^' + prefix + '新建功能\\s*' + name + '\\s*并生成' + end + '$', 'i').exec(text);
  if (existing) {
    const key = normalizeFunctionName(existing[1]);
    const matches = conversationFeatures(project, state, false).filter(f => normalizeFunctionName(f.name) === key);
    if (matches.length !== 1) return { kind: 'clarify', message: matches.length ? '功能名称不唯一，请使用PRD生成下拉框明确选择。' : '当前项目中未找到该功能；未新建功能。请核对名称或明确要求新建。' };
    const reason = featureDisabledReason(state, 'PRD', matches[0].id);
    return reason ? { kind: 'clarify', message: '该功能已有PRD，未生成或覆盖。' } : { kind: 'generate', targetFunctionId: matches[0].id };
  }
  if (creating) return creating[1].trim() ? { kind: 'generate', newFunctionName: creating[1].trim() } : { kind: 'clarify', message: '请提供非空的新功能名称，尚未创建对象。' };
  if (new RegExp('^' + prefix + '(?:(?:给|为)(?:它|当前功能))?(?:生成|创建)(?:一个|一份)?\\s*PRD[。！!]?$', 'i').test(text))
    return { kind: 'clarify', message: '请明确目标，例如：给功能“行车记录仪”生成PRD，或新建功能“碰撞报警”并生成PRD。也可使用下方PRD生成入口。' };
  return null;
}
export function normalizeFunctionName(name: string) { return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }

import type { PrdWork, UcWork } from "../features/workbench/model";
import { createUcSession } from "../features/uc/model";
import { createMockUc } from "./uc";
import { mockWait } from "./prd";

// Three distinct pending examples; not Agent output or accepted engineering requirements.
const scenarios = [
  {
    name: "正常触发流程",
    description: "验证在输入有效且触发条件满足时，功能完成预期操作并反馈结果。",
    preconditions: "1. 功能已启用且相关系统可用；\n2. 输入有效，满足正常触发条件（具体边界待确认）。",
    mainFlow: "1. 接收功能触发输入；\n2. 校验输入及运行条件；\n3. 执行预期功能动作；\n4. 反馈执行结果并结束本次流程。",
    postconditions: "正常：目标动作完成，执行结果可见。\n异常：转入异常处理，最终状态及反馈策略待确认。",
  },
  {
    name: "人工干预流程",
    description: "验证功能运行期间收到人工干预时，按约定处理控制权和退出反馈。",
    preconditions: "1. 功能正在运行；\n2. 人工干预输入可识别，优先级与退出条件待确认。",
    mainFlow: "1. 功能执行中接收到人工干预；\n2. 校验干预输入并判断处理条件；\n3. 根据待确认的控制权规则调整或终止当前动作；\n4. 反馈干预结果及当前状态。",
    postconditions: "正常：干预处理完成，控制权和功能状态明确。\n异常：维持或转入约定安全状态，策略待确认。",
  },
  {
    name: "异常退出流程",
    description: "验证运行期间关键输入失效或执行器故障时，功能进入异常处理并给出可见提示。",
    preconditions: "1. 功能已启用或正在运行；\n2. 检测到关键输入无效、执行器故障等异常（检测规则待确认）。",
    mainFlow: "1. 检测并记录异常；\n2. 判断是否允许继续执行；\n3. 按待确认策略中止或限制功能动作；\n4. 给出异常提示，恢复条件满足前不自动恢复未确认的动作。",
    postconditions: "正常：异常退出完成并给出状态提示。\n异常：安全状态、诊断记录及恢复策略待确认。",
  },
];

export function createMockUcBatch(project: string, source: PrdWork, taskId: string): UcWork[] {
  const prd = source.ucBatchSource ?? source.session.document;
  if (!prd || prd.status !== "accepted") throw new Error("批量用例生成需要已确认的 PRD。");
  return scenarios.map((scenario, index) => {
    const document = createMockUc(project, source.featureName, `${source.id}-${taskId}`, index);
    document.content = { ...document.content, ...scenario, name: `${source.featureName} · ${scenario.name}`,
      description: `${scenario.description}\n\n测试数据（Mock），需人工审阅。来源：${source.featureName} PRD v${prd.revision}。\n来源正文摘要：${prd.content.slice(0, 180)}`,
      actors: "用户 / 功能控制系统（角色划分待确认）",
    };
    return { id: document.id, kind: "UC", featureId: source.featureId, featureName: source.featureName,
      attachments: [], objectId: document.id, number: document.content.number, originalName: document.content.name,
      sourcePrdWorkId: source.id, session: createUcSession(document) };
  });
}
export async function requestMockUcBatch(project: string, source: PrdWork, taskId: string, signal: AbortSignal): Promise<UcWork[]> {
  await mockWait(signal, 1400);
  return createMockUcBatch(project, source, taskId);
}

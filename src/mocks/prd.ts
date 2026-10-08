import type { PrdDocument } from "../features/prd/model";

export const PRD_EXAMPLE = "帮我新建一个新功能：自动紧急制动AEB，能在城市工况下识别行人并自动刹车。";
export function expandMockPrompt(prompt: string): string {
  return `请根据以下原始需求生成或完善 PRD：\n${prompt.trim()}\n\n请说明用户目标、典型场景、功能边界、异常情况及验收思路。保留已有要求，不擅自补充性能参数；将未明确的信息标记为“待确认”。`;
}
export function mockFunctionName(prompt: string): string {
  if (/自动紧急制动|\bAEB\b/i.test(prompt)) return "自动紧急制动AEB";
  const named = prompt.match(/(?:新功能|功能)[：:\s]+[“「"]?([^\n，。,：:；;”」"]{2,36})/)?.[1]
    ?? prompt.match(/[“「"]([^”」"\n]{2,36})[”」"]/)?.[1];
  return named?.trim() || prompt.split(/[\n，。,]/)[0].trim().slice(0, 32) || "新功能";
}
const aebBody = `## 功能概述
在城市道路场景中识别行人碰撞风险，通过风险提示与自动制动辅助驾驶员，降低碰撞发生的可能性。具体性能与适用边界待确认。

## 目标与使用场景
关注行人横穿、遮挡后出现等典型场景；夜间、雨雾天气与不同路面条件的适用范围，需要进一步明确。

## 预期功能
- 识别前方行人及其相对运动趋势
- 判断碰撞风险，并以约定方式提示驾驶员
- 满足触发条件时发起制动请求并反馈状态
- 支持驾驶员干预；异常退出策略待确认

## 后续工作
确认 PRD 后，进入场景分析并生成 UC。以上章节仅为本次草稿示例，不限制 PRD 的自由文本结构。`;
export function generateMockPrd(project: string, prompt: string, previous: PrdDocument | null, id: string, featureName?: string): PrdDocument {
  const functionName = previous?.functionName ?? featureName ?? mockFunctionName(prompt);
  const content = previous ? `${previous.content}\n\n## 本次补充要求\n${prompt.trim()}\n\n具体实现边界与验收条件待确认。`
    : `# ${functionName}\n\n${/自动紧急制动|\bAEB\b/i.test(functionName) ? aebBody : `## 原始需求\n${prompt.trim()}\n\n## 功能目标\n围绕上述需求澄清用户目标、主要流程和功能边界。具体要求待确认。\n\n## 后续工作\n确认并确认 PRD 后，可继续用例生成。此草稿由本地模板生成，不代表 AI 推理结果。`}`;
  return { id: previous?.id ?? `${project}-prd-${id}`, functionName, content, revision: (previous?.revision ?? 0) + 1, status: "pending" };
}
export function mockWait(signal: AbortSignal, ms = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("操作已取消", "AbortError")); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException("操作已取消", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

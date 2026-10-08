import type { FrBatchRequest } from "../features/workbench/fr-generation";
import type { FrWork } from "../features/workbench/model";
import { createFrSession } from "../features/fr/model";
import { mockWait } from "./prd";

// Two reviewable examples per accepted UC. No Agent call or engineering inference.
export function createMockFrBatch(project: string, featureId: string, featureName: string, overviewId: string, request: FrBatchRequest): FrWork[] {
  if (!request.sources.length || request.sources.some(s => s.document.status !== "accepted")) throw new Error("所有来源 UC 必须已确认。");
  return request.sources.flatMap((source, index) => {
    const uc = source.document.content;
    const examples = [
      { name: "触发与流程处理", description: `系统应在「${uc.name}」规定的前置条件满足且输入有效时，按已确认用例的主事件流执行功能；不满足条件时不得误触发。\n前置条件参考：${uc.preconditions.slice(0, 200)}\n主流程参考：${uc.mainFlow.slice(0, 260)}` },
      { name: "结果反馈与异常处理", description: `系统应在「${uc.name}」执行结束或出现异常时反馈功能状态，并依据来源 UC 中的异常流程及后置条件完成处理。\n后置条件参考：${uc.postconditions.slice(0, 200)}\n交互参考：${uc.hmi.slice(0, 160)}` },
    ];
    return examples.map((example, offset) => {
      const serial = index * 2 + offset + 1, id = `${project}-fr-${request.id}-${serial}`;
      const number = `FR-${project}-${request.id.slice(-8).toUpperCase()}-${String(serial).padStart(3, "0")}`;
      const document = { id, featureName, revision: 1, status: "pending" as const, content: { id: number, source: uc.number, description: `${example.description}\n\nMock 测试需求，待人工审阅；具体阈值、时序、故障判据和验收指标待确认。` } };
      return { id, kind: "FR" as const, featureId, featureName, attachments: [], objectId: id, number, originalName: `${uc.name} · ${example.name}`, sourceOverviewId: overviewId, sourceUcWorkId: source.workId, session: createFrSession(document) };
    });
  });
}
export async function requestMockFrBatch(project: string, featureId: string, featureName: string, overviewId: string, request: FrBatchRequest, signal: AbortSignal): Promise<FrWork[]> {
  await mockWait(signal, 1400);
  return createMockFrBatch(project, featureId, featureName, overviewId, request);
}

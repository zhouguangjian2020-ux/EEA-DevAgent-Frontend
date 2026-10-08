import type { FrDocument } from "@/features/fr/model";
import type { FrOverviewWork } from "@/features/workbench/model";
import { createFrOverviewSession, createFrSession } from "@/features/fr/model";

const descriptions = [
  "系统识别前方碰撞风险，在满足触发条件时向驾驶员发出预警。",
  "系统根据目标距离、相对速度和车辆状态计算碰撞风险等级。",
  "当风险等级达到阈值时，HMI 以视觉方式提示驾驶员。",
  "当风险等级达到更高阈值时，HMI 以声音方式提示驾驶员。",
  "驾驶员采取制动操作后，系统更新当前风险状态并停止不必要的提示。",
  "驾驶员未及时响应时，系统进入下一阶段的安全干预策略。",
  "系统在车辆状态不满足条件时，不触发前方碰撞预警。",
  "系统检测到传感器数据无效时，保持安全状态并提示故障。",
  "系统应支持在车辆行驶过程中持续更新前方目标信息。",
  "系统应记录预警触发、解除及异常退出的关键事件。",
  "系统应支持根据项目配置调整预警触发阈值。",
  "系统应在预警结束后向驾驶员反馈当前功能状态。",
  "系统应为法规、性能和验收要求提供可追溯的需求来源。",
];

export function createMockFr(project: string, featureName: string, index: number, featureId = featureName): FrDocument {
  const number = `Fr-501-01-${String(index + 1).padStart(3, "0")}`;
  return { id: `${project}-${featureId}-fr-${index + 1}`, featureName, revision: 1, status: "pending", content: { id: number, source: "UC-501-01-04", description: descriptions[index] ?? "功能需求描述待补充。" } };
}

export function createMockFrOverview(project: string, featureId: string, featureName: string): FrOverviewWork {
  const docs = Array.from({ length: 13 }, (_, index) => createMockFr(project, featureName, index, featureId));
  return { id: `${project}-${featureId}-fr-overview`, kind: "FR_OVERVIEW", featureId, featureName, attachments: [], rows: docs.map(document => document.content), session: createFrOverviewSession(featureName) };
}

export function createFrWorks(project: string, featureId: string, featureName: string) {
  const overview = createMockFrOverview(project, featureId, featureName);
  const works = [overview, ...overview.rows.map((content, index) => ({ id: `${project}-${featureId}-fr-${index + 1}`, kind: "FR" as const, featureId, featureName, attachments: [], objectId: `${project}-${featureId}-fr-${index + 1}`, number: content.id, originalName: "功能需求", sourceOverviewId: overview.id, session: createFrSession({ id: `${project}-${featureId}-fr-${index + 1}`, featureName, revision: 1, status: "pending" as const, content }) }))];
  return { works, openId: overview.id };
}

export function updateMockFr(previous: FrDocument, prompt: string): FrDocument {
  return { ...previous, revision: previous.revision + 1, status: "pending", content: { ...previous.content, description: `${previous.content.description}\n\n本次补充要求（模拟记录）：${prompt.trim()}` } };
}

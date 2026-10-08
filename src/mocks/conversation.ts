import type { ConversationRequest, ConversationResponse } from "../features/conversation/model";
import { createPrdSession } from "../features/prd/model";
import { createUcSession } from "../features/uc/model";
import { expandMockPrompt, generateMockPrd, mockWait } from "./prd";
import { createMockUc } from "./uc";

// Explicit Mock adapter: no fetch, Agent API key or invented backend endpoint.
export async function requestMockConversation(r: ConversationRequest, signal: AbortSignal, fail = false): Promise<ConversationResponse> {
  await mockWait(signal, r.kind === "expand" ? 650 : 950);
  if (fail) throw new Error("模拟请求失败。输入与上下文已保留，可以重试。");
  if (r.kind === "expand") return { message: "提示词已扩写（模拟）", expandedPrompt: r.mode === "UC" ? `请根据所选功能已确认的 PRD，生成一个新的用例。

原始要求：${r.prompt}

保留上述全部要求，补充参与者、前置条件、主事件流、分支与异常流程的分析范围；不编造已确认的性能数值或法规结论。` : expandMockPrompt(r.prompt) };
  if (!r.mode) {
    const refs = r.references.length ? `\n\n本次引用：${r.references.map(o => `${o.functionName} / ${o.name}`).join("、")}。\n${r.references.map(o => `${o.name}：${o.summary.slice(0, 220)}${o.summary.length > 220 ? "…" : ""}`).join("\n")}` : "";
    return { message: `这是一条模拟回复，未调用真实 Agent。\n\n你的问题是：${r.prompt}\n\n可以从目标、使用场景、输入条件和异常边界四个方面继续梳理；实际专业分析需要后续接入 Agent。${refs}\n\n本次仅进行问答，不会修改或创建对象。` };
  }
  const featureId = r.featureId!, featureName = r.featureName!, id = `${r.projectId}-${r.mode.toLowerCase()}-${r.id}`;
  if (r.mode === "PRD") {
    const document = generateMockPrd(r.projectId, r.prompt, null, id, featureName);
    return { message: `已模拟生成「${featureName}」的 PRD，等待你审阅。产品工程与需求工程中的功能目录已同步建立。`, work: { id, kind: "PRD", featureId, featureName, attachments: [], ucTask: null, session: { ...createPrdSession(), rootName: featureName, document } } };
  }
  const document = createMockUc(r.projectId, featureName, r.id, 0);
  document.content.description = `${document.content.description}\n\n本次生成要求：${r.prompt}`;
  return { message: `已根据「${featureName}」已确认的 PRD 模拟生成 1 个新用例。已有用例保留，新用例尚未确认。`, work: { id, kind: "UC", featureId, featureName, attachments: [], objectId: document.id, number: document.content.number, originalName: document.content.name, sourcePrdWorkId: r.sourcePrd!.workId, session: createUcSession(document) } };
}

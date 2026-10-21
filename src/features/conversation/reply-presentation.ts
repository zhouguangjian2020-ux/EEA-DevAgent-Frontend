/** Display policy only. Persisted chat text and proposal registration remain unchanged. */
export type ConversationReplyPresentation =
  | { kind: "streaming" | "answer"; body: string }
  | { kind: "proposal"; body: string; count: number };

export const PROPOSAL_SUMMARY = "已生成{count}个对象的修改建议，请到对象标签页审查；生成时尚未保存，后续采纳状态以对象版本为准。";

function generatedSummary(count: number | string) {
  return PROPOSAL_SUMMARY.replace("{count}", String(count));
}

function previewSummary(count: number | string) {
  return "已准备" + count + "个对象的修改预览，生成时尚未保存或确认；请在对象标签页逐项审查，后续采纳状态以对象版本为准。";
}

/** Only the exact, count-matched pair emitted by our two server layers is redundant.
 * Quoted examples, fenced code, different counts, explanations and failures stay intact.
 */
function deduplicateApplicationSummary(body: string): string {
  const match = /^已生成([1-9]\d*)个对象的修改建议，请到对象标签页审查；生成时尚未保存，后续采纳状态以对象版本为准。\s*已准备\1个对象的修改预览，生成时尚未保存或确认；请在对象标签页逐项审查，后续采纳状态以对象版本为准。$/u.exec(body.trim());
  return match ? generatedSummary(match[1]) : body;
}

function isApplicationSummary(body: string, count: number): boolean {
  return [
    generatedSummary(count),
    previewSummary(count),
    "已生成对象修改建议；生成时尚未保存，后续采纳状态以对象版本为准。",
    "AI修改建议已生成，请在对象标签页审查后确认保存。",
  ].includes(body.trim());
}

export function conversationReplyPresentation(body: string, status: string, proposalCount = 0): ConversationReplyPresentation {
  // Selection and prompt keywords never classify intent. All unfinished text remains available.
  if (status === "running") return { kind: "streaming", body };
  const displayBody = status === "completed" ? deduplicateApplicationSummary(body) : body;
  if (status === "completed" && Number.isSafeInteger(proposalCount) && proposalCount > 0) {
    return { kind: "proposal", count: proposalCount, body: isApplicationSummary(displayBody, proposalCount) ? "" : displayBody };
  }
  // Ordinary answers, clarifications and failure diagnostics automatically become readable.
  return { kind: "answer", body: displayBody };
}

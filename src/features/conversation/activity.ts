/** Visible execution updates only; never merge them into the answer or Agent context. */
export type ConversationActivityEvent = {
  kind: "status" | "stage";
  stage?: string;
  title: string;
  body?: string;
};
export type ConversationActivityItem = ConversationActivityEvent & { sequence: number };
export type ConversationActivityRun = {
  startedAt: number;
  items: ConversationActivityItem[];
  sequence: number;
  truncated: boolean;
};
export const MAX_ACTIVITY_ITEMS = 80;
function clean(text: string, limit: number): string {
  const value = text.replace(/\p{Cc}/gu, character => character === "\n" || character === "\t" ? character : "").trim();
  return value.length > limit ? value.slice(0, limit - 1) + "…" : value;
}
export function startConversationActivity(startedAt: number): ConversationActivityRun {
  return { startedAt, items: [], sequence: 0, truncated: false };
}
export function appendConversationActivity(run: ConversationActivityRun, value: unknown): ConversationActivityRun {
  if (!value || typeof value !== "object") return run;
  const event = value as Record<string, unknown>;
  if ((event.kind !== "status" && event.kind !== "stage") || typeof event.title !== "string") return run;
  const title = clean(event.title, 240);
  if (!title) return run;
  const item: ConversationActivityItem = {
    kind: event.kind, title, sequence: run.sequence + 1,
    stage: typeof event.stage === "string" ? clean(event.stage, 120) : undefined,
    body: event.kind === "stage" && typeof event.body === "string" ? clean(event.body, 2000) : undefined,
  };
  const last = run.items.at(-1);
  if (last && last.kind === item.kind && last.title === item.title && last.stage === item.stage && last.body === item.body) return run;
  return {
    ...run, sequence: item.sequence,
    items: [...run.items, item].slice(-MAX_ACTIVITY_ITEMS),
    truncated: run.truncated || run.items.length >= MAX_ACTIVITY_ITEMS,
  };
}

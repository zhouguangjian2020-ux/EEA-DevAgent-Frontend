/** Safe, content-free measurements emitted for one assembled Agent request. */
export type ConversationContextUsage = {
  reference_bytes: number;
  limit_bytes: number;
  soft_limit_bytes: number;
  current_object_bytes: number;
  historical_object_bytes: number;
  dialogue_bytes: number;
  task_receipt_bytes: number;
  framing_bytes: number;
  current_object_count: number;
  historical_object_count: number;
  deduplicated_snapshot_count: number;
  compacted_response_count: number;
  near_limit: boolean;
};

const numericFields = [
  "reference_bytes", "limit_bytes", "soft_limit_bytes", "current_object_bytes",
  "historical_object_bytes", "dialogue_bytes", "task_receipt_bytes", "framing_bytes",
  "current_object_count", "historical_object_count", "deduplicated_snapshot_count",
  "compacted_response_count",
] as const;

/** Ignore malformed optional telemetry without breaking the answer or its preview. */
export function readConversationContextUsage(value: unknown): ConversationContextUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const result = {} as Omit<ConversationContextUsage, "near_limit">;
  for (const field of numericFields) {
    const number = data[field];
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) return null;
    result[field] = number;
  }
  if (!result.limit_bytes || !result.soft_limit_bytes || result.soft_limit_bytes > result.limit_bytes
    || result.reference_bytes > result.limit_bytes) return null;
  const subtotal = result.current_object_bytes + result.historical_object_bytes
    + result.dialogue_bytes + result.task_receipt_bytes + result.framing_bytes;
  if (subtotal !== result.reference_bytes || !Number.isSafeInteger(subtotal)) return null;
  // Never retain additional event properties such as raw prompts or object bodies.
  return { ...result, near_limit: result.reference_bytes > result.soft_limit_bytes };
}

export function contextKiB(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

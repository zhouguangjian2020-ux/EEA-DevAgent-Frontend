import type { TurnAttachment } from "@/features/workbench/workflow-api";

export type ConversationAttachmentItem = { id: string; revisionId?: string; kind?: string; name: string };
// Use the saved turn snapshot, never today's document title/version, to label history.
export function chatAttachmentItems(attachments: TurnAttachment[] = []): ConversationAttachmentItem[] {
  return attachments.filter(item => item && typeof item.artifact_id === "string").map(item => {
    const content = item.content;
    const heading = content?.markdown_body?.match(/^ {0,3}#{1,3}\s+(.+)$/m)?.[1]?.trim();
    const name = content?.name?.trim() || content?.description?.trim() || heading || item.number || item.artifact_id;
    return { id: item.artifact_id, revisionId: item.revision_id, kind: content?.kind,
      name: item.number && name !== item.number ? item.number + " · " + name : name };
  });
}

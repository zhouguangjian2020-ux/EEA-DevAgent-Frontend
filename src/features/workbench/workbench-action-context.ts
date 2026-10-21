import type { WorkbenchAction, WorkbenchStore } from "./model";
import type { WriteResult } from "./manual-api";

// Action modules share the hook's live refs; they never capture a render snapshot.
export interface WorkbenchActionContext {
  state: { current: WorkbenchStore };
  act(project: string, action: WorkbenchAction): void;
  workNotice(project: string, id: string, message: string): void;
}

export type WorkbenchPendingOperation = {
  controller: AbortController;
  id: string;
  kind: "prd-generation" | "PRD" | "UC" | "FR" | "children" | "fr-batch" | "uc-diagram" | "uc-review" | "fr-review" | "conversation";
};

export type WorkbenchWriteAttempt = { signature: string; id: string; result?: WriteResult };
export type WorkbenchOperations = { current: Map<string, WorkbenchPendingOperation> };
export type WorkbenchWrites = { current: Map<string, WorkbenchWriteAttempt> };

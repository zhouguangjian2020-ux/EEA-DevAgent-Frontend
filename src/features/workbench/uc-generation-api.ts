import { request } from "../../lib/api/client";

export const UC_GENERATION_SCENE = "FROM_PRD_CREATE_UC" as const;

export type UcGenerationInput = {
  prdId: string;
  prdRevisionId: string;
  clientRequestId: string;
};

export type UcGenerationCandidate = {
  candidate_id: string;
  ordinal: number;
  name: string;
  description: string;
  actors: string;
  preconditions: string;
  scenario: {
    main_flow: string;
    branches: string[];
    exceptions: string[];
  };
  postconditions: string;
  extensions: string;
  hmi: string;
  regulations: string;
  performance: string;
  nonfunctional: string;
};

export type UcGenerationResponse = {
  generation_id: string;
  scene: typeof UC_GENERATION_SCENE;
  status: "succeeded";
  source: {
    project_id: string;
    function_id: string;
    prd_id: string;
    prd_revision_id: string;
  };
  candidates: UcGenerationCandidate[];
  trace_id?: string | null;
};

/**
 * Send only the generation intent and immutable source identities.
 * The business backend remains responsible for reading the PRD and talking to Agent.
 */
export function requestUcGeneration(projectId: string, functionId: string, input: UcGenerationInput, signal?: AbortSignal) {
  return request<UcGenerationResponse>("/v1/agent/generations", {
    method: "POST",
    signal,
    headers: {
      "X-Project-Request": "1",
      "Idempotency-Key": input.clientRequestId,
    },
    body: JSON.stringify({
      scene: UC_GENERATION_SCENE,
      project_id: projectId,
      function_id: functionId,
      source: {
        kind: "PRD",
        artifact_id: input.prdId,
        revision_id: input.prdRevisionId,
      },
      client_request_id: input.clientRequestId,
    }),
  });
}


export const UC_DIAGRAM_SCENE = "FROM_UC_CREATE_UC_DIAGRAM" as const;

export type UcDiagramInput = {
  threadId?: string;
  knownUcSourceVersion?: string | null;
  clientRequestId: string;
};

export type UcDiagramResponse = {
  generation_id: string;
  scene: typeof UC_DIAGRAM_SCENE;
  status: "empty" | "unchanged" | "succeeded";
  source: { project_id: string; function_id: string; uc_count: number };
  source_version: string;
  diagram_format?: "mermaid" | null;
  diagram_code?: string | null;
  trace_id?: string | null;
};

export function requestUcDiagram(projectId: string, functionId: string, input: UcDiagramInput, signal?: AbortSignal) {
  return request<UcDiagramResponse>("/v1/agent/uc-diagram", {
    method: "POST",
    signal,
    headers: {
      "X-Project-Request": "1",
      "Idempotency-Key": input.clientRequestId,
    },
    body: JSON.stringify({
      scene: UC_DIAGRAM_SCENE,
      project_id: projectId,
      function_id: functionId,
      known_uc_source_version: input.knownUcSourceVersion ?? null,
      client_request_id: input.clientRequestId,
      ...(input.threadId ? { thread_id: input.threadId } : {}),
    }),
  });
}

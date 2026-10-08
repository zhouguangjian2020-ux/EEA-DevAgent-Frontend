export type User = {
  id: string;
  username: string;
  department: string;
  avatarUrl: string | null;
  canManageAccounts: boolean;
};

export type LoginResponse = { user: UserPayload };

type UserPayload = Omit<User, "avatarUrl" | "canManageAccounts"> & { avatarUrl?: string | null; avatar_url?: string | null; can_manage_accounts?: boolean };

function normalizeUser(payload: UserPayload): User {
  return {
    id: payload.id,
    username: payload.username,
    department: payload.department,
    avatarUrl: payload.avatarUrl ?? payload.avatar_url ?? null,
    canManageAccounts: payload.can_manage_accounts === true,
  };
}

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== "false";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

function errorMessage(body: unknown, status: number): { message: string; code?: string } {
  const detail = body && typeof body === "object" && "detail" in body ? body.detail : null;
  if (typeof detail === "string") return { message: detail };
  if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") {
    return { message: detail.message, code: "code" in detail && typeof detail.code === "string" ? detail.code : undefined };
  }
  // FastAPI validation arrays are not user-facing strings and may contain echoed input.
  return { message: status === 422 ? "字段校验未通过，请检查必填项、长度和来源。" : `请求失败（${status}）` };
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const error = errorMessage(await response.json().catch(() => null), response.status);
    throw new ApiError(error.message, response.status, error.code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function login(username: string, password: string) {
  return request<{ user: UserPayload }>("/v1/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }).then((response) => ({ user: normalizeUser(response.user) }));
}

export function getCurrentUser() {
  return request<UserPayload>("/v1/auth/me").then(normalizeUser);
}

export function logout() {
  return request<void>("/v1/auth/logout", { method: "POST" });
}
export type ProjectSummary = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  lock_version: string;
  created_at: string;
  updated_at: string;
  can_update?: boolean;
  can_delete?: boolean;
  can_manage_access?: boolean;
};

export type WorkspaceRevision = {
  revision_id: string;
  accepted_revision_id?: string | null;
  revision_no: string;
  status: "pending" | "accepted" | string;
  type_version_id: string;
  created_via: string;
  created_at: string;
};
export type WorkspacePrd = { id: string; lock_version?: string; can_delete?: boolean; code: string; revision: WorkspaceRevision; markdown_body: string; source: string };
export type WorkspaceUc = { id: string; lock_version?: string; can_delete?: boolean; code: string; revision: WorkspaceRevision; prd_revision_id: string; name: string; description: string; actors: string; preconditions: string; main_flow: string; branches: string[]; exceptions: string[]; postconditions: string; extensions: string; hmi: string; regulations: string; performance: string; nonfunctional: string };
export type WorkspaceFrSource = { uc_id: string; uc_code: string; uc_name: string; uc_revision_id: string; rationale: string | null };
export type WorkspaceFr = { id: string; lock_version?: string; can_delete?: boolean; code: string; revision: WorkspaceRevision; description: string; sources: WorkspaceFrSource[]; acceptance_criteria?: string };
export type WorkspaceSubsystem = { id: string; code: string; name: string; description: string; responsibility_in: string | null; responsibility_out: string | null; domain_group: string | null; is_allocatable: boolean; sort_order: number; design_version_id: string; design_version_no: number };
export type WorkspaceAllocationTarget = { subsystem_id: string; subsystem_name: string; subsystem_code: string; domain_group: string | null; rationale: string | null };
export type WorkspaceAllocation = { id: string; lock_version?: string; can_delete?: boolean; fr_id: string; fr_code: string; revision: WorkspaceRevision; fr_revision_id: string; design_version_id: string; design_version_no: number; note: string | null; targets: WorkspaceAllocationTarget[] };
export type WorkspaceFunction = { workflow_capabilities?: string[]; lock_version: string; can_update?: boolean; can_delete?: boolean; id: string; code: string; name: string; description: string | null; prd: WorkspacePrd | null; use_cases: WorkspaceUc[]; functional_requirements: WorkspaceFr[]; subsystems: WorkspaceSubsystem[]; fr_allocations: WorkspaceAllocation[]; can_create_prd?: boolean; can_create_uc?: boolean; can_create_fr?: boolean; accepted_use_cases?: WorkspaceFrSource[] };
export type ProjectWorkspace = { project: ProjectSummary; functions: WorkspaceFunction[]; read_only: boolean; can_create_function?: boolean; capabilities?: string[]; source: "database" | string };

export type DeletionKind = "project" | "function" | "PRD" | "UC" | "FR" | "FR_ALLOCATION";
export type DeletionTarget = {
  id: string;
  project_id: string;
  function_id?: string | null;
  kind: DeletionKind;
  code: string;
  name: string;
  lock_version: string;
  head_revision_id?: string | null;
  accepted_revision_id?: string | null;
};
export type DeletionBlocker = { id: string; kind: string; code: string; reason: string; reference_versions: string[] };
export type AllocationDeleteTarget = { subsystem_id: string; subsystem_code: string; subsystem_name: string; reference_versions: string[] };
export type DeletionImpact = {
  target: DeletionTarget;
  can_delete: boolean;
  blocked: boolean;
  blocker_count: number;
  blockers: DeletionBlocker[];
  blockers_truncated: boolean;
  allocation_fr_id?: string | null;
  allocation_targets: AllocationDeleteTarget[];
  history_preserved: true;
  checked_versions: string[];
};
export type DeleteResult = {
  mutation_id: string;
  project_id: string;
  function_id?: string | null;
  id: string;
  kind: DeletionKind;
  deleted: true;
  archived_at: string;
  lock_version: string;
  history_preserved: true;
};

export type ProjectList = {
  items: ProjectSummary[]; limit: number; offset: number; has_more: boolean;
  capabilities: { can_create: boolean };
};
export type CreateProjectInput = { creation_id: string; name: string; description: string | null };

export function getProjects(offset = 0, limit = 100) {
  return request<ProjectList>(`/v1/projects?limit=${limit}&offset=${offset}`);
}

export async function createProject(input: CreateProjectInput) {
  // Abort releases the UI, not a guarantee the server rolled back. Retry the same UUID.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return await request<ProjectSummary>("/v1/projects", {
      method: "POST", body: JSON.stringify(input), signal: controller.signal,
      headers: { "X-Project-Request": "1" },
    });
  } finally {
    clearTimeout(timer);
  }
}

export function getProjectWorkspace(projectId: string) {
  return request<ProjectWorkspace>(`/v1/projects/${encodeURIComponent(projectId)}/workspace`);
}
export type MetadataPatchInput = { mutation_id: string; base_lock_version: string; name?: string; description?: string | null };
export type FunctionSummary = ProjectSummary & { project_id: string };
export function getProject(projectId: string) {
  return request<ProjectSummary>("/v1/projects/" + encodeURIComponent(projectId));
}
async function patchMetadata<T>(path: string, input: MetadataPatchInput) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try { return await request<T>(path, { method: "PATCH", headers: { "X-Project-Request": "1" }, body: JSON.stringify(input), signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
export function updateProject(projectId: string, input: MetadataPatchInput) {
  return patchMetadata<ProjectSummary>("/v1/projects/" + encodeURIComponent(projectId), input);
}
export function updateFunction(projectId: string, functionId: string, input: MetadataPatchInput) {
  return patchMetadata<FunctionSummary>("/v1/projects/" + encodeURIComponent(projectId) + "/functions/" + encodeURIComponent(functionId), input);
}

export function getDeletionImpact(projectId: string, target: { kind: DeletionKind; id: string }) {
  const project = encodeURIComponent(projectId);
  const path = target.kind === "project"
    ? `/v1/projects/${project}/deletion-impact`
    : target.kind === "function"
      ? `/v1/projects/${project}/functions/${encodeURIComponent(target.id)}/deletion-impact`
      : `/v1/projects/${project}/artifacts/${encodeURIComponent(target.id)}/deletion-impact`;
  return request<DeletionImpact>(path, { signal: AbortSignal.timeout(30000) });
}

export async function deleteResource(projectId: string, target: { kind: DeletionKind; id: string }, mutationId: string, baseLockVersion: string) {
  const project = encodeURIComponent(projectId);
  const path = target.kind === "project"
    ? `/v1/projects/${project}`
    : target.kind === "function"
      ? `/v1/projects/${project}/functions/${encodeURIComponent(target.id)}`
      : `/v1/projects/${project}/artifacts/${encodeURIComponent(target.id)}`;
  const query = new URLSearchParams({ mutation_id: mutationId, base_lock_version: baseLockVersion });
  return request<DeleteResult>(`${path}?${query.toString()}`, { method: "DELETE", headers: { "X-Project-Request": "1" }, signal: AbortSignal.timeout(30000) });
}


export type BulkDeletionItem = { id: string; kind: Exclude<DeletionKind, "project"> };
export type BulkDeletionInput = { mutation_id: string; items: (BulkDeletionItem & { base_lock_version: string })[] };
export type BulkDeletionImpact = { total: number; can_delete: boolean; blocked: boolean; items: DeletionImpact[] };
export type BulkDeletionResult = { mutation_id: string; project_id: string; items: DeleteResult[]; deleted: true; history_preserved: true };
export function getBulkDeletionImpact(projectId: string, items: BulkDeletionItem[]) {
  return request<BulkDeletionImpact>(`/v1/projects/${encodeURIComponent(projectId)}/deletion-batch/impact`, {
    method: "POST", headers: { "X-Project-Request": "1" }, signal: AbortSignal.timeout(30000), body: JSON.stringify({ items: items.map(({ id, kind }) => ({ id, kind })) }),
  });
}
export function deleteResources(projectId: string, input: BulkDeletionInput) {
  return request<BulkDeletionResult>(`/v1/projects/${encodeURIComponent(projectId)}/deletion-batch`, {
    method: "POST", headers: { "X-Project-Request": "1" }, signal: AbortSignal.timeout(30000), body: JSON.stringify(input),
  });
}
export type Account = { id: string; login_name: string; display_name: string; department: string; state: "active" | "disabled" | string };
export type PermissionRole = { code: string; name: string; description: string | null };
export type ProjectMemberPermission = { user_id: string; login_name: string; display_name: string; department: string; state: string; project_state: string; role_code: string; role_name: string };
export type FunctionPermission = { user_id: string; login_name: string; display_name: string; department: string; role_code: string; role_name: string };
export type PermissionFunction = { id: string; code: string; name: string; permissions: FunctionPermission[] };
export type PermissionSettings = {
  project_id: string;
  project_name: string;
  can_manage: boolean;
  project_roles: PermissionRole[];
  function_roles: PermissionRole[];
  members: ProjectMemberPermission[];
  functions: PermissionFunction[];
};

export function getPermissionSettings(projectId: string) {
  return request<PermissionSettings>(`/v1/projects/${encodeURIComponent(projectId)}/permissions`);
}
export function getPermissionCandidates(projectId: string) {
  return request<{ items: Account[] }>(`/v1/projects/${encodeURIComponent(projectId)}/permission-candidates`);
}
export function upsertProjectMember(projectId: string, input: { user_id: string; role_code: string }) {
  return request<{ ok: boolean }>(`/v1/projects/${encodeURIComponent(projectId)}/members`, { method: "POST", headers: { "X-Project-Request": "1" }, body: JSON.stringify(input) });
}
export function removeProjectMember(projectId: string, userId: string) {
  return request<{ ok: boolean }>(`/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE", headers: { "X-Project-Request": "1" } });
}
export function upsertFunctionPermission(projectId: string, functionId: string, input: { user_id: string; role_code: string }) {
  return request<{ ok: boolean }>(`/v1/projects/${encodeURIComponent(projectId)}/functions/${encodeURIComponent(functionId)}/permissions`, { method: "POST", headers: { "X-Project-Request": "1" }, body: JSON.stringify(input) });
}
export function removeFunctionPermission(projectId: string, functionId: string, userId: string) {
  return request<{ ok: boolean }>(`/v1/projects/${encodeURIComponent(projectId)}/functions/${encodeURIComponent(functionId)}/permissions/${encodeURIComponent(userId)}`, { method: "DELETE", headers: { "X-Project-Request": "1" } });
}
export function getAccounts() { return request<{ items: Account[] }>("/v1/accounts"); }
export function createAccount(input: { login_name: string; display_name: string; department: string; password: string }) {
  return request<Account>("/v1/accounts", { method: "POST", headers: { "X-Project-Request": "1" }, body: JSON.stringify(input) });
}
export function updateAccount(userId: string, input: { display_name?: string; department?: string; state?: string }) {
  return request<Account>(`/v1/accounts/${encodeURIComponent(userId)}`, { method: "PATCH", headers: { "X-Project-Request": "1" }, body: JSON.stringify(input) });
}



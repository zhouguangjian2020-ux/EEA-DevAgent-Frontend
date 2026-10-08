import { ApiError, type ProjectSummary } from '../../lib/api/client';

const PROJECT_PARAMETER = 'project_id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A tab's URL identifies its project. No account/session credentials are persisted.
export function projectIdFromUrl(href: string): string | null {
  return new URL(href).searchParams.get(PROJECT_PARAMETER);
}

export function projectSelectionUrl(href: string, projectId: string): string {
  const url = new URL(href);
  if (projectId) url.searchParams.set(PROJECT_PARAMETER, projectId);
  else url.searchParams.delete(PROJECT_PARAMETER);
  return url.pathname + url.search + url.hash;
}

export async function resolveProjectSelection(
  requestedId: string | null,
  firstPage: ProjectSummary[],
  readProject: (id: string) => Promise<ProjectSummary>,
): Promise<{ project: ProjectSummary | null; unavailable: boolean }> {
  if (requestedId === null) return { project: firstPage[0] ?? null, unavailable: false };
  if (!UUID_PATTERN.test(requestedId)) return { project: null, unavailable: true };
  const id = requestedId.toLowerCase();
  const listed = firstPage.find(project => project.id.toLowerCase() === id);
  if (listed) return { project: listed, unavailable: false };
  try {
    // Absence from page one is not absence from the account's permitted projects.
    const project = await readProject(id);
    if (project.id.toLowerCase() !== id) throw new Error('项目读取结果与所选项目不一致，请重试。');
    return { project, unavailable: false };
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.status)) {
      return { project: null, unavailable: true };
    }
    // Authentication/network/server failures remain errors: never select a different project.
    throw error;
  }
}

import type { ModuleKey } from "../features/navigation/model";
import type { WorkspaceFolder } from "../features/workspace/tree";

export type TestFeature = { id: string; name: string };
// A selectable catalogue, not pre-created artifacts. Each project has independent IDs.
export function getTestFeatures(project: string): TestFeature[] {
  return ["A", "B", "C"].map(letter => ({ id: `${project}-test-feature-${letter.toLowerCase()}`, name: `测试功能 ${letter}` }));
}
// No seeded functions, PRDs, UCs, FRs or allocations in any workspace.
const emptyModules = (): Record<ModuleKey, WorkspaceFolder[]> => ({ product: [], requirements: [], architecture: [], development: [], test: [], safety: [] });
export const workspaceByProject: Record<string, Record<ModuleKey, WorkspaceFolder[]>> = { A: emptyModules(), B: emptyModules() };

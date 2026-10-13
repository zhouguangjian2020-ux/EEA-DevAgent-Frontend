import type { NavigationState } from "../navigation/model";
export type RevealKind = "PRD" | "UC" | "FR" | "FR分配";
export type RevealStep = "module" | "workspace" | "feature" | "category";
type Browse = { navigation: NavigationState; search: string; checked: string[]; folders: Record<string, boolean> };
export function revealFolderId(featureId: string, kind: RevealKind): string {
  return kind === "PRD" ? featureId + "-product" : featureId + "-" + kind + "-folder";
}
export function revealWorkspaceStep<T extends Browse>(state: T, featureId: string, kind: RevealKind, step: RevealStep, projectFeatureIds: readonly string[] = []): T {
  const primary = kind === "PRD" ? "product" : "requirements";
  const secondary = kind === "PRD" ? "PRD生成" : kind === "UC" ? "用例生成" : kind === "FR" ? "功能设计" : "功能分配";
  const featureFolder = featureId + "-" + primary, category = revealFolderId(featureId, kind);
  const folders = { ...state.folders };
  if (kind !== "PRD") {
    // Collapse explicit state AND function folders that are open by default.
    for (const id of Object.keys(folders)) folders[id] = false;
    for (const id of projectFeatureIds) {
      folders[id + "-requirements"] = false;
      folders[id + "-product"] = false;
    }
  }
  if (step === "module" || step === "workspace") { folders[featureFolder] = false; folders[category] = false; }
  if (step === "feature" || step === "category") folders[featureFolder] = true;
  if (step === "category") folders[category] = true;
  return { ...state, search: "", checked: [], folders, navigation: { ...state.navigation, primary, secondary,
    view: step === "module" ? "functions" : "workspace", expanded: { ...state.navigation.expanded, [primary]: true } } };
}

// Generation suggestions do not imply acceptance; navigation never saves data.
export function generatedOverviewAction(kind: RevealKind, featureId: string, featureName: string): import("./model").WorkbenchAction | null {
  if (kind === "UC") return { type: "open-panorama", kind: "UC_OVERVIEW", featureId, featureName };
  if (kind === "FR") return { type: "open-fr-overview", featureId };
  if (kind === "FR分配") return { type: "open-panorama", kind: "FR_ALLOCATION_OVERVIEW", featureId, featureName };
  return null;
}

export type PrimaryKey = "workbench" | "product" | "requirements" | "architecture" | "development" | "test" | "safety";
export type ModuleKey = Exclude<PrimaryKey, "workbench">;
export type SidebarView = "navigation" | "functions" | "workspace";

export const primaryItems: { key: PrimaryKey; label: string }[] = [
  { key: "workbench", label: "工作台" },
  { key: "product", label: "产品工程" },
  { key: "requirements", label: "需求工程" },
  { key: "architecture", label: "架构设计" },
  { key: "development", label: "开发工程" },
  { key: "test", label: "测试工程" },
  { key: "safety", label: "安全工程" },
];

export const secondaryItems: Record<PrimaryKey, string[]> = {
  workbench: [],
  product: ["PRD生成"],
  requirements: ["用例生成", "功能设计", "功能分配"],
  architecture: ["逻辑架构", "物理架构"],
  development: ["代码生成", "代码审查", "接口联调"],
  test: ["测试用例生成", "测试分析"],
  safety: ["安全分析", "风险评估"],
};

export type NavigationState = {
  view: SidebarView;
  primary: PrimaryKey;
  secondary: string | null;
  expanded: Partial<Record<ModuleKey, boolean>>;
};

export type NavigationAction =
  | { type: "toggle-expanded"; primary: ModuleKey }
  | { type: "enter"; primary: PrimaryKey; secondary?: string }
  | { type: "select-secondary"; secondary: string }
  | { type: "set-tab"; tab: "functions" | "workspace" }
  | { type: "back" };

export function createNavigationState(): NavigationState {
  return { view: "navigation", primary: "workbench", secondary: null, expanded: {} };
}

export function transitionNavigation(state: NavigationState, action: NavigationAction): NavigationState {
  switch (action.type) {
    case "toggle-expanded":
      return { ...state, expanded: { ...state.expanded, [action.primary]: !state.expanded[action.primary] } };
    case "enter":
      return {
        ...state,
        view: action.primary === "workbench" ? "navigation" : "functions",
        primary: action.primary,
        secondary: action.secondary && secondaryItems[action.primary].includes(action.secondary) ? action.secondary : null,
      };
    case "select-secondary":
      return secondaryItems[state.primary].includes(action.secondary)
        ? { ...state, view: "functions", secondary: action.secondary }
        : state;
    case "set-tab":
      return state.primary === "workbench" || state.view === "navigation" ? state : { ...state, view: action.tab };
    case "back":
      return { ...state, view: "navigation" };
  }
}

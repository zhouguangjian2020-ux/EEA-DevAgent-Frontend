import type { Account } from "@/lib/api/client";

export const initialMockAccounts: Account[] = [
  { id: "demo-engineer-01", login_name: "engineer01", display_name: "工程师01", department: "电子电气架构部", state: "active" },
  { id: "mock-engineer-02", login_name: "engineer02", display_name: "工程师02", department: "电子电气架构部", state: "active" },
  { id: "mock-reviewer-01", login_name: "reviewer01", display_name: "审查工程师", department: "系统工程部", state: "active" },
];

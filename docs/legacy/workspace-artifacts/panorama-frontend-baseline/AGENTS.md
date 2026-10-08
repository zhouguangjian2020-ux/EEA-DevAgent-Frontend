# Frontend Agent Rules

## Scope
- This repository implements the TS Agent frontend.
- Figma file `zJPTee4kYlALLVqOCp3Pai` is the visual source of truth.
-一期目标是可演示的交互式静态界面、真实登录/登出联调；暂不实现 Agent 能力。
- 中间工作区先使用占位区域，除非任务明确要求实现它。

## Architecture
- Use Next.js App Router and TypeScript.
- Page composition belongs in `src/components`; feature-specific logic belongs in `src/features`.
- API calls belong in `src/lib/api` or the related feature API module.
- Mock data belongs in `src/mocks` and must be replaceable by the generated API client.
- Do not introduce Redux, Zustand, XState, Turborepo, or a message queue without a concrete requirement.

## Figma and tokens
- Do not use screenshots as UI backgrounds.
- Use semantic tokens from `src/app/globals.css`; do not scatter hex colors in components.
- `docs/figma-tokens.md` is the mapping layer between Figma variables and CSS tokens. If Figma changes, update the mapping first, then the CSS values.
- Preserve the desktop target 1440x900 and exact copy `搜素对象文件···`.

## API and collaboration
- Backend OpenAPI is the source of truth.
- Generated API files are read-only and must not be edited manually.
- Use HttpOnly cookies; never store auth tokens in localStorage/sessionStorage.
- UI Agent edits only this repository. Do not modify backend files.

## Quality gate
Before marking a task complete:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- manually verify the affected flow
- update `docs/一期实施计划与进度.md`

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Tabs and object workspaces
- Before designing or implementing tabs, sidebar synchronization, object workspaces, or per-object AI sessions, read `docs/标签页与左侧导航交互规范.md`.
- Confirmed baseline: one tab per object; multiple business features per project; document, conversation, prompt draft, and attachments follow the active object tab.
- UC detail views must preserve the 12 fields and nested merged scenario structure specified in section 11 of that document.
- Do not treat design defaults, pending decisions, static mockups, or Figma prototype behaviors as implemented backend capabilities.

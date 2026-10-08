# Frontend Agent Rules

## Scope
- This repository implements the TS Agent frontend.
- Figma file `zJPTee4kYlALLVqOCp3Pai` is the visual source of truth.
- Current implementation includes local PRD/UC/FR/allocation workspaces and auth integration code; generation remains mocked. On 2026-09-21 the user supplied a deployed Agent endpoint; only PRD automatic expansion is now wired to it through the authenticated backend. Other generation remains mocked.
- Preserve the existing object workspaces. Do not treat the old placeholder-only scope or the proposed product MVP roadmap as authorization for new work.

## Documentation
- Start with `E:/Git projects/TS-frontend/docs/current/README.md`. `E:/Git projects/TS-frontend/docs/legacy` preserves historical evidence, not active instructions or implementation status.
- Distinguish confirmed requirements, source-code facts, implementation defaults, and unresolved decisions. Do not promote proposals to deployed capabilities.

## Architecture
- Use Next.js App Router and TypeScript.
- Page composition belongs in `src/components`; feature-specific logic belongs in `src/features`.
- API calls belong in `src/lib/api` or the related feature API module.
- Mock data belongs in `src/mocks` and must be replaceable by the generated API client.
- Do not introduce Redux, Zustand, XState, Turborepo, or a message queue without a concrete requirement.

## Figma and tokens
- Do not use screenshots as UI backgrounds.
- Use semantic tokens from `src/app/globals.css`; do not scatter hex colors in components.
- `E:/Git projects/TS-frontend/docs/current/07_Figma与样式映射.md` is the mapping layer between Figma variables and CSS tokens. If Figma changes, update the mapping first, then the CSS values.
- Preserve the desktop target 1440x900 and exact copy `搜素对象文件···`.

## API and collaboration
- Backend OpenAPI is the source of truth.
- Generated API files are read-only and must not be edited manually.
- Use HttpOnly cookies; never store auth tokens in localStorage/sessionStorage.
- UI-only tasks edit this repository. The user explicitly authorized paired backend/frontend edits for one PRD expansion endpoint on 2026-09-21; do not extend that authorization to other APIs or Agent source.

## Quality gate
Before marking a task complete:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- manually verify the affected flow
- update `E:/Git projects/TS-frontend/docs/current/06_工程维护与验证记录.md`

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Tabs and object workspaces
- Before designing or implementing tabs, sidebar synchronization, object workspaces, or project-level AI conversations, read `E:/Git projects/TS-frontend/docs/current/02_前端交互规范.md`.
- Confirmed baseline: one tab per object; multiple business features per project; object documents and edit drafts follow object tabs, but conversation, composer draft, attachments and chat requests are project-scoped and never switch with tabs (confirmed 2026-09-21).
- UC detail views must preserve the 12 fields and nested merged scenario structure specified in section 7 of that document.
- Do not treat design defaults, pending decisions, static mockups, or Figma prototype behaviors as implemented backend capabilities.


## Frontend interaction contract
- Before adding, changing, or removing a UI interaction, read `E:/Git projects/TS-frontend/docs/current/02_前端交互规范.md` first. It is the unified component interaction contract; latest user-confirmed entries supersede older design defaults.
- Update that document and relevant tests in the same change as the component. Mark unspecified rules as pending; do not invent subsystem detail/edit behavior.
- Panorama workspaces must not overwrite unrelated shell or existing PRD/UC/FR detail designs. UC diagram is derived and read-only; only searchable subsystem selectors are editable in FR allocation.


## 2026-09-22 project-read authorization

- User explicitly authorized reuse/rename of the existing sample project to 测试项目1, its only function to 行车记录仪DVR, and backend project READ endpoints with tests. Reuse the deployed ee.projects table; no C/U/D API, no new business tables, no Agent changes.
- Backend edits for this scope and shared frontend progress/runbook documentation are authorized; frontend workspaces/generated clients are not being changed in this task. Company SQL remains user-executed through the reviewed independent package, not automatic SSH/restarts.


## 2026-09-22 project-create authorization (supersedes earlier READ-only project scope)

- User confirmed one empty-project creation flow in the switcher, POST /v1/projects and a list capability. Paired frontend/backend edits and isolated PostgreSQL testing are authorized.
- Reuse existing projects, project_members, access_bindings, project_subsystem_designs and security_audit_events; no new business tables, no project update/delete, no content generation or copying.
- Keep ee_project_api_ro SELECT-only. A separately provisioned INSERT service role is required; company operations remain user-executed through a new reviewed package, never automatic SSH. Frozen packages must not change.

## 2026-09-23 manual-work authorization

- User approved paired frontend/backend function, PRD, UC and FR manual creation, draft editing/saving and explicit acceptance under existing R2 rules. Reuse existing tables and the single ee_project_api_create writer; ee_project_api_ro stays SELECT-only.
- Existing frozen database packages remain unchanged. Company database operations remain user-executed from a reviewed incremental package; isolated local PostgreSQL tests are authorized.


## 2026-09-24 writer-rename and company-operation boundary

- User confirmed in-place rename ee_project_api_create -> ee_project_api_rw; two shared API logins (ro/rw), not one per feature/project. Preserve frozen packages and credentials; reject incompatible password formats before rename.
- Do not directly connect to company databases, SSH into company servers, or execute company migrations. Provide reviewed step-by-step commands for the user, starting with read-only inspection and waiting for its output before writes. Disposable local PostgreSQL and local browser tests remain authorized.

## 2026-09-28 staged CRUD authorization — stage 1 only

- User approved the five-stage CRUD plan and explicitly said “开始”. Stage 1 authorizes paired frontend/backend project/function metadata editing, read capabilities and version tokens, confirmed terminology, focused tests and an independent minimal SQL grant increment. Reuse existing tables, ro/rw logins and project author/reader boundaries; do not develop permission administration.
- Nonempty-project deletion is forbidden; historical-reference deletion checks cover current head and accepted versions, not only older history. These rules are confirmed for later stages, NOT authorization to implement deletion in stage 1.
- Complete implementation, local isolated PostgreSQL/browser verification and documentation for stage 1, then STOP and report for user acceptance. Do not start stage 2 until the user explicitly accepts stage 1. No company database/SSH/deployment, and frozen packages must remain unchanged.

## 2026-09-28 staged CRUD authorization — stage 2 only

- User explicitly accepted stage 1 and authorized the next stage. Stage 2 covers backend single-object deletion/impact, active head+accepted references, concurrency/ancestor validation, active-PRD uniqueness and new-ID recreation, minimal independent SQL and focused read metadata/tests. Project/function/content edits from stage 1 remain supported.
- Do not implement sidebar delete UI (stage 3), bulk delete APIs/UI (stage 4), restore/recycle bin, permissions administration or new Agent flows. Complete stage 2, verify in disposable local databases and STOP for user acceptance.
- Existing local manual preview stays separate; do not migrate its database or stop it implicitly. No company DB/SSH/deployment. All previously delivered SQL packages, including metadata-edit-20260928, remain unchanged.

## 2026-09-28 staged CRUD authorization — stages 3 and 4 together

- User explicitly started stage 3, then authorized continuing directly into stage 4 for joint acceptance. This supersedes the stage-2 stop rule only for sidebar single deletion, truthful allocation navigation/UI synchronization, and explicit-selection atomic batch deletion with focused local tests. Stop after stage 4; stage 5 is NOT authorized.
- Do not update `E:/Git projects/TS-frontend/docs/current/25_工作交接_项目功能PRD_UC_FR_CRUD_20260928.md`. Maintain current interaction, progress and verification documents instead.
- Keep the original local acceptance services (3000/8000/56430) untouched. Use isolated disposable databases or separate stage-3/4 preview ports. No company database, SSH, deployment, credential changes or edits to frozen SQL packages. No restore/recycle bin, permission administration, complete allocation CRUD or new Agent flows.


## 2026-09-28 staged CRUD authorization — stage 5

- User explicitly continued with “第五部分，继续” on 2026-09-28. This supersedes the prior stage-3/4 stop rule and authorizes stage 5 only: full local/isolated CRUD regression, browser/API verification, SQL package/hash/rollback-boundary review, and current execution-package documentation.
- Keep the confirmed scope: project/function/PRD/UC/FR and FR-allocation deletion behavior, dependency guards, active head/accepted reference checks, PRD delete-then-new-ID creation, batch atomicity and failure recovery. Do not count complete FR-allocation create/edit/accept CRUD as implemented.
- Do not connect to company databases, SSH, deploy, restart company services, change company credentials/configuration/bindings, modify frozen SQL packages, add permission administration, add restore/recycle-bin UI, or add new Agent flows. The user executes company materials and returns safe receipts for review.
- Do not modify `E:/Git projects/TS-frontend/docs/current/25_工作交接_项目功能PRD_UC_FR_CRUD_20260928.md`. Stage 5 ends after the local/isolated evidence and documentation are delivered; stop and wait for final user acceptance.

## Company frontend release gate (2026-10-02)

- Before supplying or changing company frontend deployment commands, read E:/Git projects/TS-frontend/docs/current/公司前端发布必读_20261002.md and the current release DEPLOY.md. Do not rely on chat memory or generic Docker examples.
- For the known 192.168.64.3 frontend build, preserve the receipt-validated --network=host --pull=false options unless a replacement network setup is explicitly verified. Runtime host networking does not imply build host networking.
- New checksum manifests must be UTF-8 without BOM and LF-only; validate raw archive bytes and the delivered checksum command. Do not silently overwrite a delivered archive or its hash.
- Track upload/checksum/build/cutover/browser acceptance separately. Company operations remain user-executed; preserve actual container environment privately and retain rollback containers/images.

- Container comparison tests must cover started-old versus created-new fixtures. For OomKillDisable only, null/default and boolean false are equivalent; true differences and invalid non-boolean values must still fail. Do not broadly normalize other fields. Explicit resume must revalidate the existing never-started target, image identity, environment, and all configuration before stopping the old service.

## Complete company command delivery (2026-10-04 user requirement)

- When asking the user to upload, inspect, deploy or verify on the company server, provide complete copy-paste-ready commands in the response. Do not provide only a script invocation/file path, omit variables, or ask the user to construct commands.
- For uploads, include the real local file paths, destination account/host/port/directory, checksum validation, SSH directory creation, SCP command and failure handling. State clearly whether the block runs in Windows PowerShell or Ubuntu Bash.
- Reviewed script files remain the implementation, but every user-facing transfer/execution step must be fully spelled out. No placeholders when the actual values are known; do not overwrite existing incoming directories silently.


## Local user acceptance before company release (2026-10-04)

- For every new feature/fix release: implement and debug locally, run local integration checks, provide a runnable local preview with complete commands, obtain the user's explicit local hands-on acceptance, and only then prepare company deployment. Automated tests, contract mocks and health checks do not substitute for this user gate.
- Record the exact version and user's local acceptance receipt; do not carry approval from an older build to newly changed behavior. No new company cutover instructions without that gate, unless the user explicitly authorizes a documented exception.
- Current exception is narrow: the user approved continuing acceptance of the ALREADY deployed workflows-r2 version while deferring UI changes. Do not deploy new changes, alter preview write policy or initialize a catalogue under that exception.
- Deferred requirements: remove the question/modify operation selector without losing modification previews; put My Conversations at the top of the conversation panel. Record now and implement in the next local change round, not as an unapproved live patch.

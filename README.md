# 天枢 EE 开发平台 · Frontend

Next.js / React / TypeScript 应用代码仓库。

## 代码与构建

- `src/`：页面、组件、业务逻辑和 API 客户端。
- `public/`：应用使用的图片、LOGO、字体及模型等资源。
- `package.json`、`pnpm-lock.yaml`、构建配置与 `Dockerfile` 保留。
- 本地安装和检查：`pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm typecheck`。
- 本地开发：`pnpm dev`。生产构建：`pnpm build`。
- `.env.example` 仅为公开模板，实际 `.env.local` 不进入 Git。

## 2026-10-09 资料分离

文档、测试、浏览器验证脚本、历史发布材料和验证产物保存在本机：
`E:\Git projects\EEA-DevAgent-support-20261009\TS-frontend`

测试文件不再随本代码仓库推送，因此移除了指向 `tests/*.test.mjs` 的 `pnpm test` 入口。
测试没有删除；重新使用时需要在隔离工作目录恢复测试及依赖资料的原目录关系。

此次整理不是应用功能修改或新部署。公司当前候选为 `20261009-workflows-rc1`，完整业务验收仍未完成。
历史操作与发布回执应从外置资料读取；不要把历史命令直接视为当前部署指令。

注意：从工作区移出文件不会清除 Git 历史；推送现有历史仍可能包含以前提交过的文档和测试。
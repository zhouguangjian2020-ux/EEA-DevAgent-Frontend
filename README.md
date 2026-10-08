# 天枢 EE 智能开发平台前端

## FR生成、分配闭环与项目私有多会话

本轮源代码已实现，未修改公司部署。需求：[45](<E:/Git projects/TS-frontend/docs/current/45_FR生成_FR分配_项目多会话_开发需求规格.md>)；契约：[46](<E:/Git projects/TS-frontend/docs/current/46_FR与项目对话_接口契约及Agent联调.md>)；联合验收与后续部署边界：[47](<E:/Git projects/TS-frontend/docs/current/47_FR生成_FR分配_项目多会话_联合交付与验收.md>)。下方带日期内容保留历史语境，以47号本批次记录为准。


当前工程：`E:\Git projects\TS-frontend`。使用 Next.js App Router、React 与 TypeScript。

## 2026-09-24 账号改名r2与公司操作边界

本地改名迁移、权限负向、原接口和浏览器回归已通过；公司数据库尚未执行，助手不得直接访问。当前唯一下一步是用户运行只读检查并回传。完整独立交接与分阶段指令见[22 数据库账号改名与一期迁移交接](docs/current/22_数据库账号改名与一期迁移交接_20260924.md)。

## 文档入口

- [整理后的现行文档](<E:/Git projects/TS-frontend/docs/current/README.md>)
- [项目现状与有效需求基线](<E:/Git projects/TS-frontend/docs/current/01_项目现状与有效需求基线.md>)
- [前端交互规范](<E:/Git projects/TS-frontend/docs/current/02_前端交互规范.md>)
- [冲突与待确认清单](<E:/Git projects/TS-frontend/docs/current/05_冲突清单与待确认事项.md>)
- [历史文档归档](<E:/Git projects/TS-frontend/docs/legacy/README.md>)

## 当前能力边界

已有对象工作台、共享功能全景及手动功能/PRD/UC/FR创建、编辑保存、显式接受，已通过真实隔离数据库链路。项目对话/未保存草稿仍是内存态。数据库模式下，UC 生成已通过业务后端返回只读候选（不自动保存/确认）；UC 全景已接入后端图请求的打开/刷新、状态和 Mermaid 安全文本预览，图形渲染仍暂缓。其他普通问答、PRD/UC/FR对象生成仍有 Mock 边界。公司环境的此次写入增量尚未部署，详见[21 实现与部署](docs/current/21_手动功能PRD_UC_FR实现与部署.md)。

2026-09-21 已接入真实Agent能力：PRD 自动扩写，经已登录业务后端转接 ONE_CLICK_EXPAND；输入框渐进回填。2026-09-30 又接入 UC 生成候选与 UC 图业务后端桥接，但不把候选当正式 UC，也未在前端执行 Mermaid。原 8000 后端已按用户再次授权重启，正常 3000 → 8000 → Agent 链路已验证成功，详见[接口联调记录](<E:/Git projects/TS-frontend/docs/current/10_PRD自动扩写接口联调.md>)。

## 本地开发

在工程目录按现有 package.json 脚本执行；运行前参阅公开环境示例及工程文档，不将私密环境配置写入文档或提交。

```powershell
Set-Location -LiteralPath 'E:\Git projects\TS-frontend'
pnpm dev
```

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

本地认证配置与 Agent 部署配置不是同一件事，详见[工程维护说明](<E:/Git projects/TS-frontend/docs/current/06_工程维护与验证记录.md>)。本项目路由当前为 `/`、`/login`，对象工作台为首页内视图。

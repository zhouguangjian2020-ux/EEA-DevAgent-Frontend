# 历史文档归档（legacy）

> 归档日期：2026-09-20。仅作历史证据，不是当前开发入口。  
> 当前结论请阅读 [current 总入口](<E:/Git projects/TS-frontend/docs/current/README.md>)。

## 1. 归档范围

| 原位置 | 现位置 | 处理 |
|---|---|---|
| `E:\Git projects\TS-frontend\docs` 的原有全部内容 | [frontend-docs](<E:/Git projects/TS-frontend/docs/legacy/frontend-docs>) | 整体移动，内部目录和原文保留 |
| 桌面工作区 `artifacts\agent-review` | [Agent 评估](<E:/Git projects/TS-frontend/docs/legacy/workspace-artifacts/agent-review>) | 整体移动 |
| 桌面工作区 `artifacts\ai-service-analysis-2026-09-20` | [Agent 源码分析及离线探测](<E:/Git projects/TS-frontend/docs/legacy/workspace-artifacts/ai-service-analysis-2026-09-20>) | 整体移动，探测代码仅作证据，不自动运行 |
| 桌面工作区 `artifacts\product-plan` | [产品路线](<E:/Git projects/TS-frontend/docs/legacy/workspace-artifacts/product-plan>) | 整体移动 |
| 桌面工作区 `artifacts\panorama-frontend-baseline` | [历史前端备份](<E:/Git projects/TS-frontend/docs/legacy/workspace-artifacts/panorama-frontend-baseline>) | 整体移动；含旧源码快照，不是当前业务源码 |
| 根目录旧 README / AGENTS | [frontend-root](<E:/Git projects/TS-frontend/docs/legacy/frontend-root>) | 原样快照；根目录现行入口另行更新 |

桌面工作区完整根路径为 `C:\Users\zhouguangjian\Documents\ChatGPT\EE AGENT FRONTEND`。每个文件的完整旧路径和新路径都记录于[归档清单](<E:/Git projects/TS-frontend/docs/legacy/归档清单.json>)。

## 2. 完整性

共 85 个既有文件：83 个移动 + 2 个根入口快照（按原始文件计数）。其中历史前端备份的 10 个源码/测试文件保存在 `E:\Git projects\TS-frontend\docs\legacy\workspace-artifacts\panorama-frontend-baseline\source-snapshot.zip` 内，ZIP 保留原文件名及目录；同时保留增加 `.archived` 后缀的原样展开副本，以免被当前工程编译。迁移前计算每个文件字节数及 SHA-256，迁移后逐项核对。原文不作路径替换、纠错或格式重排，确保历史证据没有被整理过程改写。

旧文档配套的 PNG、SVG、Mermaid、JSON、文本记录以及本次涉及的离线探测脚本均随所属目录保留。无删除原内容，不覆盖同名历史文件。

## 3. 如何查阅

- 旧文档中的绝对路径可能已失效；根据归档清单的 `original_path` 查找 `archive_path`。`storage=zip` 时再使用 `archive_entry` 定位包内原文件，`expanded_copy_path` 是非编译展开副本。
- 同目录相对引用保持原有目录关系；旧稿跨目录的历史引用不保证可直接点击。
- 原文“当前”“最新”“已实现”只代表当时记录，不能覆盖 current 的现状说明。
- V1.0 是被替代方案；V1.1 与 V1.2 中的技术建议仍需后续评审、迁移与验收，不是已执行状态。
- 此目录中的 AGENTS.md 属历史备份，不是当前工程工作指令。不要以历史源码快照替换当前源码。
- 安装命令、SQL、旧探测脚本均不可因存在于归档而自动执行；执行前须重新确认环境、路径、版本和用户任务范围。

## 4. 本轮未迁移的内容

当前前端业务源码、运行配置、依赖、构建产物和非文档 QA 产物；其他工程；Downloads 原始外部资料；桌面工作区的封面、团队介绍、概念图及无关设计产物。这些不属于此前阅读的项目文档集合，本轮保持不动。


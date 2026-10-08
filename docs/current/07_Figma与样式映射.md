# 07 Figma 与样式映射

> 整理日期：2026-09-20。来源为本地样式和已归档设计记录；2026-09-20 归档轮未修改 CSS；2026-09-21 新增项目对话局部样式，仍未访问或改动 Figma 在线文件。  
> 本文替代旧 token/map 文档的活动入口；历史节点 ID 仅是历史定位证据，不宣称在线仍未变化。

## 1. 设计边界

- 工程登记的 Figma file key 为 `zJPTee4kYlALLVqOCp3Pai`。
- 历史设计只用于视觉参考，用户最新明确要求与现行交互规范优先。
- 桌面目标保持 1440×900；不得用整页截图作 UI 背景。
- Figma Page 不是路由或业务对象；原型能点击不代表后端有接口。
- 局部全景改动不覆盖既有壳层和 PRD / UC / FR 详情。

## 2. 当前基础语义映射

以下 token 在 [globals.css](<E:/Git projects/TS-frontend/src/app/globals.css>) 中定义；颜色值以代码为准，不在文档复制第二套随时漂移的色板。

| 设计语义 | CSS token | 用途 |
|---|---|---|
| surface | `--ee-surface` | 顶栏、侧栏、卡片表面 |
| canvas | `--ee-canvas` | 画布及部分输入背景 |
| sidebar | `--ee-sidebar` | 侧栏背景 |
| text | `--ee-text` | 主文本 |
| muted | `--ee-muted` | 次级文本 |
| subtle | `--ee-subtle` | 弱提示 |
| border | `--ee-border` | 描边、分隔线 |
| primary | `--ee-primary` | 主操作与选中态 |
| tint | `--ee-primary-soft` | 主色浅底 |
| success / green | `--ee-success` | 成功 |
| danger | `--ee-danger` | 错误、危险操作 |
| shadow | `--ee-shadow` | 浮层阴影 |
| 基础间距 | `--ee-space-1`～`--ee-space-5` | 4、8、12、16、24px |
| 基础圆角 | `--ee-radius-sm` / `--ee-radius-md` | 8 / 12px |

上表是基础映射，不是所有组件局部 token 的穷举。Light / Dark 使用同一语义名称；新增颜色或布局值前先查当前代码，不把历史 Figma 变量 ID 当作新增全局 token 的理由。

## 3. 保留的视觉约束

- PRD 阅读卡片不改变整份正文的编辑和接受范围；不恢复独立“需要进一步确认”卡片。
- UC 保持真实表格和合并场景层级；内容长时扩高，必要时表格自身横向滚动；字体回退在目标环境验证。
- FR 的编号、来源、描述使用中性色，不恢复历史样例红黄蓝强调。
- UC 图由当前数据派生；参与者等图形可使用原始 SVG/样式，不用整页位图替代结构。
- 分配表四列随同一表格滚动，长文本保持完整；下拉避免被容器裁切。
- 精确保留现有搜索文案 `搜素对象文件···`，未经要求不顺便改字。

## 4. 后续设计同步

先确认语义和交互影响 → 更新本映射及交互规范 → 调整样式/组件 → 运行工程门禁 → 验收相关页面及主题。若设计节点重命名或迁移，记录实际核对过的新节点，而非复制旧稿“当前已完成”的说明。

## 5. 历史证据

- [原 figma-map](<E:/Git projects/TS-frontend/docs/legacy/frontend-docs/figma-map.md>)
- [原 figma-tokens](<E:/Git projects/TS-frontend/docs/legacy/frontend-docs/figma-tokens.md>)
- [原设计说明与校验产物目录](<E:/Git projects/TS-frontend/docs/legacy/frontend-docs/design-review>)
- [当前全景局部样式](<E:/Git projects/TS-frontend/src/components/panorama/panorama.css>)

旧设计文档中的阶段描述、示例内容和“仅设计侧”状态属于相应日期，不是当前工程是否已实现的依据。

## 6. 2026-09-21 项目级对话布局

局部样式：`E:\Git projects\TS-frontend\src\components\workbench\project-conversation.css`。复用现有语义颜色、圆角、阴影；工作台中央最大宽 820px；对象页右侧对话宽 368px，较窄桌面收至 320px。消息区独立滚动，输入固定在本对话底部；同一 DOM 对话在两种布局间切换。正文审阅操作移回对象区，不改 UC 12 字段及分配表可编辑范围。

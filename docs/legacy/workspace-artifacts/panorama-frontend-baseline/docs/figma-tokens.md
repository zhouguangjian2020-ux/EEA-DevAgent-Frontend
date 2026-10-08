# Figma Token Mapping

## 目的

前端不直接复制 Figma 的散落颜色值，而是通过语义 Token 建立一层稳定的映射。这样后续 Figma 调整颜色、深色模式或间距时，只需更新本文件和 `src/app/globals.css` 的变量值，不需要逐个修改组件。

## 当前映射

| Figma 语义 | CSS Token | 用途 |
|---|---|---|
| surface | `--ee-surface` | 顶部、侧栏、卡片背景 |
| canvas | `--ee-canvas` | 页面主画布、输入框背景 |
| sidebar | `--ee-sidebar` | 侧栏专用背景，保留扩展位 |
| text | `--ee-text` | 主文本 |
| muted | `--ee-muted` | 次要文本 |
| subtle | `--ee-subtle` | 占位、提示和弱分隔 |
| border | `--ee-border` | 描边和分割线 |
| primary | `--ee-primary` | 主操作、选中态 |
| tint | `--ee-primary-soft` | 主色浅底、选中背景 |
| green | `--ee-success` | 成功状态 |
| danger | `--ee-danger` | 退出登录和错误状态 |

## 稳定性规则

1. Figma 变量名称可以变化，但语义名称不能随意变化。
2. 组件只能使用语义 Token，不得直接写 `#xxxxxx`。
3. Light/Dark 必须在同一组 Token 下提供值。
4. 新增颜色前先确认是否能复用现有语义 Token。
5. 布局尺寸优先使用 `--ee-space-*` 和 `--ee-radius-*`，特殊值需要在组件旁说明原因。
6. Figma 页面或组件重命名时，同时更新 `docs/figma-map.md`，不要只改代码。

## Figma 更新后的同步流程

```text
Figma 修改
  ↓
确认变量/样式语义是否变化
  ↓
更新本文件的映射
  ↓
更新 globals.css 的 Light/Dark 值
  ↓
运行 lint/typecheck/build
  ↓
执行对应页面冒烟验收
```

## 当前限制

历史连接曾有上游限流；2026-09-14 已恢复 MCP 读取和写入，并完成 PRD 首稿。旧实现映射保留，新增变量记录见下节。


## 2026-09-14 PRD 首稿变量

颜色集合：EE / Current frontend（VariableCollectionId:326:1229），含 Dark / Light；沿用当前 globals.css 的对应值，未改业务 CSS。

| Figma 变量 | ID | 对应代码 / 说明 |
|---|---|---|
| surface | VariableID:326:1230 | --ee-surface |
| canvas | VariableID:326:1231 | --ee-canvas |
| sidebar | VariableID:326:1232 | --ee-sidebar |
| text | VariableID:326:1233 | --ee-text |
| muted | VariableID:326:1234 | --ee-muted |
| subtle | VariableID:326:1235 | --ee-subtle |
| border | VariableID:326:1236 | --ee-border |
| primary | VariableID:326:1237 | --ee-primary |
| tint | VariableID:326:1238 | --ee-primary-soft |
| success | VariableID:326:1239 | --ee-success |
| danger | VariableID:326:1240 | --ee-danger |
| amber | VariableID:326:1241 | 待处理语义；Dark #e5b96b / Light #946b22，设计侧新增 |
| amberTint | VariableID:326:1242 | 待处理底色；Dark #332b20 / Light #fff5df，设计侧新增 |

间距、圆角、字号集合：EE / Layout and type（VariableCollectionId:345:1508）。space/4、8、12、16、24 分别映射 --ee-space-1～5；radius/8、12 分别映射 --ee-radius-sm、md。额外数值保留在设计侧，不自动扩充 CSS。主画布与区域宽高为固定 1440×900 评审约束，非响应式实现承诺。

原型变量集合 EE / PRD prototype（VariableCollectionId:326:1243）仅用于 Figma 演示：prompt、reviewStatus、hasDraft、draftOverview，不是后端持久化字段。

## PRD 前端落地（2026-09-14）

本轮实现按同一个 PRD 会话的状态切换空/输出布局，而非根据 Figma 页创建路由。补充以下语义 token 后再修改 CSS；不修改已确认的 Light/Dark 主色。

| CSS Token | 明亮模式 | 深色模式 | 用途 |
|---|---|---|---|
| --ee-on-primary | #ffffff | #111318 | 主按钮前景 |
| --ee-warning | #946b22 | #e5b96b | 待处理状态 |
| --ee-warning-soft | #fff5df | #332b20 | 待处理底色 |
| --ee-reading-text | #596273 | #aeb7c5 | 正文阅读与说明 |
| --ee-input-placeholder | #747c89 | #8f99a9 | 可读占位文案 |
| --ee-danger-soft | #fff1f0 | #382326 | 错误背景 |
| --ee-card-shadow | 0 4px 16px rgba(26,35,52,.06) | 0 4px 16px rgba(0,0,0,.18) | 产物卡片浮层 |

Sparkles 图标直接保存 Figma 导出 SVG（81:37 对应资产）到 public/figma/sparkles.svg，以 CSS mask 使用原始路径并跟随主题颜色。未将截图作为界面背景。

## 对象标签与 UC 表格（2026-09-14，设计侧）

- 规范：`E:\Git projects\TS-frontend\docs\标签页与左侧导航交互规范.md`。
- 继续复用颜色集合 `VariableCollectionId:326:1229`：Dark `326:0`，Light `326:1`。本轮没有修改全局 CSS 或已有颜色值。
- 继续复用布局 / 字号集合 `VariableCollectionId:345:1508`，优先绑定已有 space / type 变量；固定桌面画布尺寸与表格列宽是设计规格，不增加业务 token。

| 元素 | 语义变量 / 规格 | 说明 |
|---|---|---|
| 激活标签 | primary 描边和前景，surface 底色 | 非激活使用 canvas / muted / border；一个对象对应一个标签 |
| 目录选中 | tint 背景、primary 前景 | 与当前对象同步，但不同于勾选附件 |
| 表格字段格 | canvas 背景、text 前景 | Noto Sans SC Medium，12px |
| 表格内容格 | surface 背景、text 前景 | Noto Serif SC Regular，12px / 20px；长文可扩高 |
| 未确认 / 待处理 | amber / amberTint | 保存内容不改变“待处理”业务状态 |
| 主按钮前景 | 对应主题的 on-primary 语义 | 本轮实例以 surface 颜色变量表达：Light 白 / Dark 深底；前端优先使用现有 --ee-on-primary |
| 对象专属输入框 | 既有 Compact composer Typed 变体 | 非空草稿显示可发送状态；UC 隐藏 PRD 专属自动扩写 |

新增组件：对象标签集 `360:1246`、表格单元集 `361:1244`、基础表格行 `362:1240`、目录对象行集 `363:1248`。场景合并区由这些组件实例和自动布局嵌套组成，不使用截图背景。

字体映射：Figma 使用 Noto Sans SC 作为 UI 字体，Noto Serif SC 作为表格衬线字体；参考图的宋体观感由后者表达。前端实施时可沿用项目中文 sans 栈，并为 UC 内容定义含 SimSun / Noto Serif SC 的 serif 栈，需在目标 Windows 环境检验字体回退与换行；本轮未下载字体、修改字体文件或新增 CSS 字体声明。

## 2026-09-15 PRD 结果卡片化（仅设计侧）

- 复用当前集合 `VariableCollectionId:326:1229` 的 surface、text、border、primary、amber、amberTint；按集合 ID 与名称同时定位，避免误绑定旧 `VariableCollectionId:80:2` 中的同名颜色。
- 普通卡片：surface 底色 / border 描边 / text 正文；待确认卡片：amberTint 底色 / amber 标题 / text 正文。待确认提示不自动改变整份 PRD 的接受门槛。
- 卡片内边距 space/20（345:1511），卡片间隔 space/12（345:1526），内容间隔 space/8（345:1513），圆角 radius/12（345:1527）；文本仍用既有 Noto Sans SC 及 type/14、15、24。
- 当前前端 CSS、字体和组件均未修改；这些 Figma 变量沿用现有映射，不代表前端已经应用卡片布局。后续实施优先复用已有 token，必要时先更新映射再加 CSS。
- 卡片是输出组件 `337:1622` 的内部自动布局分组，正文保留原节点和字符绑定；没有导入图片作为背景，也没有另建全局颜色或会话变量。

## 2026-09-15 PRD / UC 对象标签前端增量

先登记布局映射：对象标签栏高 44px，复用现有 border / primary / surface / canvas；PRD 卡片内边距 20px、间隔及圆角均 12px，不新增颜色。UC 正文使用 SimSun / Noto Serif SC / serif 字体栈，表格字段沿用 UI 字体。用户已要求移除“需要进一步确认”卡片；warning 仍用于待处理状态，并非保留该模块。

本次前端实际布局：1440×900 下侧栏 232px；PRD 正文 796px + AI 412px（383:1935），UC 正文 888px + AI 320px（359:1229）。表格字段列/流程列/异常类别列为 92/110/106px，其余自适应；较窄桌面表格允许自身横向滚动。历史“待确认卡片”颜色映射已停用，warning 仍保留作产物状态。

FR 全景视图（Figma `444:3276` / 完整三列表格 `451:3462`）仅保留格式：表头、三列、13 行、边框、行高和滚动；停用 `color/frHighlight` 与 `color/frRed`（VariableID:445:1292 / 445:1293）及所有 FR 表格内的示例红色/黄色/蓝色强调；FR 表格内容统一使用中性色。

## 2026-09-16 UC / FR 分配全景（仅设计侧）

- 两张主稿使用当前集合 `VariableCollectionId:326:1229` 的 Light `326:1`；没有更改任何现有 token 值或 CSS。
- 图背景 / 表格单元格 / 下拉：surface；画布 / 表头：canvas；正文：text；说明：muted；边界和网格：border。
- primary / tint 仅用于导航激活、输入 focus 与选项勾选；FR 编号、来源、描述统一 text。未使用 frHighlight / frRed。
- 复用 `VariableCollectionId:345:1508` 中 type/12、space/8、10、12、radius/4、6、8。桌面画布和表格列宽是布局规格，不新增全局 CSS token。
- `VariableCollectionId:522:1246` 是此次专用原型状态集合，记录当前行、各行勾选、数量和折叠显示文本；不是主题 token 或后端数据 Schema。
- 旧 FR table / Cell 实例在 MCP 设置颜色后出现过回退色异常，已将本次实例的回退色设置为对应 Light token 值并保留变量绑定；截图确认中性白底可读。不修改历史主组件。
# 项目级子系统划分与 FR 分配数据库设计 V1.2（专项补充）

> 日期：2026-09-20。状态：**设计建议，未建库、未执行 SQL、未修改前后端或 Figma、未连接服务器。**
> 新确认：每个项目可以有不同的子系统划分；复杂项目可拆内灯/外灯，简单项目可合并为内外灯。
> 优先级：本文件覆盖 V1.1 第 6.7 节及《子系统表构建计划与设计_2026-09-20》中关于子系统目录、版本、导入和分配引用的旧方案；其他业务继续沿用 V1.1。不是全库已完成 V1.2 迁移。
> 口径：暂将“每个系统”理解为“每个项目所设计的整车/系统”。若同一项目内还要管理多个独立顶层系统或车型方案，见第 12 节，不擅自认定已需要此层。

## 1. 结论与变化范围

建议采用：**项目独立的子系统划分方案 + 稳定的子系统身份 + 不可变方案快照 + 引用方案版本的 FR 分配**。

- 不同项目使用同一套数据库表，通过 `project_id` 区分数据；不是每个项目动态创建一套表。
- 同项目的 AEB、LKA 等业务功能默认共用这个项目的划分；FR 仍保留原 `function_id`。
- Excel 是可选的参考/导入来源，不再是所有项目必须照搬的固定 43 条目录；项目可以选用、补充、拆分或合并。
- 方案编辑与 FR 分配是两个动作。编辑方案不在分配下拉框里顺手改目录；分配页面仅选择已经发布的项目方案中的目标。
- “项目独立”是本次明确需求；“每项目一个方案身份、保存快照、发布后正式分配”等是本文件的推荐默认，仍待确认。

旧表已有 `project_id` 和 `UNIQUE(project_id, code)`，因此已经能保存不同项目的不同名单。**不足在于仅有当前名称、描述和整数 `catalog_version`，不能还原完整的历史划分，也不能证明分配目标属于当时的方案。** 本次是在原有项目隔离基础上补齐方案与引用版本，并非推翻 PRD/UC/FR 的设计。

## 2. 三个功能如何对应数据

| 产品功能 | 本文暂定职责 | 读取/维护的数据 |
|---|---|---|
| 子系统 | 浏览本项目子系统，查看职责、历史及可见的关联 FR | 稳定身份 + 指定方案版本中的条目；关联 FR 是受权限过滤的反向查询 |
| 子系统具体划分 | 设计该项目包含哪些子系统，划分职责，新增/拆分/合并/移除，保存与发布方案 | 方案头、方案版本、版本条目 |
| FR 子系统分配 | 将某个 FR 版本分配到本项目某版方案的一个或多个子系统 | 分配身份、分配版本、分配目标 |

这是数据职责划分，不代表新页面、按钮、子系统编辑权限已经实现或全部确认。三个菜单不要求恰好三张表，也不应各自保存一份可独立修改的子系统名单。

## 3. 两个项目的例子

下方 P-A、S-A1 等均为说明用代号；正式主键为 UUID，不是用户已有数据库记录。

| 项目 | 方案 | 子系统身份 | 本版名称 | 本版职责 |
|---|---|---|---|---|
| P-A 复杂车型 | A-V1 | S-A1 | 内灯控制系统 | 阅读灯、氛围灯等内灯控制 |
| P-A 复杂车型 | A-V1 | S-A2 | 外灯控制系统 | 近光灯、远光灯、转向灯等外灯控制 |
| P-B 简单车型 | B-V1 | S-B1 | 内外灯控制系统 | 本车型内外灯统一控制 |

例如“打开阅读灯”这一类 FR，在 P-A 可分给 S-A1，在 P-B 可分给 S-B1。数据库不根据相同名称、SS 编号或相似 FR 文本把两个项目连在一起。

即使两项目都叫 `SS101`，也只是各自项目内的编号，UUID 不同；更不能规定 `SS101` 永远是所有项目的外灯系统。项目采用模板时复制项目自己的身份，不共用模板行作为正式分配目标。

## 4. 表结构：四张方案相关表 + 三张既有分配表

| 表 | 相对 V1.1 | 核心职责 |
|---|---|---|
| `project_subsystem_designs` | 新增 | 每项目一个划分方案入口，记录工作版和已发布版 |
| `subsystem_design_versions` | 新增 | 每次保存的完整方案版本头 |
| `subsystems` | 调整既有表 | 项目内稳定身份和编号，不再存另一份可变当前正文 |
| `subsystem_version_items` | 新增 | 某方案版本具体包含的子系统及本版职责、名称、分组 |
| `fr_allocations` | 沿用 | 一个 FR 的独立分配对象身份 |
| `allocation_versions` | 扩展 | 固定引用一个 FR 版本和一个方案版本 |
| `allocation_targets` | 扩展 | 某个分配版本选择了哪些本版子系统 |

本专题共 7 张核心表：已有 4 张中调整 3 张、沿用 1 张，新增 3 张。不是在 V1.1 之外再加 7 张。若其他范围不变，V1.1 一期目标表数由 34 增为 37；域字典、模板表、M-xxx 正式关系、专门拆并映射表尚不计入。

### 4.1 `project_subsystem_designs`：方案入口

| 字段 | 类型/约束 | 含义 |
|---|---|---|
| `project_id` | uuid PK/FK → projects | 一个项目最多一个方案入口，项目创建时原子初始化 |
| `name` | text NOT NULL | 如“项目 A 子系统划分” |
| `working_version_id` | uuid NULL | 当前工作快照，未保存时为空 |
| `published_version_id` | uuid NULL | 当前正式方案，首次发布前为空 |
| `lock_version` | bigint NOT NULL，默认 0 | 比较并交换的并发控制令牌 |
| `created_by/updated_by` | uuid FK → app_users | 真实业务身份；不虚构管理员 UUID |
| `created_at/updated_at` | timestamptz | 审计时间 |

两个指针用 `(project_id, version_id)` 复合 FK 指向本项目的方案版本。先创建可空指针的方案入口，再建版本表，最后增加指针外键，避免迁移依赖环。空项目可以没有任何方案条目，不自动生成 43 条。

“子系统列表”的正式查询从 `published_version_id` 出发；方案编辑查询从 `working_version_id` 出发。未发布时展示草稿或空态，但正式 FR 分配不将草稿当作可用目录。

### 4.2 `subsystem_design_versions`：方案版本头

| 字段 | 类型/约束 | 含义 |
|---|---|---|
| `id` | uuid PK | 方案版本身份 |
| `project_id` | uuid FK → project_subsystem_designs | 项目归属 |
| `version_no` | integer > 0 | 项目内版本序号；UQ(project_id, version_no) |
| `parent_version_id` | uuid NULL，同项目 FK | 从哪个工作快照修改而来 |
| `base_published_version_id` | uuid NULL，同项目 FK | 开始本轮编辑时的正式版，用于发布冲突校验 |
| `change_summary` | text | 修改目的、拆分/合并说明 |
| `created_via` | text CHECK(manual/import/ai/copy) | 来源；是本专题新增枚举，不静默改 V1.1 其他类型的枚举 |
| `created_by/created_at` | uuid FK / timestamptz | 保存人、保存时间 |
| `published_by/published_at` | uuid FK NULL / timestamptz NULL | 首次发布留痕，必须同时为空或同时非空 |
| `metadata` | jsonb object | 非关键来源信息，如导入文件哈希；不放授权或核心关系 |

另设 UQ(project_id, id)。每次保存写入新的版本和完整条目集合，之后正文不可变；允许受控地填写一次发布署名，不允许改旧条目。工作版/当前正式版从方案入口指针推导；旧版的 `published_at` 保留，不因失去“当前”身份而变成草稿。

不以每个子系统上的一个可变 `catalog_version` 代替方案版本表。恢复旧方案时也复制成新快照后发布，不能悄悄倒转历史。

### 4.3 `subsystems`：稳定子系统身份

| 字段 | 类型/约束 | 含义 |
|---|---|---|
| `id` | uuid PK | 项目内子系统的稳定身份 |
| `project_id` | uuid NOT NULL FK → projects | 项目隔离 |
| `code` | text NOT NULL、非空 | 项目内业务编号；UQ(project_id, code)，创建后稳定、不回收复用 |
| `created_by/created_at` | uuid FK / timestamptz | 身份创建记录 |

另设 UQ(project_id, id)，供复合 FK 引用。名称、职责、启用情况放在版本条目中，不在身份表再建一套可编辑副本。

只改名、修正描述且身份不变时复用 `id`；真正拆分/合并形成新职责实体时创建新 ID。移除表示新方案不再包含该身份，或本版条目 `is_allocatable=false`；旧版条目保留，不物理删除已被引用的身份。

### 4.4 `subsystem_version_items`：具体划分正文

| 字段 | 类型/约束 | 含义 |
|---|---|---|
| `project_id` | uuid NOT NULL | 项目 |
| `design_version_id` | uuid NOT NULL | 本次方案版本 |
| `subsystem_id` | uuid NOT NULL | 子系统稳定身份 |
| `name` | text NOT NULL、非空 | 本版名称 |
| `description` | text NOT NULL | 本版系统描述；保留 Excel 换行 |
| `responsibility_in` | text NOT NULL，默认空串 | 建议增加：本子系统承担哪些职责 |
| `responsibility_out` | text NOT NULL，默认空串 | 建议增加：明确不承担哪些职责，不能由 AI 当已确认结论填入 |
| `domain_key/domain_name` | text NULL | 本版分组键和名称快照；同时有值或同时为空 |
| `is_allocatable` | boolean NOT NULL | 本版是否允许作为分配目标 |
| `sort_order` | integer ≥ 0 | 展示顺序，不作为身份 |
| `related_main_functions_raw` | text NOT NULL，默认空串 | Excel M-xxx 原文；在关系语义确认前仅作来源说明 |
| `source_metadata` | jsonb object | 文件哈希、sheet、源行/合并区域等来源信息，可有多个来源行 |

PK(project_id, design_version_id, subsystem_id)；FK(project_id, design_version_id) → subsystem_design_versions(project_id, id)；FK(project_id, subsystem_id) → subsystems(project_id, id)。同一子系统可以存在于多个方案版本，每版只出现一次。

**域是分组，不自动等于又一层系统实体。** 第一版可用版本化条目中的分组键/名称，不强制先建域字典表；同一版本同一分组键应有一致名称，发布事务校验。“动力 4XX”与“热管理 4XX”不能只凭 4XX 合并；可用 `POWERTRAIN`、`THERMAL` 等内部键。若需要独立维护域，再扩展项目级域表和版本快照，而不是保存会改变历史的全局名称。

### 4.5 既有 FR 分配三表

`fr_allocations` 保持 V1.1：分配对象和 FR 分开；项目/功能/fr_id 唯一，分配不反向修改 FR 原文。

`allocation_versions` 保留 `revision_id`、`project_id`、`function_id`、`allocation_id`、`fr_id`、`fr_revision_id`、`note`，**新增 `design_version_id uuid NOT NULL`**，同项目 FK → subsystem_design_versions。

`allocation_targets` 保留 `project_id`、`function_id`、`allocation_revision_id`、`subsystem_id`、`rationale`，**新增 `design_version_id uuid NOT NULL`**。此列是为了构造可验证的复合 FK，不是可独立选择的第二个方案。

关键约束：

1. `allocation_versions` 增加 UQ(project_id, function_id, revision_id, design_version_id)。
2. targets 的这四列复合 FK 必须引用其分配版本，禁止一条分配混用两个方案。
3. targets 的 `(project_id, design_version_id, subsystem_id)` 必须引用 `subsystem_version_items` 的复合主键，禁止串项目、串版、引用不存在的条目。
4. PK(allocation_revision_id, subsystem_id) 防止同版重复选择同一子系统。
5. FR 的归属和版本仍按 V1.1 的复合 FK 校验，不仅校验 `fr_revision_id` 存在。
6. 新版本只允许选其方案中 `is_allocatable=true` 的条目；正式接受时还必须是项目当前发布方案。该状态/当前性检查在受控事务中完成，不能伪装成普通跨表 CHECK。[PG1]

有版本条目后，历史名称从被引用条目读取。V1.1 的 `subsystem_name_snapshot` 可不再存；若兼容导出而保留，只能从被引用条目生成且不可独立修改。既不从当前名称反查历史，也不复制一套可编辑 FR 原文到分配表。

### 4.6 查询与索引落点

- 已有项目内唯一键覆盖编号查找、按方案版本读取完整条目集合；不重复创建同列索引。
- 版本条目另建 `(project_id, subsystem_id, design_version_id)`，用于某子系统的版本历史。
- targets 另建 `(project_id, design_version_id, subsystem_id)`，用于反查该版子系统的分配；业务查询仍限定当前/历史模式及可读范围。
- 分配版本按项目、功能、方案版本建立索引，用于筛选待复核分配。几十条子系统先使用简单名称过滤，不假定普通 B-tree 会加速任意包含关键词检索；规模扩大后另评估搜索索引。
- 一期不强行将方案并入现有四类 `artifacts`；若以后子系统需要统一标签/会话/metadata 注册，扩展类型体系和权限契约后再接入，不能把 subsystem_id 当 UC/FR artifact_id。

## 5. 同项目以后拆分或合并，怎样不破坏历史

### 5.1 简单项目后来升级

```text
P-B 方案 B-V1（历史发布版）
└─ S-B1 内外灯控制系统
   └─ FR-001 r1 的分配 a1：引用 B-V1 → S-B1

P-B 方案 B-V2（新发布版）
├─ S-B2 内灯控制系统
└─ S-B3 外灯控制系统
   └─ FR-001 r1 的新分配 a2：引用 B-V2 → S-B2，或 S-B3，或两者
```

a1 永远能还原“当时分给内外灯控制系统”，不会因为发布 B-V2 而自动变成两条目标。针对阅读灯的 FR 可以仅分内灯，远光灯可以仅分外灯，确实同时涉及两者的 FR 才选两个。拆子系统不必然拆 FR，是否细化 FR 是独立业务操作。

反向合并同理：创建新的合并身份，旧两个身份保留在旧方案；产生新的分配版本，不批量删除旧 targets。

### 5.2 改名与职责改变

- 改名且身份不变：复用子系统 ID，新版保存新名称，旧版保留旧名。
- 职责变化但仍是同一实体：可复用 ID，新版职责文本改变；既有 FR 需评估，不凭 ID 相同认定无需复核。
- 一拆二、二合一：新身份 + 新方案。拆并来源需在方案变更说明/审计中记录；不能用 `parent_subsystem_id` 冒充拆并历史，树形父子关系并不表达多对多合并。
- 如果后续需要精确查询拆并血缘，再增加 `subsystem_transition_links`：project_id、from_version_id/from_subsystem_id、to_version_id/to_subsystem_id、change_group_id、kind、reason；两端均 FK 到版本条目。拆分是同一个来源多条目标关系，合并反之。当前不把该可选表列为建库前置，也不在 metadata 藏关联 ID。
- 有拆并映射不等于 FR 自动迁移规则。AI 只能提出候选，人工接受后才创建新的分配版本。

## 6. 保存、发布、AI 与并发

### 6.1 建议默认流程

1. 创建项目，同时创建空方案入口；默认没有发布方案。
2. 手工、Excel 导入或 AI 生成候选划分，保存一个完整工作版本。
3. 用户检查子系统名称、职责、重复项和分组；具有发布能力的人发布方案。
4. FR 分配（手动或 AI）固定使用这个项目的发布版本及实际依据的 FR 版本。
5. 继续修改划分只产生工作版本，在发布之前不改变分配候选列表。
6. 发布新方案后，旧分配保留，但明确标示“依据旧方案，待复核”；复核后再产生新分配版本。

一期建议只有一个工作头和一个当前发布头，不做并行方案对比或按车型配置自动选方案。若需这些能力，先增加明确的方案身份/适用范围，不靠多条 `enabled=true` 猜测哪个有效。

### 6.2 两种版本过期，分开判断

- `FR_SOURCE_OUTDATED`：当前应引用的 FR 版本与该分配依据不同。
- `SUBSYSTEM_SCHEME_OUTDATED`：项目当前发布方案与该分配依据不同。

这两个状态可从版本指针派生，不必写一个容易失真的全局 `invalid` 标志。方案变更时保守地将基于旧版的分配列为待复核，但**不声称所有 FR 都发生了语义影响**；与变化条目相关的目标才是重点候选。历史接受记录仍成立，只是对当前输入不再新鲜。

### 6.3 原子发布和竞争控制

建议发布事务按固定顺序锁定项目行/方案入口，校验活动项目、发布权限、`lock_version`、`working_version_id`、`base_published_version_id` 和全部条目，再更新发布指针、递增 `projects.catalog_epoch`、追加事件和审计，一并提交。

- `catalog_epoch` 新定义：**正式已发布目录改变**时递增；仅保存草稿不递增。替代 V1.1 对任意目录草稿变化都递增的笼统口径。
- 发布后的正文只读；应用运行账号不直接 UPDATE/DELETE 历史条目，由受控保存/发布入口和数据库权限/触发器保证。
- AI 开始时冻结项目、输入 FR 版本集合、方案版本、catalog_epoch 和授权上下文。现有 `ai_runs` 需扩展明确的 `subsystem_design_version_id` FK，而非伪造第五种 artifact 作为 `ai_run_inputs`。
- 当前 ai_runs 是功能级四阶段任务；以上只扩展 FR 分配对方案的引用。若后续需要 AI 自动生成项目级划分，要另行扩展任务 scope/stage、条件 function_id 和权限契约，不能挂在虚构的 AEB 功能下；created_via=ai 目前仅预留来源。
- 提交/接受时在同一锁定规则下再次验证：FR 变化、方案换版、撤权，任意发生均返回冲突/拒绝，不发布旧输入的结果。
- 新分配保存至少校验所引用方案曾发布；如果已不是当前发布版，建议返回冲突并保留本地草稿。历史记录可以读，不借“引用旧版”创建新的已接受结果。
- 行锁/CAS 的具体 SQL 在迁移阶段单独编写和实测。本轮没有执行锁测试。[PG2]

## 7. 权限：项目架构与业务功能分配分开

仍使用 V1.1 五张权限底座表，不给子系统记录加 canEdit 或角色列表。角色定义、资源范围、数据状态是三件不同的事。

| 建议能力点 | 范围 | 用途 |
|---|---|---|
| `page.subsystem.open`、`subsystem.read` | project | 项目共享架构及历史的读取 |
| `subsystem.update` | project | 编辑具体划分、拆分/合并并保存工作版 |
| `subsystem.publish` | project | 发布影响全项目业务功能的方案 |
| `subsystem.import` | project | 允许导入预览/提交候选；提交仍需 update，不隐含发布权 |
| `page.allocation.open`、`allocation.read/update/generate/accept` | function / artifact，按 V1.1 | 读取、生成、修改、接受具体 FR 分配 |

本专题以 update/publish/import 替代上一稿含混的 `subsystem.manage` 总开关。以上新能力尚未注册，建议给项目架构负责人 update/publish，业务功能设计者仅 read 加其被授权范围的 allocation 动作；**不是已有角色天然拥有所有新能力**。

迁移时必须扩展 `permission_definitions.resource_kind` 到 `subsystem_design`，补充 publish/import/open 等动作白名单和 project scope 声明，再以新角色版本授予；否则只有新增能力名称而原 CHECK 不允许，无法落库。方案用项目范围绑定，不把 subsystem_id 塞入仅接受四类业务对象的 artifact_id。

`subsystem.read` 不等于可以看全项目 FR。子系统详情反查 FR、统计数量、全景和历史来源时仍按 FR/分配的功能及对象权限过滤。只在 AEB 有编辑权的人不因此能发布影响 LKA 的全项目架构。架构维护页可不依赖进入某个业务功能，但分配页同时受功能入口和对象权限约束。

应用授权和 PostgreSQL 账号权限分别设计。项目 RLS 可以作为第二道隔离，但不能据此声称对象级权限已实现；运行账号不能用 superuser/BYPASSRLS，owner 绕过行为也要按部署角色测试。[PG3]

## 8. Excel、域和主功能如何沿用

- 保留前次解析中的合并区域来源和原文；只在真实合并区域内展开域，不对任意空行盲目前向填充。
- 导入目标是“某项目的一个候选方案版本”，不是全局目录，也不覆盖这个项目当前发布版。
- 复杂项目可选内灯、外灯两个条目；简单项目可创建新身份“内外灯控制系统”，人工确认合并后的职责。不能仅拼接名称就推定职责完整。
- 合并记录可以保留多个源 Excel 行作为来源证据；不让正式对象 UUID 等于 Excel 行号。
- 文件哈希只识别来源，不独自决定幂等。正式导入还需 project_id、基准工作版本、映射规则版本、请求幂等键；重复请求返回原结果，不重建身份/版本。
- `/` 只表示来源未给出主功能关系，不证明业务上绝对没有关联。前次 76 项为原始非空关联候选，不是已确认的 76 条正式 M 编码关系；无编码文本、同编码不同描述必须人工处理。
- M-xxx 与 AEB/LKA 的关系仍未确认；原文可保留作参考，不能直接创建 business_functions 外键。如果正式建关联，必须挂在方案版本条目上，避免改当前映射导致历史失真。
- “域独立建表”“全局模板库”“M 主功能两张表”都不是满足本次项目差异化的前置要求。第一版先完成本专题核心，避免为导入一份文件过早增加组织/模板治理。

## 9. 总体关系示意（不是实际建表图）

```text
项目 P
├─ AEB/LKA 等业务功能 → FR 身份 → FR 版本 rN
│                                  ↑
│                          FR 分配版本 aN
│                            │       │
│                  固定 FR rN│       └─ 固定方案版本 Vn
│                            └─ 多个分配目标 ───┐
│                                               ↓
├─ 项目子系统方案入口 → 方案版本 V1/V2 → 版本条目（名称、职责、可分配性）
│                                               ↑
└─ 项目子系统身份（稳定 UUID、编号） ──────────────┘

项目 Q：完全独立的一套行数据，仍使用相同表；不能引用 P 的版本条目。
```

每一条分配目标既属于某个分配版本，又引用该分配选定方案里的具体条目。它不是只连一个永远变化的“当前子系统”。

## 10. 分步建库建议：先依赖，后业务，再接功能

1. **先冻结本页第 12 节的关键口径。** 本轮只更新设计，不发出可误粘贴的生产建表 SQL。
2. 用户手动只读回读服务器现状：最后已有 SQL 验收不等于当前仍运行或 SSH 隧道已通过。按实际操作位置决定走服务器本地 peer 还是专用账号隧道，不自动开放 postgres TCP。
3. 手动创建业务数据库、owner/migrator/runtime 等最小权限角色、schema、迁移记录；先给出独立操作手册，每步看输出再继续，不一次粘贴全库脚本。
4. 先建 `app_users`、`projects` 等前置身份表并初始化真实项目，再按依赖落地权限底座。含 function/artifact FK 的 access_bindings 可待对应身份表存在后建完整约束；在此之前不开放不受控业务 API。
5. 创建方案入口（可空头指针）→ 子系统身份 → 方案版本 → 版本条目 → 补头指针 FK/受控写入规则；准备项目范围授权和审计。**不能先建引用 projects/app_users 的表却不创建其前置表。**
6. 先在测试项目创建并核对一份方案，验证拆分/合并与版本，再由用户确认导入真实项目；数据库测试在测试库进行。
7. FR 身份及版本底座具备后，建/扩展分配三表及完整复合 FK；FR 尚未建立时不造假的 FR 表或 ID 来凑流程。
8. 最后接页面和 AI；注册能力点、返回权限、范围过滤、并发发布、撤权和历史读取均通过后才开放多人使用。

项目尚未创建，用户只需先提供项目名称/编号及范围。UUID 由受控创建流程生成并回读，**无需现在要求用户提供一个尚不存在的 project_id**。

回滚以事务边界和备份为准；已经提交并被引用的方案不靠 DROP/覆盖回滚，使用新版本恢复或受控恢复计划。助手继续不 SSH 操作服务器。

## 11. 验收样例

| 场景 | 预期 |
|---|---|
| P-A 两个灯子系统，P-B 一个 | 各自正确显示，彼此无影响；记录数量按项目方案，不强制 43 |
| 两项目同编号/同名 | 合法但 UUID 不同；同项目重复编号被拒绝 |
| P-A 分配选择 P-B 条目 | 复合 FK/权限拒绝 |
| 分配引用 V2，却选择只在 V1 存在的目标 | 复合 FK 拒绝 |
| 一个分配混选 V1 与 V2 目标 | 复合 FK 拒绝 |
| 有草稿、没有正式方案 | 可以编辑划分，不能生成/接受正式分配 |
| 保存 V2 草稿 | 只改变工作头，V1 的分配和候选仍有效 |
| 发布 V2 合并/拆分 | 旧分配仍能按 V1 还原；标待复核，不自动增加/删除目标 |
| 改名/职责改变 | 历史名称/职责不变；当前版显示新值，职责改变产生复核候选 |
| 新分配指向不可分配条目 | 保存/接受校验拒绝；历史已接受分配不被删除 |
| 两人基于同一工作头保存 | 一个成功，另一个冲突；不会静默丢掉另一人的划分 |
| AI 生成中换方案或撤权 | 发布/接受拒绝，正式分配不变 |
| 架构编辑者无发布权 | 可保存草稿，不能发布；分配编辑权限同样单独校验 |
| 仅能看 AEB 的用户看子系统关联 FR | 不泄露 LKA 的条目、名称、数量或来源 |
| 导入超时重试 | 同幂等键返回原批次结果，不重建子系统和版本 |

这些是设计验收标准，不是本轮实际执行过的数据库测试。

## 12. 只剩下需要确认的业务口径

| 编号 | 状态 | 问题/默认 |
|---|---|---|
| SD-Q01 | 已确认 | ~~所有项目共用固定子系统名单~~ → 每项目独立划分，可以内灯/外灯分开，也可内外灯合并。Excel 不能强制全量套用。 |
| SD-Q02 | 待确认，建议默认 | 是否每项目同一时刻只有一个正式划分？建议是，可有一个工作草稿；若多个车型/产品同时采用不同划分，增加顶层系统/方案实体。 |
| SD-Q03 | 待确认，建议默认 | “子系统具体划分”是否就是维护职责及拆分/合并？若指父子多层分解，另增同版本内父子引用和无环校验，不把拆并关系当父子树。 |
| SD-Q04 | 待确认，建议默认 | 建议项目架构负责人维护并发布；普通业务功能编辑者只能在分配页选取。具体由管理员、指定设计人员还是 AI 产出后确认，由你决定。 |
| SD-Q05 | 待确认，建议默认 | 建议先发布划分再做正式分配；方案换版保留旧分配、人工复核后新版替代，不自动搬迁全部 FR。 |

已明确的项目差异化不再重复询问。未知范围先按上方默认设计，不标为用户已批准，也不提前实施。

## 13. 官方实现依据（2026-09-20 核对）

以下资料仅支撑数据库机制；本文件的表名、流程、权限矩阵是项目设计建议，不是 PostgreSQL 官方业务模型。

- PG1 PostgreSQL 18 Constraints：复合唯一键/外键及跨表 CHECK 的限制。`https://www.postgresql.org/docs/18/ddl-constraints.html`
- PG2 PostgreSQL 18 Explicit Locking：事务行锁与并发更新协调。`https://www.postgresql.org/docs/18/explicit-locking.html`
- PG3 PostgreSQL 18 Row Security Policies：RLS 及 owner/superuser/BYPASSRLS 边界。`https://www.postgresql.org/docs/18/ddl-rowsecurity.html`

# 2026-10-04 主前端工作流切换 r2（用户执行）

## 范围

公司已完成兼容主后端切换、原流程只读验收、SQL提交与联合结构校验。正式迁移回执为 `/home/t7920/ts-workflows-migration-20261004.zbg34iel/state.json`。不要重跑SQL，也不要误用只读预检的yof6pxu7回执。

本步骤只切换主前端：旧容器 `ts-agent-frontend-20261002-project-context-r1` → 新容器 `ts-agent-frontend-20261003-workflows-r2`。固定已构建镜像 `ts-agent-frontend:20261003-workflows-r2`，ID为 `sha256:5564af68ba15be2ac89f7871ea5705c7bac40dbddcd8026023e34fc8e06cece0`。不重新build/pull，不改变后端/数据库/预览/联调台，不初始化预置子系统。维护继续。

## 文件和依赖

脚本：`E:/Git projects/TS-frontend/deploy/workflows/cutover_frontend_workflows_20261004_r2.py`。SHA256：`f92f35ec38752bb2b7090d001567e54d80bf4cffd6ad72ed2161e94134a7a7d7`。之前r1.draft.py原样保留、仍禁止部署，不要上传它。本次未调整执行策略或连接公司服务器。

依赖服务器已有辅助文件 `/home/t7920/workflows-main-cutover-20261004-r1-incoming/cutover_main_workflows_20261004_r1.py`，固定SHA256 `f9581695b96dd8d5f89f40347eb3d700fce513cc63e0437c9cb54c1d4bd4484e`。只使用其中的Docker、配置比较及HTTP辅助函数，不调用后端部署逻辑。

## 1. Windows PowerShell上传

```powershell
& 'E:/Git projects/TS-frontend/deploy/workflows/upload_frontend_workflows_20261004_r2.ps1'
```

上传器核对本地SHA，在服务器创建新的0700 incoming目录，再仅上传Python脚本。拒绝覆盖已有目录；失败保留现场并回传输出，不自行删除或覆盖。终端交互输入SSH/SCP密码，不写入文件。上传不切换服务。

## 2. Ubuntu Bash校验、预检、切换

保持维护，避免其他人并行部署/操作业务；保持SSH连接，不用sudo执行本脚本。不要在Windows运行Python脚本。

```bash
SCRIPT=/home/t7920/workflows-frontend-cutover-20261004-r2-incoming/cutover_frontend_workflows_20261004_r2.py
printf '%s  %s\n' 'f92f35ec38752bb2b7090d001567e54d80bf4cffd6ad72ed2161e94134a7a7d7' "$SCRIPT" | sha256sum -c - &&
python3 "$SCRIPT" --check-only &&
python3 "$SCRIPT"
```

check-only不会创建/停止/启动/更新容器，只检查回执、镜像、身份、配置和健康/API。CLI使用HOME下0600互斥锁文件避免本脚本同时运行；这不能阻止其他人手工操作Docker。

正式执行从旧前端实际容器私密继承环境，使用0700临时目录和0600环境文件创建停止候选，随后清理临时凭据。核对全部Config字段（Env单独比较，Image/Hostname身份字段除外）及HostConfig；只忽略ConsoleSize，只把OOM null/false视为默认等价，true/非法类型仍拒绝。候选正确后才用完整容器ID停旧、启新。镜像固定ID，使用--pull never。

要求首页、登录页和前端代理health连续三次正常，新前端无重启；复核主后端health、8个工作流及原登录/项目API，保留主后端/旧后端/预览/联调台的身份、配置、数据挂载与状态不变。

## 成功和失败

- 成功标志：CHECK_ONLY_OK、CONFIG_MATCH_OK、FRONTEND_WORKFLOWS_CUTOVER_OK。旧前端保留停止，其他服务不变；仍保持维护，等待浏览器和业务验收。成功后不要重跑。
- 停旧前端前失败：NO_CUTOVER。候选若已创建则保留，不删除容器。
- 停旧前端后失败：只尝试禁用新前端重启、停新前端、恢复固定旧前端。健康恢复才输出FRONTEND_ROLLBACK_OK，退出码仍为失败，不表示新版上线。
- 身份/配置/保留服务漂移或恢复失败：FRONTEND_ROLLBACK_NOT_CONFIRMED。保留现场回传输出，继续维护，禁止盲目重跑；不回退SQL，不启动旧后端。
- 只有人工审核后才能使用--resume-created；目标必须从未启动、created状态、零重启且配置一致。普通重复执行拒绝已有目标。

## 本地证据

55项离线fixture测试通过，涵盖配置漂移、OOM默认等价、回执/辅助文件校验、明确续行、凭据清理、连续健康、启动/超时/中断失败、仅前端回退与回退失败。测试禁止真实subprocess和网络连接；Docker/HTTP均为模拟。

证据：`E:/Git projects/TS-frontend/tmp/workflow-frontend-cutover-check-20261004-093516/verification.json`，同目录tests.log、windows-guard.log。Windows误执行拒绝、PS AST/Bash语法、UTF-8无BOM/LF、GNU SHA校验通过。冻结发布根清单及7个载荷（含5个归档）哈希未变。

本轮仅改部署工具与文档，未改业务代码、未重跑应用lint/typecheck/build和全套业务测试。没有Linux Docker实机切换/回退演练、公司连接、SQL或服务操作。

## 后续

回传切换结果后，浏览器强制刷新并验证登录、项目/DVR/既有PRD和确认状态、工作流入口。再单独处理预览后端/联调台升级、经批准的缺失子系统预置和联合业务验收。预览写开关保持false，不随新按钮放开。

批准的业务验收项目为bf8f4d08-d086-44bf-9cbe-f31abc67ee03，功能为3bb1333a-1ebf-428c-831f-c26dcd66cfa3。真实Agent Skill另验，不能用health/OpenAPI成功替代。

## 2026-10-04 公司主前端实际切换成功

用户已回传脚本SHA校验OK、CHECK_ONLY_OK、CONFIG_MATCH_OK与FRONTEND_WORKFLOWS_CUTOVER_OK。主前端现为 `ts-agent-frontend-20261003-workflows-r2`，镜像 `ts-agent-frontend:20261003-workflows-r2`，固定ID `sha256:5564af68ba15be2ac89f7871ea5705c7bac40dbddcd8026023e34fc8e06cece0`。首页/登录页/代理health正常，工作流OpenAPI路径8条。

旧前端保留停止，兼容主后端未变，旧后端及预览仍停止，联调台保持旧版。此次未执行SQL、构建镜像或初始化预置目录。维护继续；仅确认部署级健康，浏览器新版本登录/原数据/入口与FR、分配、私有会话及真实Agent验收尚未完成。

安全回执：`E:/Git projects/TS-frontend/deploy/workflows/server-frontend-cutover-receipt-20261004-r2.json`。下一步先由用户在浏览器做不触发生成/保存/确认/新建会话的基础验收，再单独安排联调预览和控制台升级、目录初始化及联合业务验收。不重复切换，不启动旧后端，不用服务health冒充Agent完成。助手没有连接公司服务器。

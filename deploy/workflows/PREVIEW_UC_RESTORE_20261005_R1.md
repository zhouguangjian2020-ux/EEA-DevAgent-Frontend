# 7018 UC联调后端恢复（2026-10-05 r1）

用户已明确要求恢复独立联调后端，测试Agent工程师完成的UC生成/UC图。7000和7200健康，7018不可达。本文件只是交付准备，尚未在公司执行。

- 复用已构建镜像ts-agent-backend:agent-console-20261003-workflows-r2（sha256:739175ad015c4ea0f39ce1b3665d088ae592488f37078f125010555ae6b2f48b）。不构建或拉取镜像。
- 只新建/启动ts-agent-backend-console-20261003-workflows-r2，监听127.0.0.1:7018。旧预览继续停止保留。
- 从当前运行主后端私密读取环境，保留联调台现有诊断密钥/目标项目，要求回调密钥匹配。强制BUSINESS_WRITES_ENABLED=false，不改7200或其数据挂载，不动7000/7100，不执行SQL。
- 开始前核对镜像、原容器配置、联调台目标和三项健康；--check-only无容器变更。正式阶段创建后先验证环境及HostConfig再启动，只有OomKillDisable=null/false和ConsoleSize采用已确认等价规则。其他差异拒绝继续。
- 启动失败只禁用并停止本脚本启动的新预览，保留检查，不启动旧版本或停止主服务。创建但未启动的目标保留；不要删除或反复重跑，如需--resume-created先核对输出。
- 18项离线样例测试通过；尚未完成真实服务恢复、浏览器或Agent验收。UC相关6个文件与旧r7逐字节相同，诊断中间件只增加新工作流路径。

## 1. 本地Windows PowerShell上传

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $Script = 'E:/Git projects/TS-frontend/deploy/workflows/restore_preview_uc_20261005_r1.py'
    $Expected = '397c848231d0e8180487cb59823e276864746349380caa10e3e5e8c40ad3d1cd'
    $Remote = 't7920@192.168.64.3'
    $Incoming = '/home/t7920/preview-uc-restore-20261005-r1-incoming'
    $RemoteFile = "$Incoming/restore_preview_uc_20261005_r1.py"

    if ((Get-FileHash -LiteralPath $Script -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
        throw 'LOCAL_CHECKSUM_FAILED'
    }
    Write-Host 'LOCAL_CHECKSUM_OK'

    ssh.exe -p 22 $Remote "umask 077; mkdir -- '$Incoming'"
    if ($LASTEXITCODE -ne 0) { throw 'CREATE_DIRECTORY_FAILED: stop; do not overwrite existing files' }

    scp.exe -P 22 $Script "${Remote}:${Incoming}/"
    if ($LASTEXITCODE -ne 0) { throw 'UPLOAD_FAILED' }

    ssh.exe -p 22 $Remote "set -eu; chmod 600 '$RemoteFile'; printf '%s  %s\n' '$Expected' '$RemoteFile' | sha256sum -c -"
    if ($LASTEXITCODE -ne 0) { throw 'REMOTE_CHECKSUM_FAILED' }

    Write-Host 'UPLOAD_VERIFIED: no service changed'
}
```

## 2. 公司Ubuntu服务器执行

如未连接，在本地PowerShell先运行ssh.exe -p 22 t7920@192.168.64.3。已有t7920@t7920终端则直接执行：

```bash
(
    set -euo pipefail
    test "$(id -un)" = 't7920' || { echo 'STOP: run as t7920'; exit 1; }
    SCRIPT='/home/t7920/preview-uc-restore-20261005-r1-incoming/restore_preview_uc_20261005_r1.py'
    printf '%s  %s\n' '397c848231d0e8180487cb59823e276864746349380caa10e3e5e8c40ad3d1cd' "$SCRIPT" | sha256sum -c -
    python3 "$SCRIPT" --check-only
    python3 "$SCRIPT"
)
```

## 3. 验收

成功应出现PREVIEW_BACKEND_RESTORED，且main7000、frontend7100、console7200均OK，writes=false。仍须用户回传输出；然后刷新公司7200联调台并重新登录，先UC生成，再UC图。

联调台只生成候选，不保存/确认UC。UC图若返回empty，先检查批准项目/功能是否已有确认UC，不能将空集合分支当成Agent图生成成功。聊天等持久化流程不在此次范围，不打开业务写开关。Agent回调7000的链路仍不在7018抓取范围，不能承诺全链路均已捕获。
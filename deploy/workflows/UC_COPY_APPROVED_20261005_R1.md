# 批准的三条UC复制 — 2026-10-05 r1

## 范围

从测试项目1/行车记录仪DVR复制到新项目/DVR。源修订固定为用户报告中的当前head。已有文本全部保留，缺少分支槽按类别留空，PRD引用映射至目标已确认版本；不修改源对象和任何PRD，不复制FR或确认状态。生成3个新身份，由用户核对后人工确认。

## 验证与边界

28项复制测试（15项真实隔离PostgreSQL测试）及配套30项角色迁移测试通过，临时数据库已停止；另有6项容器身份测试和脚本语法/编码/hash检查。没有公司执行回执。

三条采用正式创建服务的三个独立事务；失败可能已提交部分，不声称全部回滚。固定ID用于安全恢复，禁止删除已有副本、换ID重试或改写已确认版本。check-only模式只读业务数据，但会在服务器incoming目录保存私有日志。执行期间不要同时修改源/目标或确认副本。

## 预生成新身份

- 查看行车记录仪实时影像: `59fa9c55-1691-4758-8c0a-c48eea56592d`
- 退出实时影像: `0a1a9943-a2e5-4506-8718-aa1e9bd4861d`
- 上电自动开启循环录像: `d5ca0b02-2e38-4854-be04-6b0a02b54646`

## Windows PowerShell 完整上传并执行指令

**本次检查通过后会实际创建待确认UC。不会自动确认。**

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $PSNativeCommandUseErrorActionPreference = $false
    $LocalPython = 'E:/Git projects/TS-frontend/deploy/workflows/copy_approved_ucs_20261005_r1.py'
    $LocalRun = 'E:/Git projects/TS-frontend/deploy/workflows/run-uc-copy-approved-20261005-r1.sh'
    $PythonHash = 'bd87772d4d5120b46e39815331e20fb273583c14e418c9f4497fe78c9d302fe3'
    $RunHash = '36bd0e03ab5b23b3286ec6e10e8fca6eda64b8b24f13f4f89b796d881352ade6'
    $Remote = 't7920@192.168.64.3'
    $Incoming = '/home/t7920/uc-copy-approved-20261005-r1-incoming'
    $RemotePython = "$Incoming/copy_approved_ucs_20261005_r1.py"
    $RemoteRun = "$Incoming/run-uc-copy-approved-20261005-r1.sh"

    if ((Get-FileHash -LiteralPath $LocalPython -Algorithm SHA256).Hash.ToLowerInvariant() -ne $PythonHash) {
        throw 'LOCAL_PYTHON_CHECKSUM_FAILED'
    }
    if ((Get-FileHash -LiteralPath $LocalRun -Algorithm SHA256).Hash.ToLowerInvariant() -ne $RunHash) {
        throw 'LOCAL_RUN_CHECKSUM_FAILED'
    }
    Write-Host 'LOCAL_CHECKSUMS_OK'

    ssh.exe -p 22 $Remote "umask 077; mkdir -- '$Incoming'"
    if ($LASTEXITCODE -ne 0) { throw 'DIRECTORY_EXISTS_OR_CREATE_FAILED: stop; do not overwrite' }

    scp.exe -P 22 $LocalPython $LocalRun "${Remote}:${Incoming}/"
    if ($LASTEXITCODE -ne 0) { throw 'UPLOAD_FAILED: stop; no copy started' }

    ssh.exe -p 22 $Remote "set -eu; chmod 600 '$RemotePython' '$RemoteRun'; printf '%s  %s\n' '$PythonHash' '$RemotePython' | sha256sum -c -; printf '%s  %s\n' '$RunHash' '$RemoteRun' | sha256sum -c -; bash '$RemoteRun' --check-only && bash '$RemoteRun' --apply"
    if ($LASTEXITCODE -ne 0) {
        throw 'COPY_STOPPED: paste full output; some copies may exist; do not delete or generate new IDs'
    }
    Write-Host 'UC_COPY_VERIFIED: three pending copies; confirm them manually in the original frontend'
}
```

## 回执和后续

成功须看到 `UC_COPY_COMPLETE_PENDING_CONFIRMATION`、`verified_copy_count: 3` 和 `confirmed_count: 0`。先贴完整输出，然后在原前端的新项目/DVR核对三条UC并逐条确认，再测试UC图。若失败，保留incoming目录、日志、固定ID及已有副本，贴完整输出；不要再次执行上传步骤或自行删除数据。

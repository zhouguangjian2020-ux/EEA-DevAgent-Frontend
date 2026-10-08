# UC复制只读预检 r4 — 2026-10-05

## 原因与修复

公司r3回执定位到目标UC创建权限检查。旧脚本把权限编码`uc.create`当作`resource_kind.action`能力名传入，正确的能力名为`UC.create`。这是我们脚本的错误，不据此给账号加权。r4在只读事务里直接复用正式创建入口的`business_access.authorize`。此前测试桩也使用错误小写预期，现已补实际鉴权函数测试。

38项离线测试通过；数据库使用离线桩，不是公司测试。Python/Bash/PowerShell语法、无BOM/LF及hash验证通过。鉴权/创建/来源三个源文件与冻结部署包逐字一致，旧交付未修改，容器校验函数未改。

## 安全边界

不改权限、不复制/确认UC、不调用Agent、不改服务，不启用7018写入。必须在只读repeatable-read事务内检查。目标真实权限、来源数量和版本、目标PRD及其hash、结构兼容性须等r4实际回执；存在blockers时不进入复制。不得把预检成功理解为已复制。

## 在本地 Windows PowerShell 执行

以下指令创建新的r4目录；如果目录已存在就停止，不删除/覆盖。已运行过则先贴完整输出，不要重复上传。

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $LocalPython = 'E:/Git projects/TS-frontend/deploy/workflows/inspect_uc_copy_20261005_r4.py'
    $LocalRun = 'E:/Git projects/TS-frontend/deploy/workflows/run-uc-copy-preflight-20261005-r4.sh'
    $PythonHash = '9b4fc23867729b9519b24e1d9c5d440b799f4487123f6f0324b4f045617522b9'
    $RunHash = '7462d8e7de618eae7a957221b85d6ae0ed3638727d172f1531914e8769ac1395'
    $Remote = 't7920@192.168.64.3'
    $Incoming = '/home/t7920/uc-copy-preflight-20261005-r4-incoming'
    $RemotePython = "$Incoming/inspect_uc_copy_20261005_r4.py"
    $RemoteRun = "$Incoming/run-uc-copy-preflight-20261005-r4.sh"

    if ((Get-FileHash -LiteralPath $LocalPython -Algorithm SHA256).Hash.ToLowerInvariant() -ne $PythonHash) {
        throw 'LOCAL_PYTHON_CHECKSUM_FAILED'
    }
    if ((Get-FileHash -LiteralPath $LocalRun -Algorithm SHA256).Hash.ToLowerInvariant() -ne $RunHash) {
        throw 'LOCAL_RUN_CHECKSUM_FAILED'
    }
    Write-Host 'LOCAL_CHECKSUMS_OK'

    ssh.exe -p 22 $Remote "umask 077; mkdir -- '$Incoming'"
    if ($LASTEXITCODE -ne 0) {
        throw 'CREATE_DIRECTORY_FAILED: stop; do not overwrite existing files'
    }

    scp.exe -P 22 $LocalPython $LocalRun "${Remote}:${Incoming}/"
    if ($LASTEXITCODE -ne 0) { throw 'UPLOAD_FAILED' }

    ssh.exe -p 22 $Remote "set -eu; chmod 600 '$RemotePython' '$RemoteRun'; echo '$PythonHash  $RemotePython' | sha256sum -c -; echo '$RunHash  $RemoteRun' | sha256sum -c -; bash '$RemoteRun'"
    if ($LASTEXITCODE -ne 0) {
        throw 'READ_ONLY_PREFLIGHT_NOT_PASSED: paste complete output including stage and error_code; no copying yet'
    }

    Write-Host 'READ_ONLY_INSPECTION_FINISHED: no UC copied or confirmed'
}
```

## SHA256

- `inspect_uc_copy_20261005_r4.py`: `9b4fc23867729b9519b24e1d9c5d440b799f4487123f6f0324b4f045617522b9`

- `run-uc-copy-preflight-20261005-r4.sh`: `7462d8e7de618eae7a957221b85d6ae0ed3638727d172f1531914e8769ac1395`

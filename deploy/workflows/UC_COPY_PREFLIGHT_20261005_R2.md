# UC复制只读预检r2：镜像引用误判修复

## 原因与证据
用户r1执行停在容器校验，未运行数据库预检，未复制任何UC。r1把Config.Image限定为标签，但先前cutover_main_workflows_20261004_r1.py按IMAGE_ID创建主后端；这是预检对合法容器的误判缺陷。真实运行字段仍需本次输出确认，不假定其他字段一定正常。

## 修复边界
仅允许已知标签或完整固定镜像ID作为启动引用；实际Image字段仍必须等于sha256:4ca6143e223802bc957256f55e78c3f648f3d010208fba2f2171f77df4abb989，且running=true、network=host。打印这四项安全字段，不输出环境或凭证。
r1 Python脚本和r1启动器保持原哈希；r2复用已上传的只读Python文件。无业务代码、数据库、容器配置或服务状态变更。
13项离线guard测试通过，覆盖tag/ID正常路径及真实镜像、运行状态、网络、字段数量异常；Bash/PowerShell语法和UTF-8无BOM/LF检查通过。

## 本地Windows PowerShell：完整上传并运行
这里只读检查，源UC清单仍待公司回执；不执行复制或确认。
```powershell
& {
    $ErrorActionPreference = 'Stop'
    $Local = 'E:/Git projects/TS-frontend/deploy/workflows/run-uc-copy-preflight-20261005-r2.sh'
    $Expected = '6ad0e3063d61b1014c58943bb99917f36b84d774f7c111b29ddd3e9ad7bbf2fb'
    $Remote = 't7920@192.168.64.3'
    $Incoming = '/home/t7920/uc-copy-preflight-20261005-r2-incoming'
    $RemoteScript = "$Incoming/run-uc-copy-preflight-20261005-r2.sh"

    if ((Get-FileHash -LiteralPath $Local -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
        throw 'LOCAL_CHECKSUM_FAILED'
    }
    Write-Host 'LOCAL_CHECKSUM_OK'

    ssh.exe -p 22 $Remote "umask 077; mkdir -- '$Incoming'"
    if ($LASTEXITCODE -ne 0) {
        throw 'CREATE_DIRECTORY_FAILED: stop; do not overwrite existing files'
    }

    scp.exe -P 22 $Local "${Remote}:${Incoming}/"
    if ($LASTEXITCODE -ne 0) { throw 'UPLOAD_FAILED' }

    ssh.exe -p 22 $Remote "set -eu; chmod 600 '$RemoteScript'; echo '$Expected  $RemoteScript' | sha256sum -c -; bash '$RemoteScript'"
    if ($LASTEXITCODE -ne 0) {
        throw 'READ_ONLY_PREFLIGHT_NOT_PASSED: paste complete output; no copying yet'
    }

    Write-Host 'READ_ONLY_INSPECTION_FINISHED: no UC copied or confirmed'
}
```

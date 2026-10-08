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

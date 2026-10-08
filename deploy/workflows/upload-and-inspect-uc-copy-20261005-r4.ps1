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

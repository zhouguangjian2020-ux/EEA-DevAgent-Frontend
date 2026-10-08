& {
    $ErrorActionPreference = 'Stop'
    $LocalPython = 'E:/Git projects/TS-frontend/deploy/workflows/inspect_uc_copy_20261005_r1.py'
    $LocalRun = 'E:/Git projects/TS-frontend/deploy/workflows/run-uc-copy-preflight-20261005-r1.sh'
    $PythonHash = 'b4a850c1794750d99e63c6150dd2f52c1d4013fb6ed6854559884caee2d9b06d'
    $RunHash = '129a0f635c0f151c96e73fb618c2060442549227f7f6814ec6defbdb1532abb7'
    $Remote = 't7920@192.168.64.3'
    $Incoming = '/home/t7920/uc-copy-preflight-20261005-r1-incoming'
    $RemotePython = "$Incoming/inspect_uc_copy_20261005_r1.py"
    $RemoteRun = "$Incoming/run-uc-copy-preflight-20261005-r1.sh"

    if ((Get-FileHash -LiteralPath $LocalPython -Algorithm SHA256).Hash.ToLowerInvariant() -ne $PythonHash) { throw 'LOCAL_PYTHON_CHECKSUM_FAILED' }
    if ((Get-FileHash -LiteralPath $LocalRun -Algorithm SHA256).Hash.ToLowerInvariant() -ne $RunHash) { throw 'LOCAL_RUN_CHECKSUM_FAILED' }
    Write-Host 'LOCAL_CHECKSUMS_OK'

    ssh.exe -p 22 $Remote "umask 077; mkdir -- '$Incoming'"
    if ($LASTEXITCODE -ne 0) { throw 'CREATE_DIRECTORY_FAILED: stop; do not overwrite existing files' }

    scp.exe -P 22 $LocalPython $LocalRun "${Remote}:${Incoming}/"
    if ($LASTEXITCODE -ne 0) { throw 'UPLOAD_FAILED' }

    ssh.exe -p 22 $Remote "set -eu; chmod 600 '$RemotePython' '$RemoteRun'; echo '$PythonHash  $RemotePython' | sha256sum -c -; echo '$RunHash  $RemoteRun' | sha256sum -c -; bash '$RemoteRun'"
    if ($LASTEXITCODE -ne 0) { throw 'READ_ONLY_PREFLIGHT_NOT_PASSED: paste output; do not copy or modify data yet' }

    Write-Host 'READ_ONLY_INSPECTION_FINISHED: no UC copied or confirmed'
}

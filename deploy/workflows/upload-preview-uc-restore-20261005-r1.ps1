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

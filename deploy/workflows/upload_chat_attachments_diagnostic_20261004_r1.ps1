& {
    $ErrorActionPreference = 'Stop'
    $Script = 'E:/Git projects/TS-frontend/deploy/workflows/inspect_chat_attachments_20261004_r1.py'
    $Expected = '31509ee4b5f03e80600e0513f940adb6308223368ac40877f857a3e1a943ac05'
    $Remote = 't7920@192.168.64.3'
    $Incoming = '/home/t7920/chat-attachment-diagnostics-20261004-r1-incoming'
    $RemoteFile = "$Incoming/inspect_chat_attachments_20261004_r1.py"

    if ((Get-FileHash -LiteralPath $Script -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
        throw 'LOCAL_CHECKSUM_FAILED'
    }
    Write-Host 'LOCAL_CHECKSUM_OK'

    ssh.exe -p 22 $Remote "umask 077; mkdir -- '$Incoming'"
    if ($LASTEXITCODE -ne 0) { throw 'CREATE_DIRECTORY_FAILED: stop; do not overwrite an existing directory' }

    scp.exe -P 22 $Script "${Remote}:${Incoming}/"
    if ($LASTEXITCODE -ne 0) { throw 'UPLOAD_FAILED' }

    ssh.exe -p 22 $Remote "set -eu; chmod 600 '$RemoteFile'; printf '%s  %s\n' '$Expected' '$RemoteFile' | sha256sum -c -"
    if ($LASTEXITCODE -ne 0) { throw 'REMOTE_CHECKSUM_FAILED' }

    Write-Host 'UPLOAD_VERIFIED: no service changed'
}

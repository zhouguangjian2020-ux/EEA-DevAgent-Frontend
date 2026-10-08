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

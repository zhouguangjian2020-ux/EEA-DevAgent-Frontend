& {
    $ErrorActionPreference = 'Stop'
    $PSNativeCommandUseErrorActionPreference = $false
    $Remote = 't7920@192.168.64.3'
    $Directory = '/home/t7920/uc-copy-preflight-20261005-r4-incoming'
    $Python = $Directory + '/inspect_uc_copy_20261005_r4.py'
    $Runner = $Directory + '/run-uc-copy-preflight-20261005-r4.sh'
    $PythonHash = '9b4fc23867729b9519b24e1d9c5d440b799f4487123f6f0324b4f045617522b9'
    $RunnerHash = '7462d8e7de618eae7a957221b85d6ae0ed3638727d172f1531914e8769ac1395'
    $Command = 'set -eu; ' +
        ('echo ''{0}  {1}'' | sha256sum -c -; ' -f $PythonHash, $Python) +
        ('echo ''{0}  {1}'' | sha256sum -c -; ' -f $RunnerHash, $Runner) +
        ('bash ''{0}''' -f $Runner)

    Write-Host 'READ_ONLY_CHECK_RUNNING: no upload, copy, confirmation or service change'
    $PreviousConsoleEncoding = [Console]::OutputEncoding
    $PreviousOutputEncoding = $OutputEncoding
    try {
        $Utf8 = [System.Text.UTF8Encoding]::new($false)
        [Console]::OutputEncoding = $Utf8
        $OutputEncoding = $Utf8
        $Output = @(ssh.exe -p 22 -o ConnectTimeout=10 $Remote $Command)
        $ExitCode = $LASTEXITCODE
    } finally {
        [Console]::OutputEncoding = $PreviousConsoleEncoding
        $OutputEncoding = $PreviousOutputEncoding
    }
    $Text = $Output -join [Environment]::NewLine
    $Reports = [regex]::Matches($Text, '(?ms)^\{\r?\n.*?^\}\r?$')
    if ($Reports.Count -ne 1) {
        Write-Output $Text
        throw ('REPORT_NOT_FOUND_OR_AMBIGUOUS: SSH_EXIT=' + $ExitCode)
    }
    $Report = $Reports[0].Value | ConvertFrom-Json
    $HasBlockers = $Report.PSObject.Properties.Name -contains 'blockers' -and $Report.blockers -is [array]
    $IsBlocked = $ExitCode -eq 2 -and $HasBlockers -and $Report.blockers.Count -gt 0
    if ($IsBlocked) {
        Write-Host 'RESULT=BLOCKED: review the JSON below; no UC was copied'
    } elseif ($ExitCode -eq 0 -and $HasBlockers -and $Report.blockers.Count -eq 0) {
        Write-Host 'RESULT=PREFLIGHT_OK_ONLY: no UC was copied'
    } else {
        Write-Output ($Report | ConvertTo-Json -Depth 20)
        throw ('INSPECTION_FAILED: SSH_EXIT=' + $ExitCode)
    }
    Write-Output ($Report | ConvertTo-Json -Depth 20)
}

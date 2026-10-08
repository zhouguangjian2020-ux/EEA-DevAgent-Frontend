$ErrorActionPreference = 'Stop'
$Collector = Join-Path $PSScriptRoot 'collect-uc-copy-r4-report-20261005.ps1'
$Good = [ordered]@{blockers=@(); source_ucs=@(); copy_performed=$false; confirmation_performed=$false} | ConvertTo-Json -Depth 10
$Blocked = [ordered]@{blockers=@('UC_SCHEMA_REQUIRES_REVIEW_NO_TRUNCATION_ALLOWED'); source_ucs=@(@{invalid_field_paths=@('branches'); branch_count=5}); copy_performed=$false; confirmation_performed=$false} | ConvertTo-Json -Depth 10
$Failed = [ordered]@{stage='target.uc.create_permission'; error_code='business_write_forbidden'; http_status=403; copy_performed=$false; confirmation_performed=$false} | ConvertTo-Json -Depth 10
$Cases = @(
    @{Name='blocked_report'; Body=$Blocked; Status=2; Throws=$false; Expected='RESULT=BLOCKED'},
    @{Name='successful_preflight_not_copy'; Body=$Good; Status=0; Throws=$false; Expected='RESULT=PREFLIGHT_OK_ONLY'},
    @{Name='safe_authorization_failure'; Body=$Failed; Status=1; Throws=$true; Expected='INSPECTION_FAILED'},
    @{Name='missing_json'; Body='checksum failed'; Status=1; Throws=$true; Expected='REPORT_NOT_FOUND_OR_AMBIGUOUS'},
    @{Name='ssh_failure'; Body='unreachable'; Status=255; Throws=$true; Expected='REPORT_NOT_FOUND_OR_AMBIGUOUS'},
    @{Name='two_reports'; Body=($Good+[char]10+$Blocked); Status=2; Throws=$true; Expected='REPORT_NOT_FOUND_OR_AMBIGUOUS'},
    @{Name='exit_two_without_blockers'; Body=$Failed; Status=2; Throws=$true; Expected='INSPECTION_FAILED'},
    @{Name='empty_blockers_exit_two'; Body=$Good; Status=2; Throws=$true; Expected='INSPECTION_FAILED'},
    @{Name='nonempty_blockers_exit_zero'; Body=$Blocked; Status=0; Throws=$true; Expected='INSPECTION_FAILED'},
    @{Name='null_blockers'; Body=([ordered]@{blockers=$null}|ConvertTo-Json); Status=2; Throws=$true; Expected='INSPECTION_FAILED'},
    @{Name='lf_only'; Body=$Blocked.Replace([string][char]13,''); Status=2; Throws=$false; Expected='RESULT=BLOCKED'},
    @{Name='crlf'; Body=$Blocked.Replace([string][char]13,'').Replace([string][char]10,([string][char]13+[char]10)); Status=2; Throws=$false; Expected='RESULT=BLOCKED'}
)
function ssh.exe {
    $global:UCReportTestCalls += 1
    $global:UCReportTestRemoteCommand = $args[-1]
    $global:LASTEXITCODE = $global:UCReportTestCase.Status
    Write-Output ('safe checksum preamble'+[char]10+$global:UCReportTestCase.Body+[char]10+'UC_COPY_PREFLIGHT_END')
}
foreach($Case in $Cases){
    $global:UCReportTestCase=$Case
    $global:UCReportTestCalls=0; $Threw=$false; $Results=@(); $ErrorText=''
    try { & $Collector 6>&1 | ForEach-Object {$Results += [string]$_} }
    catch {$Threw=$true; $ErrorText=$_.Exception.Message}
    if($Threw -ne $Case.Throws){throw ('INCORRECT_THROW_STATE: '+$Case.Name+' detail='+$ErrorText)}
    $Combined=($Results -join [Environment]::NewLine)+$ErrorText
    if(-not $Combined.Contains($Case.Expected)){throw ('EXPECTED_OUTPUT_MISSING: '+$Case.Name)}
    if($global:UCReportTestCalls -ne 1){throw 'UNEXPECTED_SSH_CALL_COUNT'}
    if(-not $global:UCReportTestRemoteCommand.Contains('9b4fc23867729b9519b24e1d9c5d440b799f4487123f6f0324b4f045617522b9')){throw 'PYTHON_CHECKSUM_GUARD_MISSING'}
    if(-not $global:UCReportTestRemoteCommand.Contains('7462d8e7de618eae7a957221b85d6ae0ed3638727d172f1531914e8769ac1395')){throw 'RUNNER_CHECKSUM_GUARD_MISSING'}
    if($global:UCReportTestRemoteCommand -match 'scp|sudo|docker (stop|start|restart)|INSERT|UPDATE|DELETE'){throw 'UNEXPECTED_REMOTE_OPERATION'}
    Write-Output ('PASS '+$Case.Name)
}
Write-Output ('OFFLINE_REPORT_EXTRACTION_TESTS_OK count='+$Cases.Count+'; SSH mocked; no network or database used')

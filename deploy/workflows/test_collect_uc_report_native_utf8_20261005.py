from pathlib import Path
import base64, hashlib, json, shutil, subprocess, sys
HERE=Path(__file__).resolve().parent
OLD=HERE/'collect-uc-copy-r4-report-20261005.ps1'
FIXED=HERE/'collect-uc-copy-r4-report-utf8-20261005.ps1'
PYTHON=Path('E:/Git projects/TS-backend/.venv/Scripts/python.exe')
NATIVE='ssh.exe -p 22 -o ConnectTimeout=10 $Remote $Command'

def ps_literal(text):
    return chr(39)+text.replace(chr(39),chr(39)*2)+chr(39)

def exercise(host, script_file, codepage, state, expected_failure):
    fixture={'target':{'project_name':'新项目'},'source_ucs':[{'name':'查看行车记录仪实时影像'},{'name':'退出实时影像'},{'name':'上电自动开启循环录像'}], 'blockers':['UC_SCHEMA_REQUIRES_REVIEW_NO_TRUNCATION_ALLOWED'] if state=='blocked' else [], 'copy_performed':False,'confirmation_performed':False}
    if state=='failed': fixture={'stage':'target.uc.create_permission','error_code':'business_write_forbidden','http_status':403,'copy_performed':False,'confirmation_performed':False}
    exit_code={'blocked':2,'ok':0,'failed':1}[state]
    raw=('safe preamble'+chr(10)+json.dumps(fixture,ensure_ascii=False,indent=2)+chr(10)+'safe ending'+chr(10)).encode('utf-8')
    emitter='import sys;sys.stdout.buffer.write(bytes.fromhex('+repr(raw.hex())+'));sys.exit('+str(exit_code)+')'
    text=script_file.read_text(encoding='utf-8')
    assert text.count(NATIVE)==1
    adapted=text.replace(NATIVE,'& '+ps_literal(str(PYTHON))+' -c '+ps_literal(emitter))
    assert 'ssh.exe' not in adapted
    wrapper='''
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::GetEncoding(__CODEPAGE__)
$OutputEncoding=[System.Text.Encoding]::ASCII
$BeforeConsole=[Console]::OutputEncoding.CodePage
$BeforeOutput=$OutputEncoding.CodePage
$Failed=$false
try {
    $Messages=@(& {
__COLLECTOR__
    } 6>$null)
    $Decoded=($Messages -join [Environment]::NewLine) | ConvertFrom-Json
    if($Decoded.target.project_name -cne '新项目'){throw 'CHINESE_PROJECT_NAME_CORRUPTED'}
    if($Decoded.source_ucs[0].name -cne '查看行车记录仪实时影像'){throw 'CHINESE_UC_NAME_CORRUPTED'}
    if($Decoded.source_ucs[2].name -cne '上电自动开启循环录像'){throw 'CHINESE_UC_NAME_CORRUPTED'}
} catch { $Failed=$true }
if([Console]::OutputEncoding.CodePage -ne $BeforeConsole -or $OutputEncoding.CodePage -ne $BeforeOutput){
    Write-Output 'ENCODING_RESTORE_FAILED';exit 2
}
if($Failed -ne __EXPECTED_FAILURE__){Write-Output 'UNEXPECTED_TEST_OUTCOME';exit 3}
Write-Output ('TEST_OK host='+$PSVersionTable.PSVersion.ToString()+' initial_codepage=__CODEPAGE__')
'''
    wrapper=wrapper.replace('__CODEPAGE__',str(codepage)).replace('__COLLECTOR__',adapted).replace('__EXPECTED_FAILURE__','$true' if expected_failure else '$false')
    encoded=base64.b64encode(wrapper.encode('utf-16le')).decode('ascii')
    result=subprocess.run([str(host),'-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded],capture_output=True,timeout=30)
    output=result.stdout.decode('ascii',errors='replace').strip()
    if result.returncode!=0 or not output.startswith('TEST_OK '):
        raise AssertionError({'test':(script_file.name,codepage,state),'status':result.returncode,'safe_stdout':output})
    return {'host':str(host),'script':script_file.name,'initial_codepage':codepage,'state':state,'expected_failure':expected_failure,'result':output}

def main():
    hosts=[Path('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')]
    core=shutil.which('pwsh')
    if core: hosts.append(Path(core))
    results=[]
    for host in hosts:
        assert host.exists(),host
        for script,cp,state,failed in [(OLD,936,'blocked',True),(FIXED,936,'blocked',False),(FIXED,65001,'blocked',False),(FIXED,936,'ok',False),(FIXED,936,'failed',True)]:
            record=exercise(host,script,cp,state,failed)
            results.append(record)
            print(record['result']+' script='+script.name+' state='+state+' expected_failure='+str(failed))
    receipt={'native_process_tests':len(results),'results':results,'network_used':False,'database_used':False,'ssh_used':False,'fixed_sha256':hashlib.sha256(FIXED.read_bytes()).hexdigest()}
    (HERE/'uc-report-native-utf8-test-results-20261005.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+chr(10),encoding='utf-8')
    print('NATIVE_PROCESS_UTF8_TESTS_OK count='+str(len(results)))

if __name__=='__main__':main()

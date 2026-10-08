from pathlib import Path
import importlib.util,subprocess,sys
BACK=Path('E:/Git projects/TS-backend')
sys.path.insert(0,str(BACK));sys.path.insert(0,str(BACK/'tests'))
spec=importlib.util.spec_from_file_location('local_manual_runner',BACK/'tests/run_manual_postgres.py')
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
original_run=subprocess.run
replacement_count=0
def local_run(argv,*args,**kwargs):
    global replacement_count
    command=[str(x) for x in argv]
    if '-m' in command and 'pytest' in command and 'tests/test_workflows_postgres.py' in command:
        command=[sys.executable,'-m','pytest','-q',str(Path(__file__).parent/'test_copy_approved_ucs_20261005_r1.py')]
        replacement_count+=1
    return original_run(command,*args,**kwargs)
subprocess.run=local_run
sys.argv=[str(BACK/'tests/run_manual_postgres.py'),'--workflow-focused']
try:
    rc=runner.main()
    assert replacement_count==1
finally:
    subprocess.run=original_run
sys.exit(rc)

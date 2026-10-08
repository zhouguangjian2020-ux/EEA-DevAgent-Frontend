import contextlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent.parent
SQL_ROOT=ROOT/'docs/current/database/agent-workflows-r1'

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

m=load('migration',HERE/'migrate_workflows_20261004_r1.py')
tc=load('cutover_fixtures',HERE/'test_cutover_main_workflows_20261004_r1.py')
h=tc.m

class MigrationTests(unittest.TestCase):
    def execute(self, fail=None, check_only=False, readiness=None, sql_outputs=None, mutation=None):
        fake=tc.FakeDocker(fail if fail in ('start','stop') else None)
        fake.prepared()['State'].update(Status='running',Running=True)
        timeline=[]
        labels=[]
        sql_outputs=sql_outputs or {}
        payload=m.package_bytes(SQL_ROOT)
        def docker(*args,**kwargs):
            timeline.append(('docker',args[0]))
            return fake(*args,**kwargs)
        def command(argv,log_dir,label,**kwargs):
            timeline.append(('command',label)); labels.append(label)
            if label in ('preflight','quiet'):
                self.assertTrue(kwargs['input_text'].startswith('BEGIN READ ONLY;'))
            if label in ('apply','verify'):
                self.assertEqual(argv[-2],'-f')
                self.assertEqual(Path(argv[-1]).name,label+'.sql')
                self.assertIn('PGOPTIONS=-c default_transaction_read_only='+('off' if label=='apply' else 'on')+
                              ' -c statement_timeout=60000 -c lock_timeout=5000 -c client_min_messages=warning',argv)
            if fail==label: raise RuntimeError('FIXTURE_FAILURE_'+label)
            if label=='verify' and mutation=='identity': fake.containers[h.NEW]['Id']='replacement'
            if label=='verify' and mutation=='source': fake.containers[h.OLD]['Config']['User']='changed'
            return sql_outputs.get(label,{'sudo-check':'','preflight':'MIGRATION_PREFLIGHT_OK',
                    'quiet':'DATABASE_QUIET_OK','apply':'BEGIN\nCOMMIT\n','verify':'WORKFLOW_SCHEMA_OK\nROLLBACK\n'}[label])
        output=io.StringIO()
        before_umask=os.umask(0o077)
        try:
            with tempfile.TemporaryDirectory(prefix='migration-test-',dir=ROOT/'tmp') as directory:
                base=Path(directory).resolve()
                self.assertTrue(base.is_relative_to((ROOT/'tmp').resolve()))
                with contextlib.ExitStack() as stack:
                    stack.enter_context(mock.patch.object(m.Path,'home',return_value=base))
                    stack.enter_context(mock.patch.object(m,'PSQL',sys.executable))
                    stack.enter_context(mock.patch.object(m,'load_helper',return_value=h,side_effect=RuntimeError('BAD_HELPER') if fail=='helper' else None))
                    stack.enter_context(mock.patch.object(m,'package_bytes',return_value=payload,side_effect=RuntimeError('BAD_PACKAGE') if fail=='package' else None))
                    stack.enter_context(mock.patch.object(m,'stage_sql',return_value=Path('/fixture/sql'),side_effect=RuntimeError('BAD_STAGE') if fail=='stage' else None))
                    stack.enter_context(mock.patch.object(m,'command',side_effect=command))
                    stack.enter_context(mock.patch.object(h,'docker',side_effect=docker))
                    stack.enter_context(mock.patch.object(h,'validate_backup',side_effect=RuntimeError('BAD_BACKUP') if fail=='backup' else None))
                    stack.enter_context(mock.patch.object(h,'check_backup_age',side_effect=RuntimeError('STALE_BACKUP') if fail=='age' else None))
                    stack.enter_context(mock.patch.object(h,'http_json',return_value={'status':'ok'}))
                    stack.enter_context(mock.patch.object(h,'validate_openapi'))
                    stack.enter_context(mock.patch.object(h,'require_free_ports',side_effect=RuntimeError('OCCUPIED') if fail=='port' else None))
                    stack.enter_context(mock.patch.object(h,'wait_ready',side_effect=readiness))
                    stack.enter_context(mock.patch.object(m.signal,'signal'))
                    stack.enter_context(contextlib.redirect_stdout(output))
                    result=m.migrate(check_only=check_only)
                states=list(base.glob('*/state.json'))
                self.assertEqual(len(states),1)
                state=json.loads(states[0].read_text(encoding='utf-8'))
        finally:
            os.umask(before_umask)
        text=output.getvalue()
        self.assertNotIn(tc.SECRET,text); self.assertNotIn('private-value',text)
        for call in fake.calls:
            if call[0] in ('start','stop','update'):
                self.assertEqual(call[-1],'new-id')
            self.assertNotIn(call[0],('create','rm','run','build','exec','restart'))
        self.assertFalse(fake.containers[h.OLD]['State']['Running'])
        self.assertFalse(fake.containers[h.PREVIEW]['State']['Running'])
        for name in h.UNCHANGED: self.assertTrue(fake.containers[name]['State']['Running'])
        return result,state,text,fake,timeline,labels

    def test_success_order_and_scope(self):
        result,state,text,fake,events,labels=self.execute()
        self.assertEqual(result,0); self.assertIn('WORKFLOW_DB_MIGRATION_OK',text)
        self.assertTrue(state['apply_committed']); self.assertTrue(state['schema_verified'])
        self.assertTrue(fake.containers[h.NEW]['State']['Running'])
        self.assertLess(events.index(('docker','stop')),events.index(('command','apply')))
        self.assertLess(events.index(('command','apply')),events.index(('command','verify')))
        self.assertLess(events.index(('command','verify')),events.index(('docker','start')))
        self.assertEqual(labels,['sudo-check','preflight','quiet','apply','verify'])
        self.assertFalse(state['presets_initialized']); self.assertFalse(state['other_services_changed'])

    def test_readonly_check_never_stops_or_applies(self):
        result,state,text,fake,_,labels=self.execute(check_only=True)
        self.assertEqual(result,0); self.assertIn('CHECK_ONLY_OK',text)
        self.assertEqual(labels,['sudo-check','preflight'])
        self.assertTrue(all(c[0]=='inspect' for c in fake.calls))
        self.assertFalse(state['apply_attempted'])

    def test_preflight_failures_preserve_running_main(self):
        for fail in ('helper','package','backup','sudo-check','preflight','stage','age'):
            with self.subTest(fail=fail):
                result,state,text,fake,_,labels=self.execute(fail=fail)
                self.assertEqual(result,1); self.assertFalse(state['apply_attempted'])
                self.assertFalse(any(c[0] in ('start','stop','update') for c in fake.calls))
                self.assertTrue(fake.containers[h.NEW]['State']['Running'])

    def test_port_and_quiet_failures_do_not_migrate_or_restart(self):
        for fail in ('port','quiet'):
            with self.subTest(fail=fail):
                result,state,_,fake,_,labels=self.execute(fail=fail)
                self.assertEqual(result,1); self.assertFalse(state['apply_attempted'])
                self.assertFalse(fake.containers[h.NEW]['State']['Running'])
                self.assertNotIn('apply',labels); self.assertFalse(any(c[0]=='start' for c in fake.calls))

    def test_apply_failure_has_uncertain_outcome_and_no_restart(self):
        result,state,text,fake,_,labels=self.execute(fail='apply')
        self.assertEqual(result,1); self.assertTrue(state['apply_attempted'])
        self.assertFalse(state['apply_committed']); self.assertNotIn('verify',labels)
        self.assertIn('APPLY_RESULT_REQUIRES_INSPECTION',text)
        self.assertFalse(fake.containers[h.NEW]['State']['Running'])

    def test_missing_commit_marker_not_called_success(self):
        result,state,_,fake,_,labels=self.execute(sql_outputs={'apply':'BEGIN\n'})
        self.assertEqual(result,1); self.assertFalse(state['apply_committed'])
        self.assertNotIn('verify',labels); self.assertFalse(fake.containers[h.NEW]['State']['Running'])

    def test_verify_failure_keeps_committed_schema_and_main_stopped(self):
        result,state,text,fake,_,labels=self.execute(fail='verify')
        self.assertEqual(result,1); self.assertTrue(state['apply_committed']); self.assertFalse(state['schema_verified'])
        self.assertIn('DATABASE_APPLY_COMMITTED',text); self.assertFalse(fake.containers[h.NEW]['State']['Running'])
        self.assertFalse(any(c[0]=='start' for c in fake.calls))

    def test_missing_verify_marker_stays_stopped(self):
        result,state,_,fake,_,_=self.execute(sql_outputs={'verify':'ROLLBACK\n'})
        self.assertEqual(result,1); self.assertTrue(state['apply_committed']); self.assertFalse(state['schema_verified'])
        self.assertFalse(fake.containers[h.NEW]['State']['Running'])

    def test_start_failure_stops_new_and_retains_database(self):
        result,state,text,fake,_,_=self.execute(fail='start')
        self.assertEqual(result,1); self.assertTrue(state['schema_verified'])
        self.assertIn('FAILED_MAIN_STOPPED_RETAINED',text)
        self.assertFalse(fake.containers[h.NEW]['State']['Running'])
        self.assertEqual(fake.containers[h.NEW]['HostConfig']['RestartPolicy']['Name'],'no')

    def test_readiness_failure_stops_new_and_retains_database(self):
        result,state,text,fake,_,_=self.execute(readiness=RuntimeError('NOT_READY'))
        self.assertEqual(result,1); self.assertTrue(state['schema_verified'])
        self.assertFalse(fake.containers[h.NEW]['State']['Running']); self.assertIn('DATABASE_APPLY_COMMITTED',text)

    def test_interrupt_during_readiness_keeps_maintenance(self):
        result,state,_,fake,_,_=self.execute(readiness=KeyboardInterrupt())
        self.assertEqual(result,1); self.assertTrue(state['maintenance_active'])
        self.assertFalse(fake.containers[h.NEW]['State']['Running'])

    def test_sql_command_pins_target_and_clears_ambient_pg_environment(self):
        for readonly in (True,False):
            args=m.sql_command(readonly)
            self.assertIn('-i',args); self.assertIn('-X',args); self.assertIn('-w',args)
            self.assertIn('expected_database=ee_platform',args)
            self.assertIn('expected_system_id=7686454253092706426',args)
            self.assertIn('ON_ERROR_STOP=1',args)
            self.assertEqual(args[args.index('-h')+1],'/var/run/postgresql')
            self.assertEqual(args[args.index('-d')+1],'ee_platform')

    def test_stop_failure_never_attempts_sql(self):
        result,state,text,fake,_,labels=self.execute(fail='stop')
        self.assertEqual(result,1); self.assertFalse(state['apply_attempted'])
        self.assertNotIn('quiet',labels); self.assertNotIn('apply',labels)
        self.assertTrue(fake.containers[h.NEW]['State']['Running'])
        self.assertIn('MAIN_STOP_ATTEMPTED',text)

    def test_identity_and_source_changes_after_commit_prevent_start(self):
        for mutation in ('identity','source'):
            with self.subTest(mutation=mutation):
                result,state,text,fake,_,_=self.execute(mutation=mutation)
                self.assertEqual(result,1); self.assertTrue(state['apply_committed'])
                self.assertTrue(state['schema_verified'])
                self.assertFalse(any(call[0]=='start' for call in fake.calls))
                self.assertIn('DATABASE_APPLY_COMMITTED',text)

class PackageTests(unittest.TestCase):
    def test_real_frozen_package(self):
        data=m.package_bytes(SQL_ROOT)
        self.assertEqual(set(data),set(m.FILES)|{'SHA256SUMS'})
        self.assertIn(b'COMMIT;',data['apply.sql'])
        self.assertNotIn(b'init-project-presets.sql',data['apply.sql'])

    def test_tampering_refused(self):
        for filename in ('SHA256SUMS','001_workflows.sql','apply.sql','verify.sql'):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory(prefix='migration-package-',dir=ROOT/'tmp') as directory:
                root=Path(directory).resolve(); self.assertTrue(root.is_relative_to((ROOT/'tmp').resolve()))
                for name in (*m.FILES,'SHA256SUMS'): shutil.copyfile(SQL_ROOT/name,root/name)
                with (root/filename).open('ab') as file: file.write(b'-- altered\n')
                with self.assertRaises(RuntimeError): m.package_bytes(root)

    def test_staging_uses_exact_bytes_and_explicit_paths(self):
        payload=m.package_bytes(SQL_ROOT)
        calls=[]
        def command(args,log_dir,label,**kwargs):
            calls.append((args,label))
            if label=='stage-owner':
                self.assertEqual(args[:4],['sudo','-n','chown','postgres:postgres'])
                self.assertNotIn('-R',args)
                return ''
            self.assertEqual(args[:5],['sudo','-n','-u','postgres','sha256sum'])
            return '\n'.join(m.digest(Path(path).read_bytes())+'  '+path for path in args[5:])
        with tempfile.TemporaryDirectory(prefix='migration-stage-',dir=ROOT/'tmp') as directory:
            root=Path(directory).resolve(); self.assertTrue(root.is_relative_to((ROOT/'tmp').resolve()))
            with mock.patch.object(m,'SQL_TEMP_ROOT',root), mock.patch.object(m,'command',side_effect=command):
                stage=m.stage_sql(payload,root)
            self.assertEqual(stage.parent,root)
            for name,data in payload.items(): self.assertEqual((stage/name).read_bytes(),data)
            self.assertEqual([label for _,label in calls],['stage-owner','stage-hashes'])


class CommandAndHelperTests(unittest.TestCase):
    def test_timeout_is_reported_without_raw_command(self):
        with tempfile.TemporaryDirectory(prefix='migration-command-',dir=ROOT/'tmp') as directory:
            path=Path(directory).resolve(); self.assertTrue(path.is_relative_to((ROOT/'tmp').resolve()))
            with mock.patch.object(m.subprocess,'run',side_effect=subprocess.TimeoutExpired('SECRET_COMMAND',1)):
                with self.assertRaisesRegex(RuntimeError,'COMMAND_UNAVAILABLE_OR_TIMEOUT') as raised:
                    m.command(['fake'],path,'apply')
            self.assertNotIn('SECRET_COMMAND',str(raised.exception))
            self.assertTrue((path/'apply.stdout.log').exists()); self.assertTrue((path/'apply.stderr.log').exists())

    def test_subprocess_nonzero_has_no_output_leak(self):
        with tempfile.TemporaryDirectory(prefix='migration-command-',dir=ROOT/'tmp') as directory:
            path=Path(directory).resolve(); self.assertTrue(path.is_relative_to((ROOT/'tmp').resolve()))
            with mock.patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess(['fake'],3)):
                with self.assertRaisesRegex(RuntimeError,'COMMAND_FAILED: verify; exit=3'):
                    m.command(['fake'],path,'verify')

    def test_actual_reviewed_helper_matches_recorded_digest(self):
        with mock.patch.object(m,'HELPER',HERE/'cutover_main_workflows_20261004_r1.py'):
            helper=m.load_helper()
        self.assertEqual(helper.IMAGE_ID,h.IMAGE_ID)

    def test_changed_helper_is_rejected_before_execution(self):
        with tempfile.TemporaryDirectory(prefix='migration-helper-',dir=ROOT/'tmp') as directory:
            path=Path(directory).resolve(); self.assertTrue(path.is_relative_to((ROOT/'tmp').resolve()))
            bad=path/'helper.py'; bad.write_text('raise Exception(1)',encoding='utf-8')
            with mock.patch.object(m,'HELPER',bad):
                with self.assertRaisesRegex(RuntimeError,'REVIEWED_HELPER_HASH_MISMATCH'): m.load_helper()
if __name__=='__main__':
    unittest.main(verbosity=2)

import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

baseline = load('copy_r1_test_fixtures', 'test_inspect_uc_copy_20261005_r1.py')
m = load('copy_r3', 'inspect_uc_copy_20261005_r3.py')
baseline.m = m

class ProjectReadError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message
        super().__init__(code)

class Tests(baseline.Tests):
    def setUp(self):
        self.output = io.StringIO()
        redirected = contextlib.redirect_stdout(self.output)
        redirected.__enter__()
        self.addCleanup(redirected.__exit__, None, None, None)
        m.STAGE = 'bootstrap'
    def test_success_readonly_three_pending_copies(self):
        db = baseline.FakeDB(); before = copy.deepcopy(db.contents)
        report = self.run_report(db)
        self.assertEqual(report['blockers'], [])
        self.assertEqual(len(report['source_ucs']), 3)
        self.assertFalse(report['copy_performed']); self.assertFalse(report['confirmation_performed'])
        self.assertTrue(report['target_create_permission_checked'])
        self.assertEqual(db.permissions, [(m.TARGET_PROJECT,m.TARGET_FUNCTION,'uc.create')])
        self.assertEqual(before, db.contents)
        self.assertNotIn('PRIVATE_CONTENT_NOT_FOR_REPORT', str(report))
    def test_source_visibility_is_mandatory(self):
        db = baseline.FakeDB()
        def visible(db, subject, project):
            if project == m.SOURCE_PROJECT:
                raise ProjectReadError(404,'project_not_found','secret internal detail')
        with self.assertRaises(ProjectReadError) as caught:
            m.inspect(db, visible, db.allowed, db.content, baseline.validate)
        safe = m.safe_failure(caught.exception)
        self.assertEqual(safe['stage'],'source.project_visibility')
        self.assertEqual(safe['http_status'],404)
        self.assertEqual(safe['error_code'],'project_not_found')
        self.assertFalse(any('FROM ee.artifacts' in q for q in db.statements))
    def test_target_visibility_is_mandatory(self):
        db = baseline.FakeDB()
        def visible(db, subject, project):
            if project == m.TARGET_PROJECT: raise ProjectReadError(404,'project_not_found','secret')
        with self.assertRaises(ProjectReadError) as caught:
            m.inspect(db, visible, db.allowed, db.content, baseline.validate)
        self.assertEqual(m.safe_failure(caught.exception)['stage'],'target.project_visibility')
        self.assertFalse(any('FROM ee.artifacts' in q for q in db.statements))
    def test_no_additional_source_uc_read_gate(self):
        db = baseline.FakeDB(); projects=[]
        def allowed(db, subject, project, function, permission):
            self.assertEqual((project,function,permission),(m.TARGET_PROJECT,m.TARGET_FUNCTION,'uc.create'))
        def visible(db, subject, project): projects.append(project)
        report=m.inspect(db,visible,allowed,db.content,baseline.validate)
        self.assertEqual(projects,[m.SOURCE_PROJECT,m.TARGET_PROJECT])
        self.assertEqual(report['blockers'],[])
    def test_target_create_denial_still_blocks(self):
        db=baseline.FakeDB()
        def denied(*args): raise ProjectReadError(403,'workflow_forbidden','internal-secret')
        with self.assertRaises(ProjectReadError) as caught:
            m.inspect(db,lambda *a:None,denied,db.content,baseline.validate)
        safe=m.safe_failure(caught.exception)
        self.assertEqual(safe['stage'],'target.uc.create_permission')
        self.assertEqual(safe['error_code'],'workflow_forbidden')
        self.assertEqual(safe['http_status'],403)
        self.assertFalse(any('FROM ee.artifacts' in q for q in db.statements))
    def test_database_cause_sqlstate_safe_without_message(self):
        cause=RuntimeError('postgres://user:DO_NOT_PRINT@example/db')
        cause.sqlstate='42501'
        error=ProjectReadError(503,'projects_database_unavailable','DO_NOT_PRINT')
        error.__cause__=cause
        safe=m.safe_failure(error)
        self.assertEqual(safe['sqlstate'],'42501')
        self.assertNotIn('DO_NOT_PRINT',json.dumps(safe))
        self.assertNotIn('postgres://',json.dumps(safe))
    def test_unknown_error_attributes_are_withheld(self):
        error=ProjectReadError('DO_NOT_PRINT','DO_NOT_PRINT','DO_NOT_PRINT')
        error.sqlstate='DO_NOT_PRINT'
        safe=m.safe_failure(error)
        self.assertEqual(safe['error_code'],'withheld_or_unclassified')
        self.assertIsNone(safe['http_status']); self.assertIsNone(safe['sqlstate'])
        self.assertNotIn('DO_NOT_PRINT',json.dumps(safe))
    def test_runtime_guard_allowlist(self):
        self.assertEqual(m.safe_failure(RuntimeError('READ_ONLY_REQUIRED'))['guard'],'READ_ONLY_REQUIRED')
        self.assertIsNone(m.safe_failure(RuntimeError('DO_NOT_PRINT'))['guard'])
    def test_sql_cause_cycles_are_bounded(self):
        a=RuntimeError('secret'); b=RuntimeError('secret')
        a.__cause__=b; b.__cause__=a
        self.assertIsNone(m.safe_failure(a)['sqlstate'])
    def test_stage_names_are_not_arbitrary_data(self):
        with self.assertRaisesRegex(RuntimeError,'INVALID_DIAGNOSTIC_STAGE'):
            m.mark_stage('postgres://DO_NOT_PRINT')
        self.assertNotIn('DO_NOT_PRINT',self.output.getvalue())
    def test_boolean_is_not_an_http_status(self):
        self.assertIsNone(m.safe_failure(ProjectReadError(True,'workflow_forbidden','secret'))['http_status'])
    def test_frozen_preflight_and_guard_unchanged(self):
        expected={'inspect_uc_copy_20261005_r1.py':'b4a850c1794750d99e63c6150dd2f52c1d4013fb6ed6854559884caee2d9b06d',
                  'run-uc-copy-preflight-20261005-r2.sh':'6ad0e3063d61b1014c58943bb99917f36b84d774f7c111b29ddd3e9ad7bbf2fb'}
        for name, value in expected.items():
            self.assertEqual(hashlib.sha256((HERE/name).read_bytes()).hexdigest(),value)

if __name__ == '__main__':
    unittest.main(verbosity=2)

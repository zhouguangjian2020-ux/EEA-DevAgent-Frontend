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
m = load('copy_r4', 'inspect_uc_copy_20261005_r4.py')
baseline.m = m

class ProjectReadError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message
        super().__init__(code)

def fixture_authorize(db, subject, project, permission, *, function_id=None):
    if permission != 'UC.create':
        raise AssertionError('WRONG_CAPABILITY_CASE')
    db.permissions.append((project, function_id, permission))

class Tests(baseline.Tests):
    def run_report(self, db):
        return m.inspect(db, lambda *a: None, fixture_authorize, db.content, baseline.validate)
    def test_permission_failure_stops_inspection(self):
        db = baseline.FakeDB()
        def denied(*args, **kwargs): raise RuntimeError('FORBIDDEN')
        with self.assertRaisesRegex(RuntimeError, 'FORBIDDEN'):
            m.inspect(db, lambda *a: None, denied, db.content, baseline.validate)
        self.assertFalse(any('FROM ee.artifacts' in q for q in db.statements))

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
        self.assertEqual(db.permissions, [(m.TARGET_PROJECT,m.TARGET_FUNCTION,'UC.create')])
        self.assertEqual(before, db.contents)
        self.assertNotIn('PRIVATE_CONTENT_NOT_FOR_REPORT', str(report))
    def test_source_visibility_is_mandatory(self):
        db = baseline.FakeDB()
        def visible(db, subject, project):
            if project == m.SOURCE_PROJECT:
                raise ProjectReadError(404,'project_not_found','secret internal detail')
        with self.assertRaises(ProjectReadError) as caught:
            m.inspect(db, visible, fixture_authorize, db.content, baseline.validate)
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
            m.inspect(db, visible, fixture_authorize, db.content, baseline.validate)
        self.assertEqual(m.safe_failure(caught.exception)['stage'],'target.project_visibility')
        self.assertFalse(any('FROM ee.artifacts' in q for q in db.statements))
    def test_no_additional_source_uc_read_gate(self):
        db = baseline.FakeDB(); projects=[]
        def allowed(db, subject, project, permission, *, function_id=None):
            function = function_id
            self.assertEqual((project,function,permission),(m.TARGET_PROJECT,m.TARGET_FUNCTION,'UC.create'))
        def visible(db, subject, project): projects.append(project)
        report=m.inspect(db,visible,allowed,db.content,baseline.validate)
        self.assertEqual(projects,[m.SOURCE_PROJECT,m.TARGET_PROJECT])
        self.assertEqual(report['blockers'],[])
    def test_target_create_denial_still_blocks(self):
        db=baseline.FakeDB()
        def denied(*args, **kwargs): raise ProjectReadError(403,'business_write_forbidden','internal-secret')
        with self.assertRaises(ProjectReadError) as caught:
            m.inspect(db,lambda *a:None,denied,db.content,baseline.validate)
        safe=m.safe_failure(caught.exception)
        self.assertEqual(safe['stage'],'target.uc.create_permission')
        self.assertEqual(safe['error_code'],'business_write_forbidden')
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


# Real application functions, offline database fixtures; never connect to a DB.
from types import SimpleNamespace
from unittest.mock import patch
from app.services import business_access, workflow_sources
from app.services.projects import ProjectReadError as RealProjectReadError, _SELECT
from pydantic import SecretStr

class AuthDB(baseline.FakeDB):
    def __init__(self, grants=None, visible=True):
        super().__init__()
        self.grants = {'UC.create'} if grants is None else set(grants)
        self.is_visible = visible
        self.auth_parameters = []
    def execute(self, sql, params=()):
        if sql.startswith(_SELECT):
            self.statements.append(sql)
            return baseline.Result({'id': params[-1]} if self.is_visible else None)
        if sql.startswith('SELECT id FROM ee.app_users'):
            self.statements.append(sql)
            return baseline.Result({'id': 'offline-engineer01-id'})
        compact = ' '.join(sql.split())
        if compact.startswith('SELECT DISTINCT pd.resource_kind'):
            self.statements.append(sql)
            self.auth_parameters.append(params)
            return baseline.Result([{'capability': value} for value in self.grants])
        if compact.startswith('SELECT 1 FROM ee.app_users'):
            self.statements.append(sql)
            self.auth_parameters.append(params)
            return baseline.Result({'allowed': 1} if params[2] in self.grants else None)
        return super().execute(sql, params)

class RealAuthorizerTests(unittest.TestCase):
    def setUp(self):
        self.settings = SimpleNamespace(business_writes_enabled=True,
            projects_write_database_url=SecretStr('offline-placeholder-never-opened'))
        self.patch = patch.object(business_access, 'settings', self.settings)
        self.patch.start(); self.addCleanup(self.patch.stop)
        self.stdout = io.StringIO()
        self.redirect = contextlib.redirect_stdout(self.stdout)
        self.redirect.__enter__(); self.addCleanup(self.redirect.__exit__, None, None, None)
    def inspect(self, db):
        return m.inspect(db, workflow_sources.visible, business_access.authorize, db.content, baseline.validate)
    def test_actual_authorizer_accepts_uppercase_uc_create(self):
        db = AuthDB()
        report = self.inspect(db)
        self.assertEqual(report['blockers'], [])
        self.assertEqual(report['target_create_capability'], 'UC.create')
        self.assertEqual(report['target_authorizer'], 'app.services.business_access.authorize')
        self.assertEqual(db.auth_parameters, [(m.TARGET_PROJECT, m.SUBJECT, m.TARGET_FUNCTION)])
    def test_reproduces_r3_false_denial_with_lowercase(self):
        db = AuthDB()
        with self.assertRaises(RealProjectReadError) as caught:
            workflow_sources.allowed(db, m.SUBJECT, m.TARGET_PROJECT, m.TARGET_FUNCTION, 'uc.create')
        self.assertEqual(caught.exception.code, 'workflow_forbidden')
        workflow_sources.allowed(db, m.SUBJECT, m.TARGET_PROJECT, m.TARGET_FUNCTION, 'UC.create')
    def test_real_authorizer_rejects_lowercase_too(self):
        with self.assertRaises(RealProjectReadError) as caught:
            business_access.authorize(AuthDB(), m.SUBJECT, m.TARGET_PROJECT, 'uc.create', function_id=m.TARGET_FUNCTION)
        self.assertEqual(caught.exception.code, 'business_write_forbidden')
    def test_actual_permission_denial_is_not_bypassed(self):
        db = AuthDB(grants={'PRD.create'})
        with self.assertRaises(RealProjectReadError) as caught: self.inspect(db)
        safe = m.safe_failure(caught.exception)
        self.assertEqual((safe['stage'], safe['error_code'], safe['http_status']),
                         ('target.uc.create_permission', 'business_write_forbidden', 403))
        self.assertFalse(any('FROM ee.artifacts' in q for q in db.statements))
    def test_lowercase_grant_is_not_silently_normalized(self):
        with self.assertRaises(RealProjectReadError): self.inspect(AuthDB(grants={'uc.create'}))
    def test_disabled_business_writes_remains_blocked(self):
        self.settings.business_writes_enabled = False
        with self.assertRaises(RealProjectReadError): self.inspect(AuthDB())
    def test_missing_writer_configuration_remains_blocked(self):
        self.settings.projects_write_database_url = SecretStr('')
        with self.assertRaises(RealProjectReadError): self.inspect(AuthDB())
    def test_actual_project_visibility_remains_required(self):
        with self.assertRaises(RealProjectReadError) as caught: self.inspect(AuthDB(visible=False))
        self.assertEqual(caught.exception.code, 'project_not_found')
    def test_real_authorizer_only_issues_select_and_show(self):
        db = AuthDB(); self.inspect(db)
        self.assertTrue(all(q.lstrip().startswith(('SELECT ', 'SHOW ')) for q in db.statements))
        query = next(q for q in db.statements if 'SELECT DISTINCT pd.resource_kind' in q)
        for guard in ["m.state='active'", "u.state='active'", 'r.enabled', 'pd.enabled',
                      'b.function_id=%s', "'project'=ANY(pd.allowed_scopes)", "'function'=ANY(pd.allowed_scopes)"]:
            self.assertIn(guard, query)
    def test_entrypoint_imports_formal_authorizer(self):
        source = (HERE/'inspect_uc_copy_20261005_r4.py').read_text(encoding='utf-8')
        self.assertIn('from app.services.business_access import authorize', source)
        self.assertNotIn('visible, allowed, object_content', source)
    def test_all_frozen_r3_files_stay_unchanged(self):
        for name, digest in {
            'inspect_uc_copy_20261005_r3.py':'57bde1e9a44112478b6e293411425069329c892b98a3b8fb95d7bb021461b007',
            'run-uc-copy-preflight-20261005-r3.sh':'f2165a5f788182ec92c6ddf5c2294e8360400f553370c3cd25966eff11d1f874',
        }.items():
            self.assertEqual(hashlib.sha256((HERE/name).read_bytes()).hexdigest(), digest)

if __name__ == '__main__':
    unittest.main(verbosity=2)

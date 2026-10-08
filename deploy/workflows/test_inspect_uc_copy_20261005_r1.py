import copy
import importlib.util
from pathlib import Path
import sys
import unittest
from uuid import UUID

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('uc_copy_preflight', HERE / 'inspect_uc_copy_20261005_r1.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
sys.path.insert(0, 'E:/Git projects/TS-backend')
from app.schemas.manual_work import UcCreate
from pydantic import ValidationError

def validate(content):
    try:
        UcCreate.model_validate({**content,'creation_id':UUID('9b4c7360-76b4-4d3e-85aa-45f89c98b9fe')})
        return True, []
    except ValidationError as error:
        return False, sorted({'.'.join(map(str,e['loc'])) for e in error.errors(include_input=False,include_url=False)})

class Result:
    def __init__(self, data): self.data = data
    def fetchone(self): return self.data
    def fetchall(self): return self.data

class FakeDB:
    def __init__(self):
        self.readonly = 'on'
        self.isolation = 'repeatable read'
        self.source_name = '测试项目1'
        self.source_text = 'synthetic PRD'
        self.target_text = 'synthetic PRD'
        self.target_prd = UUID(int=500)
        self.target_rev = UUID(int=501)
        self.source_rows = [{'id':UUID(int=i),'function_id':m.SOURCE_FUNCTION,'code':f'UC-{i}','head_revision_id':UUID(int=100+i),'accepted_revision_id':UUID(int=100+i)} for i in (1,2,3)]
        self.target_rows = []
        self.prds = [{'id':self.target_prd,'head_revision_id':self.target_rev,'accepted_revision_id':self.target_rev}]
        self.contents = {r['id']:{'kind':'UC','prd_revision_id':UUID(int=400),'name':r['code'],'description':'PRIVATE_CONTENT_NOT_FOR_REPORT','branches':['a','b','c','d'],'exceptions':['e1','e2','e3','e4','e5']} for r in self.source_rows}
        self.statements = []
        self.permissions = []
        self.function_override = None
    def execute(self, sql, params=()):
        if not sql.startswith(('SELECT ', 'SHOW ')): raise AssertionError('WRITE_SQL_FORBIDDEN')
        self.statements.append(sql)
        if sql == 'SHOW transaction_read_only': return Result({'transaction_read_only':self.readonly})
        if sql == 'SHOW transaction_isolation': return Result({'transaction_isolation':self.isolation})
        if sql.startswith('SELECT id,name FROM ee.projects'):
            return Result({'id':params[0],'name':self.source_name if params[0] == m.SOURCE_PROJECT else '新项目'})
        if sql.startswith('SELECT id,name FROM ee.business_functions'):
            return Result({'id':params[0],'name':'DVR'})
        if sql.startswith('SELECT id,function_id,code,head_revision_id'):
            return Result(self.source_rows if params[0] == m.SOURCE_PROJECT else self.target_rows)
        if sql.startswith('SELECT id,head_revision_id,accepted_revision_id'): return Result(self.prds)
        if sql.startswith('SELECT v.markdown_body'): return Result({'markdown_body':self.source_text})
        raise AssertionError('UNEXPECTED_SQL')
    def content(self, db, project, artifact, revision=None):
        if project == m.TARGET_PROJECT:
            return {'artifact_id':artifact,'function_id':m.TARGET_FUNCTION,'revision_id':revision,'content':{'kind':'PRD','markdown_body':self.target_text}}
        row = next(r for r in self.source_rows if r['id'] == artifact)
        return {'artifact_id':artifact,'function_id':self.function_override or row['function_id'],'head_revision_id':row['head_revision_id'],'accepted_revision_id':row['accepted_revision_id'],'content':copy.deepcopy(self.contents[artifact])}
    def allowed(self, db, subject, project, function, permission):
        self.permissions.append((project,function,permission))

class Tests(unittest.TestCase):
    def run_report(self, db): return m.inspect(db,lambda *a:None,db.allowed,db.content,validate)
    def test_success_readonly_three_pending_copies(self):
        db = FakeDB(); before = copy.deepcopy(db.contents); r = self.run_report(db)
        self.assertEqual(r['blockers'], []); self.assertEqual(len(r['source_ucs']), 3)
        self.assertFalse(r['copy_performed']); self.assertFalse(r['confirmation_performed'])
        self.assertEqual(before, db.contents); self.assertNotIn('PRIVATE_CONTENT_NOT_FOR_REPORT',str(r))
        self.assertEqual(db.permissions,[(m.SOURCE_PROJECT,m.SOURCE_FUNCTION,'uc.read'),(m.TARGET_PROJECT,m.TARGET_FUNCTION,'uc.create')])
    def test_read_write_transaction_refused(self):
        db=FakeDB(); db.readonly='off'
        with self.assertRaisesRegex(RuntimeError,'READ_ONLY_REQUIRED'): self.run_report(db)
    def test_non_snapshot_transaction_refused(self):
        db=FakeDB(); db.isolation='read committed'
        with self.assertRaisesRegex(RuntimeError,'REPEATABLE_READ_REQUIRED'): self.run_report(db)
    def test_wrong_project_name_refused(self):
        db=FakeDB(); db.source_name='Other'
        with self.assertRaisesRegex(RuntimeError,'IDENTITY_MISMATCH'): self.run_report(db)
    def test_two_source_ucs_blocked(self):
        db=FakeDB(); db.source_rows.pop()
        self.assertIn('SOURCE_ACTIVE_UC_COUNT_MUST_BE_3',self.run_report(db)['blockers'])
    def test_extra_source_uc_blocked(self):
        db=FakeDB(); db.source_rows.append(dict(db.source_rows[0]))
        self.assertIn('SOURCE_ACTIVE_UC_COUNT_MUST_BE_3',self.run_report(db)['blockers'])
    def test_wrong_source_function_blocked(self):
        db=FakeDB(); db.source_rows[0]['function_id']=m.TARGET_FUNCTION
        self.assertIn('SOURCE_UC_FUNCTION_MISMATCH',self.run_report(db)['blockers'])
    def test_target_existing_uc_blocked(self):
        db=FakeDB(); db.target_rows=[dict(db.source_rows[0])]
        self.assertIn('TARGET_ALREADY_HAS_UC_REVIEW_REQUIRED',self.run_report(db)['blockers'])
    def test_target_prd_missing_blocked(self):
        db=FakeDB(); db.prds=[]
        self.assertIn('TARGET_REQUIRES_ONE_CONFIRMED_PRD',self.run_report(db)['blockers'])
    def test_target_prd_unconfirmed_blocked(self):
        db=FakeDB(); db.prds[0]['accepted_revision_id']=None
        self.assertIn('TARGET_REQUIRES_ONE_CONFIRMED_PRD',self.run_report(db)['blockers'])
    def test_source_prd_mismatch_blocked(self):
        db=FakeDB(); db.source_text='different source'
        self.assertIn('PRD_CONTENT_DIFFERS_REVIEW_REFERENCE_MAPPING',self.run_report(db)['blockers'])
    def test_never_truncates_extra_scenario_items(self):
        db=FakeDB(); db.contents[UUID(int=1)]['branches'].append('extra')
        r=self.run_report(db)
        self.assertIn('UC_SCHEMA_REQUIRES_REVIEW_NO_TRUNCATION_ALLOWED',r['blockers'])
        self.assertEqual(r['source_ucs'][0]['branch_count'],5)
    def test_invalid_name_identified_without_content(self):
        db=FakeDB(); db.contents[UUID(int=1)]['name']='a'*101
        self.assertIn('name',self.run_report(db)['source_ucs'][0]['invalid_field_paths'])
    def test_current_pending_head_is_explicit(self):
        db=FakeDB(); db.source_rows[0]['accepted_revision_id']=UUID(int=999)
        r=self.run_report(db); self.assertEqual(r['blockers'],[])
        self.assertFalse(r['source_ucs'][0]['head_is_accepted'])
    def test_snapshot_function_mismatch_refused(self):
        db=FakeDB(); db.function_override=m.TARGET_FUNCTION
        with self.assertRaisesRegex(RuntimeError,'SOURCE_CONTENT_SCOPE_MISMATCH'): self.run_report(db)
    def test_permission_failure_stops_inspection(self):
        db=FakeDB()
        def deny(*args): raise RuntimeError('FORBIDDEN')
        with self.assertRaisesRegex(RuntimeError,'FORBIDDEN'): m.inspect(db,lambda *a:None,deny,db.content,validate)
        self.assertFalse(any('FROM ee.artifacts' in s for s in db.statements))

if __name__ == '__main__':
    unittest.main(verbosity=2)

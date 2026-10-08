import importlib.util
import json
import unittest
from pathlib import Path
from uuid import UUID
from unittest import mock
import contextlib
import io

spec=importlib.util.spec_from_file_location('diagnostic',Path(__file__).with_name('inspect_chat_attachments_20261004_r1.py'))
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
TEXT='PRIVATE_PRD_BODY_DO_NOT_PRINT_123'
AID='e1d2a68f-7fdb-4244-b362-c4ddd3486ddb'
RID='8995ab55-2970-45eb-a214-b572fdc1e4a8'
ACTOR=UUID('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')

class Result:
    def __init__(self,value):self.value=value
    def fetchone(self):return self.value
    def fetchall(self):return self.value

class FakeDB:
    def __init__(self,attachments,readonly='on',original=TEXT):
        self.attachments=attachments;self.readonly=readonly;self.original=original;self.calls=[]
    def execute(self,sql,params=None):
        self.calls.append((sql,params))
        if sql=='SHOW transaction_read_only':return Result({'transaction_read_only':self.readonly})
        if sql.startswith('SELECT t.id'):
            assert 'WHERE t.project_id=%s AND t.user_id=%s' in sql and 'LIMIT 6' in sql
            assert params==(m.PROJECT_ID,ACTOR)
            return Result([{'thread_id':UUID('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
                'client_request_id':UUID('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),'mode':'question',
                'status':'completed','created_at':'2026-10-04','attachments':self.attachments}])
        if sql.startswith('SELECT v.markdown_body'):
            assert 'r.project_id=%s' in sql and params==(UUID(RID),UUID(AID),m.PROJECT_ID)
            return Result(None if self.original is None else {'markdown_body':self.original})
        raise AssertionError('Unexpected SQL: '+sql)

def attachment(text=TEXT):
    return {'artifact_id':AID,'revision_id':RID,'function_id':'3bb1333a-1ebf-428c-831f-c26dcd66cfa3',
            'content':{'kind':'PRD','markdown_body':text}}

class DiagnosticTests(unittest.TestCase):
    def inspect(self,db):
        report=m.summarize(db,ACTOR)
        self.assertNotIn(TEXT,json.dumps(report,default=str))
        return report['turns'][0]
    def test_complete_snapshot_matches_saved_revision_without_content(self):
        row=self.inspect(FakeDB([attachment()]))
        self.assertEqual(row['attachment_count'],1)
        self.assertEqual(row['attachments'][0]['prd_body_chars'],len(TEXT))
        self.assertTrue(row['attachments'][0]['matches_saved_revision'])
    def test_empty_attachments_are_reported(self):
        db=FakeDB([]);row=self.inspect(db)
        self.assertEqual(row['attachment_count'],0)
        self.assertEqual(len(db.calls),2)
    def test_missing_body_is_not_silently_normalized(self):
        a=attachment();del a['content']['markdown_body']
        row=self.inspect(FakeDB([a]))
        self.assertFalse(row['attachments'][0]['prd_body_is_string'])
        self.assertFalse(row['attachments'][0]['matches_saved_revision'])
    def test_truncated_or_different_body_detected(self):
        row=self.inspect(FakeDB([attachment('short')]))
        self.assertFalse(row['attachments'][0]['matches_saved_revision'])
    def test_missing_revision_detected(self):
        row=self.inspect(FakeDB([attachment()],original=None))
        self.assertFalse(row['attachments'][0]['saved_revision_found'])
    def test_invalid_ids_do_not_drive_queries_or_leak_text(self):
        a=attachment();a['artifact_id']=TEXT
        db=FakeDB([a]);row=self.inspect(db)
        self.assertIsNone(row['attachments'][0]['artifact_id'])
        self.assertEqual(len(db.calls),2)
    def test_invalid_attachment_list_reported(self):
        row=self.inspect(FakeDB({'bad':TEXT}))
        self.assertFalse(row['attachment_list_valid'])
    def test_malformed_attachment_item_does_not_leak(self):
        row=self.inspect(FakeDB([TEXT]))
        self.assertEqual(row['attachments'],[{'snapshot_valid':False}])
    def test_read_write_connection_refused_before_turn_query(self):
        db=FakeDB([attachment()],readonly='off')
        with self.assertRaisesRegex(RuntimeError,'READ_ONLY_REQUIRED'):m.summarize(db,ACTOR)
        self.assertEqual(len(db.calls),1)
    def test_windows_refuses_before_importing_app(self):
        with mock.patch.object(m.sys,'platform','win32'),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.main(),2)

if __name__=='__main__':unittest.main()

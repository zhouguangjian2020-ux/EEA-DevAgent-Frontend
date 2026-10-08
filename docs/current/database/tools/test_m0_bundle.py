"""Regression tests for reviewed sample conversion and deployment guardrails."""
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile
from io import BytesIO
from xml.etree import ElementTree as ET
from prepare_m0_seed import Numbering, NS, CANONICAL, read_word, sha, uid

BASE=Path(__file__).resolve().parents[1]
BUNDLE=BASE/'m0-20260921'
sys.path.insert(0,str(BUNDLE))
import server_step

class NumberingTests(unittest.TestCase):
 def numbering(self,xml):
  stream=BytesIO()
  with ZipFile(stream,'w') as z:z.writestr('word/numbering.xml',xml)
  stream.seek(0)
  with ZipFile(stream) as z:return Numbering(z)
 def p(self,num,text,level=0):
  return ET.fromstring(f'<w:p xmlns:w="{NS["w"]}"><w:pPr><w:numPr><w:ilvl w:val="{level}"/><w:numId w:val="{num}"/></w:numPr></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>')
 def test_decimal_continuity_and_distinct_instances(self):
  n=self.numbering(f'<w:numbering xmlns:w="{NS["w"]}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="6"><w:abstractNumId w:val="1"/></w:num></w:numbering>')
  self.assertEqual(n.render(self.p(5,'原文'),1),'3.\t原文')
  self.assertEqual(n.render(self.p(5,'后续'),2),'4.\t后续')
  self.assertEqual(n.render(self.p(6,'另一列表'),3),'3.\t另一列表')
 def test_known_single_level_exporter_and_start_override(self):
  n=self.numbering(f'<w:numbering xmlns:w="{NS["w"]}"><w:abstractNum w:abstractNumId="1"><w:lvl><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride></w:num></w:numbering>')
  self.assertEqual(n.render(self.p(5,'标题'),1),'7.\t标题')
 def test_unknown_numbering_stops_instead_of_silent_loss(self):
  n=self.numbering(f'<w:numbering xmlns:w="{NS["w"]}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="chineseCounting"/><w:lvlText w:val="%1"/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num></w:numbering>')
  with self.assertRaisesRegex(ValueError,'Unsupported numbering format'):n.render(self.p(5,'步骤'),1)

class PreparedDataTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.data=json.loads((BUNDLE/'data/seed-data.json').read_text(encoding='utf-8'))
  cls.report=json.loads((BUNDLE/'data/preparation-report.json').read_text(encoding='utf-8'))
 def test_removed_uc_references(self):self.assertEqual(self.report['unresolved_uc_references'],[])
 def test_exact_user_names(self):
  names={s['name'] for s in self.data['data']['subsystem_version_items']}
  self.assertTrue({'低压电源管理系统','感知融合和定位系统','挡位控制系统','X-Call系统','外部设备链接系统'}<=names)
  self.assertNotIn('外部设备连接系统',names)
 def test_allocation_targets_resolve(self):
  names={s['subsystem_id'] for s in self.data['data']['subsystem_version_items']}
  self.assertTrue(all(t['subsystem_id'] in names for t in self.data['data']['allocation_targets']))
 def test_numbered_steps(self):
  versions=self.data['data']['uc_versions']; text=versions[1]['main_flow']
  self.assertIn('1.\t用例开始',text)
  self.assertIn('3.\t系统停止实时影像的显示输出。',text)
  self.assertEqual([len(self.report['numbering'][f]) for f in ['PRD文档.docx','UC.docx']],[14,52])
 def test_pending_and_missing_branch_semantics(self):
  self.assertNotIn('review_events',self.data['data'])
  self.assertTrue(all('accepted_revision_id' not in a for a in self.data['data']['artifacts']))
  scenarios=self.data['data']['uc_scenario_items']
  counts=[sum(s['uc_id']==u['uc_id'] and s['kind']=='branch' for s in scenarios) for u in self.data['data']['uc_versions']]
  self.assertEqual(counts,[3,3,2])
 def test_source_hashes_unchanged(self):
  source=Path(r'C:\Users\zhouguangjian\Desktop\X光\数据')
  for f,h in self.data['source_manifest'].items():self.assertEqual(sha(source/f),h)
 def test_no_fake_auth_or_ai_history(self):
  self.assertTrue(all(r['created_by']=='__IMPORT_USER__' and r['created_via']=='import' and 'ai_run_id' not in r for r in self.data['data']['artifact_revisions']))

class GuardTests(unittest.TestCase):
 def test_reject_system_database(self):
  args=type('Args',(),{'port':5432,'system_id':'123','database':'postgres'})()
  info={'system_identifier':'123','server_version_num':180006,'data_directory':'/data/postgresql/18/main','listen_addresses':'127.0.0.1','in_recovery':False}
  with patch.object(server_step,'inspect',return_value=info):
   with self.assertRaisesRegex(RuntimeError,'non-system'):server_step.validate_target(args)
 def test_reject_wrong_cluster(self):
  args=type('Args',(),{'port':5432,'system_id':'expected','database':'ee_platform'})()
  with patch.object(server_step,'inspect',return_value={'system_identifier':'different'}):
   with self.assertRaisesRegex(RuntimeError,'mismatch'):server_step.validate_target(args)
 def test_require_backup(self):
  with self.assertRaisesRegex(RuntimeError,'backup-receipt'):server_step.backup_receipt(type('Args',(),{'backup_receipt':None})())
 def test_owner_not_app_user(self):
  text=(BUNDLE/'server_step.py').read_text(encoding='utf-8')
  self.assertIn('NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE',text)
  self.assertNotIn('DROP DATABASE',text)
  self.assertNotIn('DROP SCHEMA',text)

if __name__=='__main__':unittest.main(verbosity=2)

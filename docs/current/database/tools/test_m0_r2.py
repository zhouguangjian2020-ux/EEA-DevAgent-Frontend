"""R2 contract/package regression tests; no network or database access."""
from pathlib import Path
import copy,hashlib,json,sys,tempfile,unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[4]
BASE=ROOT/'docs/current/database/m0-20260921-r2'
OLD=ROOT/'docs/current/database/m0-20260921'
OUT=ROOT/'artifacts/metadata-m0-r2-20260921/unit-cases'
OUT.mkdir(parents=True,exist_ok=True)
sys.dont_write_bytecode=True
sys.path.insert(0,str(BASE))
import metadata_contract as contract
import server_step

def read(path):return json.loads(path.read_text(encoding='utf-8'))
class ContractTests(unittest.TestCase):
 def setUp(self):self.defs=read(BASE/'data/type-definitions.json')
 def test_generated_definitions_match_release(self):
  self.assertEqual(contract.definitions(),self.defs);self.assertTrue(contract.validate(self.defs))
 def test_all_fields_and_nested_rules_are_described(self):
  for d in self.defs:
   self.assertEqual({f['key'] for f in d['field_catalog']},set(d['content_schema']['properties']))
   for f in d['field_catalog']:
    self.assertTrue(f['label'] and f['description'] and f['widget'])
    self.assertEqual(f['path'],'.'.join(f['path_segments']))
 def test_uc_keeps_12_fields_and_only_three_required_business_texts(self):
  d=next(d for d in self.defs if d['type_code']=='UC')
  self.assertEqual(sum('detail' in f['visible_in'] for f in d['field_catalog']),12)
  fields=d['field_catalog']+[c for f in d['field_catalog'] for c in f.get('children',[])]
  self.assertEqual({f['path'] for f in fields if f['validation'].get('accept_nonblank')},{'name','description','scenario.main_flow'})
 def test_empty_sources_and_targets_are_structurally_valid_drafts(self):
  for typ,key in [('FR','uc_sources'),('FR_ALLOCATION','subsystem_ids')]:
   d=next(x for x in self.defs if x['type_code']==typ)
   self.assertNotIn('minItems',d['content_schema']['properties'][key])
   self.assertEqual(next(f for f in d['field_catalog'] if f['key']==key)['validation']['accept_min_items'],1)
 def test_allocation_only_target_selection_is_editable(self):
  d=next(x for x in self.defs if x['type_code']=='FR_ALLOCATION')
  self.assertEqual([f['key'] for f in d['field_catalog'] if f['edit']=='revision'],['subsystem_ids'])
 def test_unsupported_widgets_and_validators_fail_closed(self):
  for change in ['widget','validator','nested_widget']:
   ds=copy.deepcopy(self.defs)
   if change=='widget': ds[0]['field_catalog'][0]['widget']='execute_arbitrary_script'
   elif change=='validator': ds[0]['field_catalog'][0]['validation']['javascript']='grant_accept()'
   else: ds[1]['field_catalog'][5]['children'][0]['widget']='execute_arbitrary_script'
   with self.assertRaises(AssertionError):contract.validate(ds)
 def test_common_instance_contract_covers_all_physical_fields(self):
  m=read(BASE/'schema-manifest.json');c=read(BASE/'data/instance-contract.json')
  for tab in ['artifacts','artifact_revisions']:
   expected={f['name'] for t in m['tables'] if t['name']==tab for f in t['fields'] if f['name']!='ai_run_id'}
   self.assertEqual({f['key'] for f in c['identity_and_revision_fields'][tab]},expected)
  self.assertTrue(all(d['content_schema']['x-ee']['instance_contract']==c for d in self.defs))
 def test_sample_unchanged_except_type_definition_binding(self):
  old=read(OLD/'data/seed-data.json');new=read(BASE/'data/seed-data.json')
  old['data'].pop('artifact_type_versions');new['data'].pop('artifact_type_versions')
  for p in [old,new]:
   for r in p['data']['artifact_revisions']:r.pop('type_version_id')
  self.assertEqual(old,new)
 def test_source_files_still_match_import_manifest(self):
  p=read(BASE/'data/seed-data.json');folder=Path(r'C:\Users\zhouguangjian\Desktop\X光\数据')
  for name,sha in p['source_manifest'].items():self.assertEqual(hashlib.sha256((folder/name).read_bytes()).hexdigest(),sha,name)
 def test_table_column_shape_unchanged_and_no_new_ai_claim(self):
  old=read(OLD/'schema-manifest.json');new=read(BASE/'schema-manifest.json')
  self.assertEqual(old['tables'],new['tables'])
  sql=(BASE/'001_m0_schema.sql').read_text(encoding='utf-8')
  self.assertEqual(sql.count('CREATE TABLE ee.'),29)
  self.assertIn("'manual', 'import', 'migration'",sql)

class GuardTests(unittest.TestCase):
 def args(self):return type('Args',(),{'database':'ee_platform','system_id':'7686454253092706426','port':5432,'backup_receipt':None})()
 def test_exact_cluster_identity_and_server_constraints(self):
  valid={'system_identifier':'7686454253092706426','server_version_num':180006,'data_directory':'/data/postgresql/18/main','listen_addresses':'127.0.0.1','in_recovery':False}
  with patch.object(server_step,'inspect',return_value=valid):self.assertEqual(server_step.validate_target(self.args()),valid)
  for key,value in [('system_identifier','other'),('data_directory','/elsewhere'),('server_version_num',170000),('listen_addresses','*'),('in_recovery',True)]:
   with patch.object(server_step,'inspect',return_value={**valid,key:value}):
    with self.assertRaises(RuntimeError):server_step.validate_target(self.args())
 def test_missing_backup_and_wrong_owner_fail(self):
  with self.assertRaises(RuntimeError):server_step.backup_receipt(self.args())
  with patch.object(server_step,'db_info',return_value={'owner':'some_other_owner'}):
   with self.assertRaises(RuntimeError):server_step.require_db(self.args())
 def test_manifest_rejects_missing_duplicate_crlf_and_path_escape(self):
  directory=Path(tempfile.mkdtemp(prefix='manifest-',dir=OUT)).resolve()
  assert directory.is_relative_to(OUT.resolve())
  data=b'select 1;\n';(directory/'item.sql').write_bytes(data)
  line=hashlib.sha256(data).hexdigest()+'  item.sql\n'
  with patch.object(server_step,'BASE',directory),patch.object(server_step,'REQUIRED_FILES',frozenset({'item.sql'})):
   for invalid in ['',line+line,line.replace('\n','\r\n'),line.replace('item.sql','../item.sql')]:
    (directory/'SHA256SUMS').write_bytes(invalid.encode())
    with self.assertRaises(RuntimeError):server_step.package_check()
 def test_standalone_migration_refuses_existing_objects_without_writes(self):
  with patch.object(server_step,'require_db'),patch.object(server_step,'require_quiet'),patch.object(server_step,'backup_receipt'),patch.object(server_step,'psql',side_effect=['f','','1']) as sql:
   with self.assertRaisesRegex(RuntimeError,'unexpected existing objects'):server_step.migrate(self.args())
   self.assertFalse(any('CREATE ' in call.args[0] for call in sql.call_args_list))
 def test_other_migration_release_is_not_overwritten(self):
  with patch.object(server_step,'psql',side_effect=['t','1']):
   with self.assertRaisesRegex(RuntimeError,'Unknown migration history'):server_step.require_migration(self.args())
 def test_release_identity_and_rollback_smoke_wiring(self):
  self.assertEqual(server_step.VERSION,'001_m0_metadata_r2_20260921')
  self.assertEqual(len(server_step.REQUIRED_FILES),18)
  text=(BASE/'server_step.py').read_text(encoding='utf-8')
  self.assertIn('005_rules_rollback.sql',text)
  self.assertNotIn('DROP DATABASE',text);self.assertNotIn('DROP SCHEMA',text)

if __name__=='__main__':unittest.main(verbosity=2)

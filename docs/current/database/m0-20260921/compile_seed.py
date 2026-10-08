"""Generate idempotent, drift-detecting SQL for the prepared JSON. No database connection."""
import json
from pathlib import Path

def literal(value):return "'"+str(value).replace("'","''")+"'"
def seed_sql(package, dictionary):
 tables={t['name']:t for t in dictionary['tables'] if t['phase']=='M0 CRUD'}
 order=['artifact_types','artifact_type_versions','projects','business_functions','project_members','permission_definitions','access_roles','role_permissions','access_bindings','project_subsystem_designs','subsystem_design_versions','subsystems','subsystem_version_items','artifacts','prds','use_cases','functional_requirements','fr_allocations','artifact_revisions','prd_versions','uc_versions','uc_scenario_items','fr_versions','fr_uc_sources','allocation_versions','allocation_targets','security_audit_events']
 assert set(package['data'])<=set(order)
 schema={name:{'pk':t['pk'],'fields':[f['name'] for f in t['fields'] if f['name']!='ai_run_id']} for name,t in tables.items()}
 payload=json.dumps(package,ensure_ascii=False,separators=(',',':'))
 specification=json.dumps(schema,ensure_ascii=False,separators=(',',':'))
 sql="""
SET LOCAL ROLE ee_m0_owner;
SET LOCAL search_path = ee, pg_catalog;
CREATE TEMP TABLE seed_context(actor_id uuid NOT NULL, payload jsonb NOT NULL, specification jsonb NOT NULL) ON COMMIT DROP;
DO $actor$
DECLARE actor uuid; subject text; label text;
BEGIN
 subject=current_setting('ee.import_subject'); label=current_setting('ee.import_display_name');
 IF length(btrim(subject))=0 OR length(btrim(label))=0 THEN RAISE EXCEPTION 'real import operator required'; END IF;
 INSERT INTO ee.app_users(id,external_subject,display_name,metadata) VALUES(gen_random_uuid(),subject,label,'{"source":"manual_server_import_not_app_login"}') ON CONFLICT(external_subject) DO NOTHING;
 SELECT id INTO actor FROM ee.app_users WHERE external_subject=subject AND state='active';
 IF actor IS NULL THEN RAISE EXCEPTION 'import operator disabled'; END IF;
 INSERT INTO seed_context SELECT actor, __PAYLOAD__::jsonb, __SPEC__::jsonb;
END $actor$;
CREATE OR REPLACE FUNCTION pg_temp.seed_row(tab text, row_data jsonb) RETURNS void
LANGUAGE plpgsql AS $put$
DECLARE spec jsonb; pks jsonb; allowed jsonb; pk_join text; col_list text; r_list text; old_row jsonb; k text;
BEGIN
 SELECT specification->tab INTO spec FROM seed_context;
 IF spec IS NULL OR jsonb_typeof(row_data)<>'object' THEN RAISE EXCEPTION 'unknown seed table/row'; END IF;
 pks=spec->'pk'; allowed=spec->'fields';
 FOR k IN SELECT jsonb_object_keys(row_data) LOOP
  IF NOT allowed ? k THEN RAISE EXCEPTION 'unknown seed column %.%',tab,k; END IF;
 END LOOP;
 FOR k IN SELECT jsonb_array_elements_text(pks) LOOP
  IF row_data->k IS NULL OR row_data->k='null'::jsonb THEN RAISE EXCEPTION 'missing seed PK %.%',tab,k; END IF;
 END LOOP;
 SELECT string_agg(format('t.%I = r.%I',value,value),' AND ') INTO pk_join FROM jsonb_array_elements_text(pks);
 EXECUTE format('SELECT to_jsonb(t) FROM ee.%I t JOIN jsonb_populate_record(NULL::ee.%I,$1) r ON %s',tab,tab,pk_join) INTO old_row USING row_data;
 IF old_row IS NOT NULL THEN
  FOR k IN SELECT jsonb_object_keys(row_data) LOOP
   IF old_row->k IS DISTINCT FROM row_data->k THEN
    RAISE EXCEPTION 'existing seed content differs: %.%; stop, do not overwrite',tab,k USING ERRCODE='23514';
   END IF;
  END LOOP;
  RETURN;
 END IF;
 SELECT string_agg(format('%I',key),',' ORDER BY key),string_agg(format('r.%I',key),',' ORDER BY key) INTO col_list,r_list FROM jsonb_object_keys(row_data) AS key;
 EXECUTE format('INSERT INTO ee.%I(%s) SELECT %s FROM jsonb_populate_record(NULL::ee.%I,$1) r',tab,col_list,r_list,tab) USING row_data;
END $put$;
DO $seed$
DECLARE context seed_context; tab text; r jsonb;
BEGIN
 SELECT * INTO context FROM seed_context;
 FOREACH tab IN ARRAY __ORDER__ LOOP
  FOR r IN SELECT value FROM jsonb_array_elements(coalesce(context.payload->'data'->tab,'[]'::jsonb)) LOOP
   r=replace(r::text,'"__IMPORT_USER__"',to_jsonb(context.actor_id)::text)::jsonb;
   PERFORM pg_temp.seed_row(tab,r);
  END LOOP;
 END LOOP;
END $seed$;
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;
"""
 return sql.replace('__PAYLOAD__',literal(payload)).replace('__SPEC__',literal(specification)).replace('__ORDER__','ARRAY['+','.join(literal(t) for t in order)+']::text[]')

if __name__=='__main__':
 root=Path(__file__).resolve().parent
 package=json.loads((root/'data/seed-data.json').read_text(encoding='utf-8'))
 dictionary=json.loads((root/'schema-manifest.json').read_text(encoding='utf-8'))
 (root/'002_seed.sql').write_text(seed_sql(package,dictionary),encoding='utf-8')
 print('Generated 002_seed.sql; transaction and real import identity supplied by server_step.py')


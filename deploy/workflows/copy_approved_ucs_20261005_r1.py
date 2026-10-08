#!/usr/bin/env python3
# Approved one-off copy. No migrations, Agent calls, source changes or acceptance.
import argparse
import hashlib
import json
import sys
from pathlib import Path
from uuid import UUID

PLAN = {'id': 'uc-copy-approved-20261005-r1', 'subject': 'engineer01', 'source': {'project_id': '10d4c8a0-ff3a-56c3-abf6-18dc3b531e62', 'project_name': '测试项目1', 'function_id': '29fe01ea-f727-58cf-a326-b75294ba4dbb', 'function_name': '行车记录仪DVR'}, 'target': {'project_id': 'bf8f4d08-d086-44bf-9cbe-f31abc67ee03', 'project_name': '新项目', 'function_id': '3bb1333a-1ebf-428c-831f-c26dcd66cfa3', 'function_name': 'DVR'}, 'target_prd_artifact_id': 'e1d2a68f-7fdb-4244-b362-c4ddd3486ddb', 'target_confirmed_prd_revision_id': '8995ab55-2970-45eb-a214-b572fdc1e4a8', 'target_prd_sha256': '0e19bbc613175ce34d289b418207986a81ae9231372e35879359d807030994e9', 'sources': [{'artifact_id': '6c214cdc-afaa-5f0f-905e-dad877601ee0', 'number': 'UC-301-01-01', 'name': '查看行车记录仪实时影像', 'copied_version_policy': 'current head visible in original workspace', 'head_revision_id': 'f9539226-63b2-5d92-ac68-a7c5c8e4481f', 'accepted_revision_id': None, 'head_is_accepted': False, 'source_prd_revision_id': '70449ce3-cf7b-5ca8-b067-26a11e29ce74', 'source_prd_sha256': '3eed8bede93cc7a5f1cacaf816f95c500aa16b28f1b97380f77109ca54e14ae4', 'source_prd_matches_target': False, 'branch_count': 3, 'exception_count': 5, 'content_sha256': 'e991c2bba2902d2a10ecbc99f3fd6469bf29c97092e114517a823235d0053986', 'mapped_content_sha256': '77b3fcd68fd55864d31cc2c68dd8c496addc3e28556e50041a2912fdd5b76ac4', 'manual_create_schema_valid': False, 'invalid_field_paths': ['branches'], 'new_artifact_id': '59fa9c55-1691-4758-8c0a-c48eea56592d', 'request_id': '6573fb5b-427b-48d7-a5f0-fea7b0565852'}, {'artifact_id': 'd8b255d4-0af4-5e96-ade0-4bafc97abbda', 'number': 'UC-301-01-02', 'name': '退出实时影像', 'copied_version_policy': 'current head visible in original workspace', 'head_revision_id': '10892737-e2d8-514a-9839-83bc34858713', 'accepted_revision_id': None, 'head_is_accepted': False, 'source_prd_revision_id': '70449ce3-cf7b-5ca8-b067-26a11e29ce74', 'source_prd_sha256': '3eed8bede93cc7a5f1cacaf816f95c500aa16b28f1b97380f77109ca54e14ae4', 'source_prd_matches_target': False, 'branch_count': 3, 'exception_count': 5, 'content_sha256': '422fdc3fab4a8fa9e4519e9767425a164c4431fb8dbe3c2a87fbfcfdba60dc93', 'mapped_content_sha256': '78663099c3a77c118c96e085bab0d73bc9ee5d1b43bc3ccd32bc7bcdfa5df6a3', 'manual_create_schema_valid': False, 'invalid_field_paths': ['branches'], 'new_artifact_id': '0a1a9943-a2e5-4506-8718-aa1e9bd4861d', 'request_id': '32d75c28-baf0-4d91-b62f-e9e8ed91dc85'}, {'artifact_id': '482af1ea-e70b-5211-9217-93170b53038b', 'number': 'UC-301-01-03', 'name': '上电自动开启循环录像', 'copied_version_policy': 'current head visible in original workspace', 'head_revision_id': '58a4bbed-1187-59d9-a395-eab004c9d49b', 'accepted_revision_id': None, 'head_is_accepted': False, 'source_prd_revision_id': '70449ce3-cf7b-5ca8-b067-26a11e29ce74', 'source_prd_sha256': '3eed8bede93cc7a5f1cacaf816f95c500aa16b28f1b97380f77109ca54e14ae4', 'source_prd_matches_target': False, 'branch_count': 2, 'exception_count': 5, 'content_sha256': '05858e6942dbbecd7d0146fe54e9b525763c35df91dbfa9b6ce27a5e1ff5ffeb', 'mapped_content_sha256': 'eadf80a65850c7c25516eb9c63adb509aff7b0256af075253ff1f76a0c4e3b2a', 'manual_create_schema_valid': False, 'invalid_field_paths': ['branches'], 'new_artifact_id': 'd5ca0b02-2e38-4854-be04-6b0a02b54646', 'request_id': 'c234124c-3808-4b22-b8e4-dc30a98a1fa3'}], 'approval': {'pad_missing_branch_slots_with_empty_strings': True, 'map_to_different_target_prd': True, 'leave_unconfirmed': True}, 'source_files': {'app/services/business_access.py': '12e011ebdf7bb304d5a52dfbfb24c034b93875313e676a526491ea33156f9452', 'app/services/manual_work.py': 'f5b7e0d75d4b9beb3511fb33369715312a2dd04be4429bc46bc2dae366462128', 'app/services/workflow_sources.py': 'da3993a105c8c17fc71066f4bcaff57190a46f045b311968d7b62df5b2b76e39', 'app/schemas/manual_work.py': '84ae189a0e37765203f58f1aaac60952fdc239cdce3d85124bc8892d51fb3d1e'}}
STAGE = 'bootstrap'
WRITE_ATTEMPTS = []

class StopCopy(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)

def stop(code):
    raise StopCopy(code)

def need(value, code):
    if not value: stop(code)

def mark(value):
    global STAGE
    STAGE = value

def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,default=str,separators=(',',':')).encode('utf-8')).hexdigest()

def text_hash(value):
    need(isinstance(value,str) and bool(value.strip()), 'PRD_BODY_MISSING')
    return hashlib.sha256(value.encode('utf-8')).hexdigest()

def emit(value):
    # ASCII-safe JSON survives Windows PowerShell native-process decoding.
    print(json.dumps(value,ensure_ascii=True,sort_keys=True,default=str),flush=True)

def normalized_content(content, rows, target_revision):
    need(content.get('kind') == 'UC', 'SOURCE_KIND_CHANGED')
    groups = {'branch':('a1','a2','a3','a4'),
              'exception':('vehicle_state','mechanical','environmental','misuse','power')}
    mapped = dict(content)
    changes = {}
    for kind, slots in groups.items():
        relevant = [row for row in rows if row['kind'] == kind]
        need(all(isinstance(row['body'],str) and type(row['position']) is int for row in relevant), 'INVALID_SCENARIO_SHAPE')
        need(len({row['category'] for row in relevant}) == len(relevant), 'DUPLICATE_SCENARIO_CATEGORY')
        need(len({row['position'] for row in relevant}) == len(relevant), 'DUPLICATE_SCENARIO_POSITION')
        need(all(row['category'] in slots for row in relevant), 'UNKNOWN_SCENARIO_CATEGORY')
        ordered = sorted(relevant,key=lambda row:row['position'])
        indices = [slots.index(row['category']) for row in ordered]
        need(indices == sorted(indices), 'SCENARIO_CATEGORY_ORDER_MISMATCH')
        key = 'branches' if kind == 'branch' else 'exceptions'
        need([row['body'] for row in ordered] == content[key], 'SCENARIO_BODY_ORDER_MISMATCH')
        if kind == 'exception': need(len(relevant)==5, 'EXCEPTION_COUNT_CHANGED')
        lookup = {row['category']:row['body'] for row in relevant}
        mapped[key] = [lookup.get(slot,'') for slot in slots]
        changes[key] = [slot for slot in slots if slot not in lookup]
    need(all(row['kind'] in groups for row in rows), 'UNKNOWN_SCENARIO_KIND')
    mapped['prd_revision_id'] = UUID(str(target_revision))
    return mapped, changes

class Backend:
    def __init__(self):
        from app.services import workflow_sources, business_access, manual_work
        from app.schemas.manual_work import UcCreate
        self.sources=workflow_sources
        self.authorize=business_access.authorize
        self.manual=manual_work
        self.schema=UcCreate
    def readonly(self): return self.sources.read_db()
    def visible(self,db,subject,project): return self.sources.visible(db,subject,project)
    def content(self,db,project,artifact,revision=None): return self.sources.object_content(db,project,artifact,revision)
    def payload(self,content,creation): return self.schema.model_validate({**content,'creation_id':creation})
    def fingerprint(self,project,function,payload): return self.manual.fingerprint(project,function,payload)
    def create(self,subject,project,function,payload,request):
        return self.manual.create_artifact(subject,project,function,payload,request)

def inspect(backend, plan, database_name='ee_platform'):
    source=UUID(plan['source']['project_id']); sf=UUID(plan['source']['function_id'])
    target=UUID(plan['target']['project_id']); tf=UUID(plan['target']['function_id'])
    target_prd=UUID(plan['target_prd_artifact_id']); target_rev=UUID(plan['target_confirmed_prd_revision_id'])
    new_ids={UUID(x['new_artifact_id']) for x in plan['sources']}
    need(len(new_ids)==3 and all(x.version==4 for x in new_ids), 'INVALID_COPY_IDENTITIES')
    need(plan['approval']=={'pad_missing_branch_slots_with_empty_strings':True,'map_to_different_target_prd':True,'leave_unconfirmed':True},'COPY_APPROVAL_SCOPE_MISMATCH')
    with backend.readonly() as db:
        mark('database.readonly_snapshot')
        need(db.execute('SHOW transaction_read_only').fetchone()['transaction_read_only']=='on','READ_ONLY_REQUIRED')
        need(db.execute('SHOW transaction_isolation').fetchone()['transaction_isolation']=='repeatable read','REPEATABLE_READ_REQUIRED')
        need(db.execute('SELECT current_database() AS name').fetchone()['name']==database_name,'DATABASE_IDENTITY_MISMATCH')
        for label,project,function,info in [('source',source,sf,plan['source']),('target',target,tf,plan['target'])]:
            mark(label+'.scope_and_visibility')
            backend.visible(db,plan['subject'],project)
            project_row=db.execute('SELECT id,name FROM ee.projects WHERE id=%s AND archived_at IS NULL',(project,)).fetchone()
            function_row=db.execute('SELECT id,name FROM ee.business_functions WHERE id=%s AND project_id=%s AND archived_at IS NULL',(function,project)).fetchone()
            need(project_row is not None and project_row['name']==info['project_name'] and function_row is not None and function_row['name']==info['function_name'],'PROJECT_OR_FUNCTION_CHANGED')
        mark('target.formal_create_authorization')
        actor=backend.authorize(db,plan['subject'],target,'UC.create',function_id=tf)
        mark('target.confirmed_prd')
        prds=db.execute("SELECT id,head_revision_id,accepted_revision_id FROM ee.artifacts WHERE project_id=%s AND function_id=%s AND type_code='PRD' AND archived_at IS NULL ORDER BY id",(target,tf)).fetchall()
        need(len(prds)==1 and prds[0]['id']==target_prd and prds[0]['accepted_revision_id']==target_rev,'TARGET_PRD_REFERENCE_CHANGED')
        prd=backend.content(db,target,target_prd,target_rev)
        need(prd['function_id']==tf and prd['content']['kind']=='PRD' and text_hash(prd['content']['markdown_body'])==plan['target_prd_sha256'],'TARGET_PRD_CONTENT_CHANGED')
        mark('source.exact_inventory')
        inventory=db.execute("SELECT id,function_id,head_revision_id,accepted_revision_id FROM ee.artifacts WHERE project_id=%s AND type_code='UC' AND archived_at IS NULL ORDER BY id",(source,)).fetchall()
        need({str(x['id']) for x in inventory}=={x['artifact_id'] for x in plan['sources']},'SOURCE_UC_INVENTORY_CHANGED')
        need(all(x['function_id']==sf for x in inventory),'SOURCE_UC_FUNCTION_CHANGED')
        mark('target.exact_inventory')
        target_rows=db.execute("SELECT id FROM ee.artifacts WHERE project_id=%s AND type_code='UC' AND archived_at IS NULL ORDER BY id",(target,)).fetchall()
        need({x['id'] for x in target_rows}.issubset(new_ids),'UNEXPECTED_TARGET_UC_PRESENT')
        prepared=[]
        for item in plan['sources']:
            mark('source.approved_version_and_content')
            ident=UUID(item['artifact_id']); head=UUID(item['head_revision_id']); new_id=UUID(item['new_artifact_id'])
            snapshot=backend.content(db,source,ident,head)
            need(snapshot['function_id']==sf and snapshot['head_revision_id']==head and snapshot['accepted_revision_id'] is None,'SOURCE_UC_VERSION_STATE_CHANGED')
            content=snapshot['content']
            need(digest(content)==item['content_sha256'],'SOURCE_UC_CONTENT_CHANGED')
            need(str(content['prd_revision_id'])==item['source_prd_revision_id'],'SOURCE_PRD_LINK_CHANGED')
            src_prd=db.execute('SELECT v.markdown_body FROM ee.prd_versions v JOIN ee.artifact_revisions r ON r.id=v.revision_id WHERE r.id=%s AND r.project_id=%s',(content['prd_revision_id'],source)).fetchone()
            need(src_prd is not None and text_hash(src_prd['markdown_body'])==item['source_prd_sha256'],'SOURCE_PRD_CONTENT_CHANGED')
            need(len(content['branches'])==item['branch_count'] and len(content['exceptions'])==item['exception_count'],'SCENARIO_COUNT_CHANGED')
            rows=db.execute('SELECT kind,category,position,body FROM ee.uc_scenario_items WHERE uc_revision_id=%s ORDER BY kind,position,item_id',(head,)).fetchall()
            normalized,changes=normalized_content(content,rows,target_rev)
            payload=backend.payload(normalized,new_id)
            need(payload.model_dump(exclude={'creation_id'})==normalized,'SCHEMA_ALTERED_CONTENT')
            fingerprint=backend.fingerprint(target,tf,payload)
            mark('target.stable_id_replay_check')
            existing=db.execute('SELECT id,project_id,function_id,type_code,head_revision_id,accepted_revision_id,archived_at,created_by,metadata,code FROM ee.artifacts WHERE id=%s',(new_id,)).fetchone()
            if existing:
                need(existing['project_id']==target and existing['function_id']==tf and existing['type_code']=='UC' and existing['archived_at'] is None and existing['created_by']==actor and existing['metadata'].get('manual_creation_hash')==fingerprint,'COPY_IDENTITY_CONFLICT')
                need(existing['accepted_revision_id'] is None,'COPY_ALREADY_CONFIRMED_STOP')
                revisions=db.execute('SELECT id FROM ee.artifact_revisions WHERE artifact_id=%s ORDER BY revision_no',(new_id,)).fetchall()
                need(len(revisions)==1 and revisions[0]['id']==existing['head_revision_id'],'COPY_WAS_EDITED_STOP')
                actual=backend.content(db,target,new_id)
                need(actual['content']==normalized and actual['function_id']==tf,'COPY_CONTENT_MISMATCH')
                link=db.execute('SELECT prd_id FROM ee.use_cases WHERE artifact_id=%s',(new_id,)).fetchone()
                need(link is not None and link['prd_id']==target_prd,'COPY_PARENT_LINK_MISMATCH')
            prepared.append({'source':item,'payload':payload,'normalized':normalized,'padded_slots':changes,'existing':existing,'fingerprint':fingerprint})
        return prepared

def summarize(prepared):
    return [{'source_uc_id':x['source']['artifact_id'],'new_uc_id':x['source']['new_artifact_id'],'name':x['normalized']['name'],'empty_slots_added':x['padded_slots']['branches'],'state':'already_copied_pending' if x['existing'] else 'not_copied','new_code':x['existing']['code'] if x['existing'] else None,'new_revision_id':x['existing']['head_revision_id'] if x['existing'] else None,'normalized_content_sha256':digest(x['normalized'])} for x in prepared]

def execute(backend,plan,apply=False,database_name='ee_platform'):
    prepared=inspect(backend,plan,database_name)
    if not apply:
        emit({'status':'COPY_CHECK_ONLY_OK','plan_id':plan['id'],'items':summarize(prepared),'writes_performed':False,'confirmation_performed':False})
        return prepared
    for item in plan['sources']:
        # New snapshot before each independent formal service transaction.
        prepared=inspect(backend,plan,database_name)
        entry=next(x for x in prepared if x['source']['new_artifact_id']==item['new_artifact_id'])
        if entry['existing']:
            emit({'status':'COPY_REPLAY_VERIFIED','artifact_id':item['new_artifact_id']})
            continue
        mark('copy.formal_create')
        WRITE_ATTEMPTS.append(item['new_artifact_id'])
        result=backend.create(plan['subject'],UUID(plan['target']['project_id']),UUID(plan['target']['function_id']),entry['payload'],item['request_id'])
        need(str(result.artifact_id)==item['new_artifact_id'],'UNEXPECTED_CREATE_RESULT')
        verified=inspect(backend,plan,database_name)
        saved=next(x for x in verified if x['source']['new_artifact_id']==item['new_artifact_id'])
        need(saved['existing'] is not None and saved['existing']['head_revision_id']==result.revision_id,'POST_CREATE_VERIFICATION_FAILED')
        emit({'status':'COPY_ITEM_VERIFIED','artifact_id':item['new_artifact_id'],'revision_id':result.revision_id,'created':result.created,'confirmed':False})
    final=inspect(backend,plan,database_name)
    need(all(x['existing'] for x in final),'COPY_INCOMPLETE')
    emit({'status':'UC_COPY_COMPLETE_PENDING_CONFIRMATION','plan_id':plan['id'],'target_project_id':plan['target']['project_id'],'target_function_id':plan['target']['function_id'],'target_prd_revision_id':plan['target_confirmed_prd_revision_id'],'items':summarize(final),'confirmed_count':0,'verified_copy_count':3,'transaction_policy':'three independent service transactions; stable IDs support safe retry'})
    return final

def verify_runtime():
    for relative,expected in PLAN['source_files'].items():
        file=Path('/app')/relative
        need(file.is_file() and hashlib.sha256(file.read_bytes()).hexdigest()==expected,'BACKEND_SOURCE_FINGERPRINT_MISMATCH')

def safe_error(error):
    allowed={'project_not_found','business_write_forbidden','business_writes_disabled','business_write_not_configured','business_write_conflict','business_write_timeout','business_write_unavailable','artifact_not_found','source_changed','artifact_type_unavailable','projects_database_unavailable','projects_query_timeout','projects_not_configured','projects_unsafe_database_role'}
    code=error.code if isinstance(error,StopCopy) else getattr(error,'code',None)
    if not isinstance(error,StopCopy) and code not in allowed:code='unclassified_error_details_withheld'
    return {'status':'UC_COPY_STOPPED','stage':STAGE,'error_type':type(error).__name__,'code':code,'write_attempted_ids':list(WRITE_ATTEMPTS),'commit_state':'some items may have committed; check existing stable IDs' if WRITE_ATTEMPTS else 'no create call attempted','confirmation_performed':False,'next_step':'retain files and IDs; provide this receipt; do not delete or use new creation IDs'}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    modes=parser.add_mutually_exclusive_group()
    modes.add_argument('--check-only',action='store_true')
    modes.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    try:
        need(sys.platform.startswith('linux'),'RUN_ONLY_INSIDE_APPROVED_BACKEND')
        mark('runtime.frozen_source_verification');verify_runtime()
        mark('runtime.load_formal_services');backend=Backend()
        execute(backend,PLAN,apply=args.apply)
        return 0
    except Exception as error:
        emit(safe_error(error));return 1

if __name__=='__main__':sys.exit(main())

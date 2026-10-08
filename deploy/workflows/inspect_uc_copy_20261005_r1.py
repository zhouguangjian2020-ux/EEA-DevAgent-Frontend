#!/usr/bin/env python3
# User-executed read-only preflight; no copying, confirmation or Agent calls.
import hashlib
import json
import sys
from uuid import UUID

SUBJECT = 'engineer01'
SOURCE_PROJECT = UUID('10d4c8a0-ff3a-56c3-abf6-18dc3b531e62')
SOURCE_FUNCTION = UUID('29fe01ea-f727-58cf-a326-b75294ba4dbb')
TARGET_PROJECT = UUID('bf8f4d08-d086-44bf-9cbe-f31abc67ee03')
TARGET_FUNCTION = UUID('3bb1333a-1ebf-428c-831f-c26dcd66cfa3')

def digest(value):
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str, separators=(',', ':'))
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def text_hash(value):
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError('PRD_BODY_MISSING')
    return hashlib.sha256(value.encode('utf-8')).hexdigest()

def inspect(db, visible, allowed, object_content, validate_create):
    if db.execute('SHOW transaction_read_only').fetchone()['transaction_read_only'] != 'on':
        raise RuntimeError('READ_ONLY_REQUIRED')
    if db.execute('SHOW transaction_isolation').fetchone()['transaction_isolation'] != 'repeatable read':
        raise RuntimeError('REPEATABLE_READ_REQUIRED')
    scopes = []
    for project, function, name, permission in [(SOURCE_PROJECT,SOURCE_FUNCTION,'测试项目1','uc.read'),(TARGET_PROJECT,TARGET_FUNCTION,'新项目','uc.create')]:
        visible(db, SUBJECT, project)
        allowed(db, SUBJECT, project, function, permission)
        p = db.execute('SELECT id,name FROM ee.projects WHERE id=%s AND archived_at IS NULL', (project,)).fetchone()
        f = db.execute('SELECT id,name FROM ee.business_functions WHERE id=%s AND project_id=%s AND archived_at IS NULL', (function,project)).fetchone()
        if not p or p['name'] != name or not f:
            raise RuntimeError('PROJECT_OR_FUNCTION_IDENTITY_MISMATCH')
        scopes.append({'project_id':project,'project_name':p['name'],'function_id':function,'function_name':f['name']})
    sql = 'SELECT id,function_id,code,head_revision_id,accepted_revision_id FROM ee.artifacts WHERE project_id=%s AND type_code=%s AND archived_at IS NULL ORDER BY function_id,code,id LIMIT 21'
    source_rows = db.execute(sql, (SOURCE_PROJECT,'UC')).fetchall()
    target_rows = db.execute(sql, (TARGET_PROJECT,'UC')).fetchall()
    prds = db.execute('SELECT id,head_revision_id,accepted_revision_id FROM ee.artifacts WHERE project_id=%s AND function_id=%s AND type_code=%s AND archived_at IS NULL ORDER BY id LIMIT 3', (TARGET_PROJECT,TARGET_FUNCTION,'PRD')).fetchall()
    issues = []
    if len(source_rows) != 3:
        issues.append('SOURCE_ACTIVE_UC_COUNT_MUST_BE_3')
    if any(row['function_id'] != SOURCE_FUNCTION for row in source_rows):
        issues.append('SOURCE_UC_FUNCTION_MISMATCH')
    if target_rows:
        issues.append('TARGET_ALREADY_HAS_UC_REVIEW_REQUIRED')
    target = None
    target_hash = None
    if len(prds) == 1 and prds[0]['accepted_revision_id']:
        target = object_content(db, TARGET_PROJECT, prds[0]['id'], prds[0]['accepted_revision_id'])
        if target['content']['kind'] != 'PRD' or target['function_id'] != TARGET_FUNCTION:
            raise RuntimeError('TARGET_PRD_SCOPE_MISMATCH')
        target_hash = text_hash(target['content']['markdown_body'])
    else:
        issues.append('TARGET_REQUIRES_ONE_CONFIRMED_PRD')
    details = []
    for row in source_rows:
        if row['function_id'] != SOURCE_FUNCTION:
            continue
        snapshot = object_content(db, SOURCE_PROJECT, row['id'])
        content = snapshot['content']
        if content['kind'] != 'UC' or snapshot['function_id'] != SOURCE_FUNCTION:
            raise RuntimeError('SOURCE_CONTENT_SCOPE_MISMATCH')
        source_prd = db.execute('SELECT v.markdown_body FROM ee.prd_versions v JOIN ee.artifact_revisions r ON r.id=v.revision_id WHERE r.id=%s AND r.project_id=%s', (content['prd_revision_id'],SOURCE_PROJECT)).fetchone()
        source_hash = text_hash(source_prd['markdown_body']) if source_prd else None
        mapped = dict(content)
        if target:
            mapped['prd_revision_id'] = target['revision_id']
        valid, invalid_fields = validate_create(mapped)
        if not valid:
            issues.append('UC_SCHEMA_REQUIRES_REVIEW_NO_TRUNCATION_ALLOWED')
        if target_hash and source_hash != target_hash:
            issues.append('PRD_CONTENT_DIFFERS_REVIEW_REFERENCE_MAPPING')
        details.append({'artifact_id':row['id'],'number':row['code'],'name':content['name'],
            'copied_version_policy':'current head visible in original workspace',
            'head_revision_id':snapshot['head_revision_id'],'accepted_revision_id':snapshot['accepted_revision_id'],
            'head_is_accepted':snapshot['head_revision_id'] == snapshot['accepted_revision_id'],
            'source_prd_revision_id':content['prd_revision_id'],'source_prd_sha256':source_hash,
            'source_prd_matches_target':source_hash == target_hash if target_hash else None,
            'branch_count':len(content['branches']),'exception_count':len(content['exceptions']),
            'content_sha256':digest(content),'mapped_content_sha256':digest(mapped),
            'manual_create_schema_valid':valid,'invalid_field_paths':invalid_fields})
    return {'subject':SUBJECT,'source':scopes[0],'target':scopes[1],
        'source_active_uc_count':len(source_rows),'source_count_capped_at':21,
        'target_active_uc_count':len(target_rows),'target_existing_ucs':target_rows,
        'target_prd_artifact_id':target['artifact_id'] if target else None,
        'target_confirmed_prd_revision_id':target['revision_id'] if target else None,
        'target_prd_sha256':target_hash,'source_ucs':details,'blockers':sorted(set(issues)),
        'copy_performed':False,'confirmation_performed':False,
        'policy':'Copies must use new IDs and target PRD linkage; originals unchanged; user confirms separately.'}

def main():
    if not sys.platform.startswith('linux'):
        print('STOP: run inside the approved company backend container')
        return 2
    try:
        from app.services.workflow_sources import read_db, visible, allowed, object_content
        from app.schemas.manual_work import UcCreate
        from pydantic import ValidationError
        def validate_create(content):
            try:
                UcCreate.model_validate({**content,'creation_id':UUID('9b4c7360-76b4-4d3e-85aa-45f89c98b9fe')})
                return True, []
            except ValidationError as error:
                return False, sorted({'.'.join(map(str,item['loc'])) for item in error.errors(include_input=False,include_url=False)})
        with read_db() as db:
            report = inspect(db, visible, allowed, object_content, validate_create)
        print(json.dumps(report,ensure_ascii=False,indent=2,default=str))
        if report['blockers']:
            print('UC_COPY_PREFLIGHT_BLOCKED: review listed conditions; no writes or Agent calls')
            return 2
        print('UC_COPY_PREFLIGHT_OK: no copies, confirmations, SQL writes, Agent calls or service changes')
        return 0
    except Exception as error:
        print('UC_COPY_PREFLIGHT_FAILED: '+type(error).__name__+'; sensitive details withheld')
        return 1

if __name__ == '__main__':
    sys.exit(main())

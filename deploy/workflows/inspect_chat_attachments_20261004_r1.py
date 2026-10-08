#!/usr/bin/env python3
# User-run inside the current backend container; SELECT/SHOW only, no Agent calls.
import hashlib
import json
import sys
from uuid import UUID

PROJECT_ID=UUID('bf8f4d08-d086-44bf-9cbe-f31abc67ee03')
SUBJECT='engineer01'

def summarize(db,actor):
    if db.execute('SHOW transaction_read_only').fetchone()['transaction_read_only']!='on':
        raise RuntimeError('READ_ONLY_REQUIRED')
    rows=db.execute(
        'SELECT t.id AS thread_id,c.client_request_id,c.mode,c.status,c.created_at,c.attachments '
        'FROM ee.chat_turns c JOIN ee.chat_threads t ON t.id=c.thread_id '
        'WHERE t.project_id=%s AND t.user_id=%s '
        'ORDER BY c.created_at DESC,c.id DESC LIMIT 6',
        (PROJECT_ID,actor)).fetchall()
    result=[]
    for row in rows:
        raw=row['attachments']
        attachments=raw if isinstance(raw,list) else []
        item={k:row[k] for k in ('thread_id','client_request_id','mode','status','created_at')}
        item.update(attachment_count=len(attachments),attachment_list_valid=isinstance(raw,list),attachments=[])
        for a in attachments:
            if not isinstance(a,dict):
                item['attachments'].append({'snapshot_valid':False})
                continue
            content=a.get('content')
            content=content if isinstance(content,dict) else {}
            kind=content.get('kind')
            detail={'kind':kind if kind in ('PRD','UC','FR') else 'unknown'}
            for key in ('artifact_id','revision_id','function_id'):
                try:
                    detail[key]=str(UUID(str(a.get(key))))
                except (ValueError,TypeError,AttributeError):
                    detail[key]=None
            if kind=='PRD':
                text=content.get('markdown_body')
                detail.update(prd_body_is_string=isinstance(text,str),
                              prd_body_chars=len(text) if isinstance(text,str) else 0,
                              prd_body_nonempty=bool(text.strip()) if isinstance(text,str) else False)
                if isinstance(text,str):
                    detail['prd_body_sha256']=hashlib.sha256(text.encode('utf-8')).hexdigest()
                if detail['artifact_id'] and detail['revision_id']:
                    original=db.execute(
                        'SELECT v.markdown_body FROM ee.prd_versions v '
                        'JOIN ee.artifact_revisions r ON r.id=v.revision_id '
                        'WHERE r.id=%s AND r.artifact_id=%s AND r.project_id=%s',
                        (UUID(detail['revision_id']),UUID(detail['artifact_id']),PROJECT_ID)).fetchone()
                    detail['saved_revision_found']=bool(original)
                    detail['matches_saved_revision']=bool(original and isinstance(text,str) and text==original['markdown_body'])
            item['attachments'].append(detail)
        result.append(item)
    return {'subject':SUBJECT,'project_id':str(PROJECT_ID),'scope':'last six stored turns, no content printed',
            'evidence':'backend saved attachment snapshot, not Agent receipt or model context',
            'request_lookup_key':'client_request_id is the Agent idempotency_key',
            'turns':result}

def main():
    if not sys.platform.startswith('linux'):
        print('STOP: run only inside the approved company backend container')
        return 2
    try:
        from app.services.workflow_sources import read_db,visible
        with read_db() as db:
            actor=visible(db,SUBJECT,PROJECT_ID)
            report=summarize(db,actor)
        print(json.dumps(report,ensure_ascii=False,indent=2,default=str))
        print('READ_ONLY_CHAT_SNAPSHOT_CHECK_OK: no SQL writes, Agent calls or service changes')
        return 0
    except Exception as error:
        print('READ_ONLY_CHECK_FAILED: '+type(error).__name__+'; details withheld')
        return 1

if __name__=='__main__':
    sys.exit(main())

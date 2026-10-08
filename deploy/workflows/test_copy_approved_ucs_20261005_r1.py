import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from uuid import UUID,uuid4
import pytest
from psycopg.rows import dict_row

HERE=Path(__file__).resolve().parent
BACK=Path('E:/Git projects/TS-backend')
sys.path.insert(0,str(BACK))
spec=importlib.util.spec_from_file_location('approved_copy',HERE/'copy_approved_ucs_20261005_r1.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
from tests.test_manual_work_postgres import db
from app.services import manual_work,project_creation
from app.schemas.projects import ProjectCreate
from app.schemas.manual_work import FunctionCreate,PrdCreate,AcceptRevision
from app.core.config import settings

def test_approved_plan_exactly_matches_company_report():
    report=json.loads((HERE/'uc-copy-r4-company-report-20261005.json').read_text(encoding='utf-8'))['report']
    assert m.PLAN['source']==report['source'] and m.PLAN['target']==report['target']
    for got,expected in zip(m.PLAN['sources'],report['source_ucs']):
        assert {k:v for k,v in got.items() if k not in ('new_artifact_id','request_id')}==expected
        assert UUID(got['new_artifact_id']).version==4 and UUID(got['request_id']).version==4
    assert len({x['new_artifact_id'] for x in m.PLAN['sources']})==3

def scenarios(branches):
    return [{'kind':'branch','category':key,'position':i,'body':value} for i,(key,value) in enumerate(branches)]+[{'kind':'exception','category':key,'position':i,'body':'exception '+key} for i,key in enumerate(('vehicle_state','mechanical','environmental','misuse','power'))]

def sample_content(rows):
    return {'kind':'UC','prd_revision_id':uuid4(),'name':'existing text','branches':[x['body'] for x in rows if x['kind']=='branch'],'exceptions':[x['body'] for x in rows if x['kind']=='exception']}

@pytest.mark.parametrize('count',[2,3,4])
def test_empty_slots_do_not_invent_or_remove_content(count):
    rows=scenarios([('a'+str(i+1),'original '+str(i)) for i in range(count)])
    content=sample_content(rows);before=copy.deepcopy(content);target=uuid4()
    result,changes=m.normalized_content(content,rows,target)
    assert content==before and result['branches'][:count]==content['branches']
    assert result['branches'][count:]==['']*(4-count)
    assert result['exceptions']==content['exceptions'] and result['prd_revision_id']==target

def test_internal_missing_slot_preserves_categories():
    rows=scenarios([('a1','one'),('a3','three')]);content=sample_content(rows)
    result,changes=m.normalized_content(content,rows,uuid4())
    assert result['branches']==['one','','three','']
    assert changes['branches']==['a2','a4']

@pytest.mark.parametrize('case,expected',[('unknown','UNKNOWN_SCENARIO_CATEGORY'),('duplicate','DUPLICATE_SCENARIO_CATEGORY'),('position','DUPLICATE_SCENARIO_POSITION'),('order','SCENARIO_CATEGORY_ORDER_MISMATCH'),('body','SCENARIO_BODY_ORDER_MISMATCH'),('exception','EXCEPTION_COUNT_CHANGED'),('kind','UNKNOWN_SCENARIO_KIND')])
def test_scenario_mismatch_fails_without_truncation(case,expected):
    rows=scenarios([('a1','one'),('a2','two')]);content=sample_content(rows)
    if case=='unknown':rows[0]['category']='a5'
    elif case=='duplicate':rows[1]['category']='a1'
    elif case=='position':rows[1]['position']=rows[0]['position']
    elif case=='order':rows[0]['category'],rows[1]['category']='a2','a1'
    elif case=='body':rows[0]['body']='changed'
    elif case=='exception':rows.pop();content['exceptions'].pop()
    elif case=='kind':rows.append({'kind':'unexpected','category':'x','position':0,'body':'x'})
    with pytest.raises(m.StopCopy) as error:m.normalized_content(content,rows,uuid4())
    assert error.value.code==expected

def test_safe_errors_do_not_expose_exception_messages():
    m.WRITE_ATTEMPTS.clear();m.mark('test')
    data=m.safe_error(RuntimeError('secret-dsn-password-do-not-print'))
    assert 'secret-dsn-password' not in json.dumps(data)
    assert data['commit_state']=='no create call attempted'

@pytest.fixture
def prepared(db):
    # All administrative setup below uses the pre-existing localhost-only fixture guard.
    subject='engineer01';pid=uuid4();fid=uuid4()
    project_creation.create_project(subject,ProjectCreate(creation_id=pid,name='Disposable UC copy target',description='local test only'),str(uuid4()))
    manual_work.create_function(subject,pid,FunctionCreate(creation_id=fid,name='DVR',description=''),str(uuid4()))
    prd=manual_work.create_artifact(subject,pid,fid,PrdCreate(kind='PRD',creation_id=uuid4(),name='Different target PRD'),str(uuid4()))
    manual_work.accept_revision(subject,pid,prd.artifact_id,AcceptRevision(mutation_id=uuid4(),revision_id=prd.revision_id),str(uuid4()))
    backend=m.Backend();plan=copy.deepcopy(m.PLAN)
    plan['target']={'project_id':str(pid),'project_name':'Disposable UC copy target','function_id':str(fid),'function_name':'DVR'}
    plan['target_prd_artifact_id']=str(prd.artifact_id);plan['target_confirmed_prd_revision_id']=str(prd.revision_id)
    with backend.readonly() as conn:
        snapshot=backend.content(conn,pid,prd.artifact_id,prd.revision_id)
        plan['target_prd_sha256']=m.text_hash(snapshot['content']['markdown_body'])
        plan['source']['project_name']=conn.execute('SELECT name FROM ee.projects WHERE id=%s',(UUID(plan['source']['project_id']),)).fetchone()['name']
        plan['source']['function_name']=conn.execute('SELECT name FROM ee.business_functions WHERE id=%s',(UUID(plan['source']['function_id']),)).fetchone()['name']
        for item in plan['sources']:
            source=backend.content(conn,UUID(plan['source']['project_id']),UUID(item['artifact_id']))
            item['head_revision_id']=str(source['head_revision_id'])
            item['content_sha256']=m.digest(source['content'])
            item['source_prd_revision_id']=str(source['content']['prd_revision_id'])
            body=conn.execute('SELECT markdown_body FROM ee.prd_versions WHERE revision_id=%s',(source['content']['prd_revision_id'],)).fetchone()['markdown_body']
            item['source_prd_sha256']=m.text_hash(body)
            item['branch_count']=len(source['content']['branches']);item['exception_count']=len(source['content']['exceptions'])
            item['new_artifact_id']=str(uuid4());item['request_id']=str(uuid4())
    m.WRITE_ATTEMPTS.clear()
    dbname=db.execute('SELECT current_database()').fetchone()[0]
    return backend,plan,dbname

def tally(db,plan):
    p=UUID(plan['target']['project_id'])
    return db.execute("SELECT count(*),count(accepted_revision_id) FROM ee.artifacts WHERE project_id=%s AND type_code='UC'",(p,)).fetchone()

def source_stamp(db,plan):
    p=UUID(plan['source']['project_id'])
    with db.cursor(row_factory=dict_row) as c:
        artifacts=c.execute("SELECT * FROM ee.artifacts WHERE project_id=%s ORDER BY id",(p,)).fetchall()
        revisions=c.execute('SELECT * FROM ee.artifact_revisions WHERE project_id=%s ORDER BY id',(p,)).fetchall()
        cases=c.execute('SELECT * FROM ee.uc_scenario_items WHERE project_id=%s ORDER BY item_id',(p,)).fetchall()
    return m.digest([artifacts,revisions,cases])

def test_db_full_copy_readonly_preflight_replay_and_no_confirmation(db,prepared):
    backend,plan,name=prepared;before=source_stamp(db,plan)
    proposed=m.execute(backend,plan,False,name)
    assert tally(db,plan)==(0,0) and len(proposed)==3
    final=m.execute(backend,plan,True,name)
    assert tally(db,plan)==(3,0) and source_stamp(db,plan)==before
    assert all(x['existing']['accepted_revision_id'] is None for x in final)
    assert {len(x['normalized']['branches']) for x in final}=={4}
    ids=[UUID(x['new_artifact_id']) for x in plan['sources']]
    assert db.execute('SELECT count(*) FROM ee.artifact_revisions WHERE artifact_id=ANY(%s)',(ids,)).fetchone()[0]==3
    assert db.execute("SELECT count(*) FROM ee.security_audit_events WHERE project_id=%s AND event_type='uc.create'",(UUID(plan['target']['project_id']),)).fetchone()[0]==3
    assert db.execute('SELECT count(*) FROM ee.use_cases WHERE artifact_id=ANY(%s) AND prd_id=%s',(ids,UUID(plan['target_prd_artifact_id']))).fetchone()[0]==3
    m.execute(backend,plan,True,name)
    assert tally(db,plan)==(3,0) and source_stamp(db,plan)==before
    assert db.execute('SELECT count(*) FROM ee.artifact_revisions WHERE artifact_id=ANY(%s)',(ids,)).fetchone()[0]==3
    assert db.execute("SELECT count(*) FROM ee.security_audit_events WHERE project_id=%s AND event_type='uc.create'",(UUID(plan['target']['project_id']),)).fetchone()[0]==3

@pytest.mark.parametrize('failure',['before_second','after_first_commit'])
def test_db_partial_completion_resumes_without_duplicates(db,prepared,monkeypatch,failure):
    backend,plan,name=prepared;real=backend.create;calls=[]
    def interrupted(*args):
        calls.append(1)
        if failure=='before_second' and len(calls)==2:raise RuntimeError('simulated stop before commit')
        result=real(*args)
        if failure=='after_first_commit' and len(calls)==1:raise RuntimeError('simulated response loss after commit')
        return result
    monkeypatch.setattr(backend,'create',interrupted)
    with pytest.raises(RuntimeError):m.execute(backend,plan,True,name)
    assert tally(db,plan)==(1,0)
    monkeypatch.setattr(backend,'create',real)
    m.execute(backend,plan,True,name)
    assert tally(db,plan)==(3,0)

@pytest.mark.parametrize('guard,expected',[('source_hash','SOURCE_UC_CONTENT_CHANGED'),('source_head','SOURCE_UC_VERSION_STATE_CHANGED'),('target_hash','TARGET_PRD_CONTENT_CHANGED'),('target_reference','TARGET_PRD_REFERENCE_CHANGED'),('source_prd','SOURCE_PRD_CONTENT_CHANGED'),('project_name','PROJECT_OR_FUNCTION_CHANGED'),('database','DATABASE_IDENTITY_MISMATCH')])
def test_db_changed_inputs_never_create(db,prepared,guard,expected):
    backend,plan,name=prepared
    if guard=='source_hash':plan['sources'][0]['content_sha256']='0'*64
    elif guard=='source_head':plan['sources'][0]['head_revision_id']=plan['sources'][1]['head_revision_id']
    elif guard=='target_hash':plan['target_prd_sha256']='0'*64
    elif guard=='target_reference':plan['target_confirmed_prd_revision_id']=str(uuid4())
    elif guard=='source_prd':plan['sources'][0]['source_prd_sha256']='0'*64
    elif guard=='project_name':plan['target']['project_name']='not approved'
    elif guard=='database':name='not_the_local_database'
    from app.services.projects import ProjectReadError
    with pytest.raises((m.StopCopy,ProjectReadError)) as error:m.execute(backend,plan,True,name)
    assert error.value.code==expected or (guard=='source_head' and error.value.code=='source_changed')
    assert tally(db,plan)==(0,0)

def test_db_disabled_write_gate_and_readonly_role(db,prepared,monkeypatch):
    backend,plan,name=prepared
    from app.services.projects import ProjectReadError
    monkeypatch.setattr(settings,'business_writes_enabled',False)
    with pytest.raises(ProjectReadError) as error:m.execute(backend,plan,True,name)
    assert error.value.code=='business_write_forbidden' and tally(db,plan)==(0,0)

def test_db_unexpected_target_uc_blocks_without_modification(db,prepared):
    backend,plan,name=prepared
    entry=m.inspect(backend,plan,name)[0]
    body=backend.payload(entry['normalized'],uuid4())
    backend.create(plan['subject'],UUID(plan['target']['project_id']),UUID(plan['target']['function_id']),body,str(uuid4()))
    with pytest.raises(m.StopCopy) as error:m.execute(backend,plan,True,name)
    assert error.value.code=='UNEXPECTED_TARGET_UC_PRESENT' and tally(db,plan)==(1,0)

def test_db_edited_copies_are_not_overwritten(db,prepared):
    backend,plan,name=prepared
    final=m.execute(backend,plan,True,name)
    from app.schemas.manual_work import SaveRevision,UcContent
    entry=final[0];content=copy.deepcopy(entry['normalized']);content['description']='user edit must remain'
    manual_work.save_revision(plan['subject'],UUID(plan['target']['project_id']),UUID(entry['source']['new_artifact_id']),SaveRevision(mutation_id=uuid4(),base_revision_id=entry['existing']['head_revision_id'],content=UcContent(**content)),str(uuid4()))
    with pytest.raises(m.StopCopy) as error:m.execute(backend,plan,True,name)
    assert error.value.code=='COPY_WAS_EDITED_STOP'

def test_db_confirmed_copies_are_not_reset(db,prepared):
    backend,plan,name=prepared
    final=m.execute(backend,plan,True,name);entry=final[0]
    manual_work.accept_revision(plan['subject'],UUID(plan['target']['project_id']),UUID(entry['source']['new_artifact_id']),AcceptRevision(mutation_id=uuid4(),revision_id=entry['existing']['head_revision_id']),str(uuid4()))
    with pytest.raises(m.StopCopy) as error:m.execute(backend,plan,True,name)
    assert error.value.code=='COPY_ALREADY_CONFIRMED_STOP' and tally(db,plan)==(3,1)

def test_db_all_three_copies_can_be_manually_confirmed(db,prepared):
    backend,plan,name=prepared;before=source_stamp(db,plan)
    final=m.execute(backend,plan,True,name)
    assert tally(db,plan)==(3,0)
    for entry in final:
        manual_work.accept_revision(plan['subject'],UUID(plan['target']['project_id']),UUID(entry['source']['new_artifact_id']),AcceptRevision(mutation_id=uuid4(),revision_id=entry['existing']['head_revision_id']),str(uuid4()))
    assert tally(db,plan)==(3,3) and source_stamp(db,plan)==before

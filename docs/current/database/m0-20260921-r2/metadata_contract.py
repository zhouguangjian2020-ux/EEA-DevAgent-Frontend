"""Four fixed, versioned metadata definitions. No dynamic type/form builder or executable rules.
Canonical read content is produced by ee.revision_document; API integration is a later phase.
"""
from pathlib import Path
import copy
import json
import uuid

BASE = Path(__file__).resolve().parent
SCHEMA = 'https://json-schema.org/draft/2020-12/schema'
NAMESPACE = uuid.UUID('f76e6490-7d4b-4f8c-a9dc-ec121904fae9')
BRANCHES = [('a1','分支事件流1'),('a2','分支事件流2'),('a3','分支事件流3'),('a4','分支事件流4')]
EXCEPTIONS = [('vehicle_state','车辆状态异常'),('mechanical','机械故障'),('environmental','环境突变'),('misuse','用户误操作（滥用）'),('power','供电异常')]

def obj(properties, required=None):
    return {'type':'object','properties':properties,'required':list(properties) if required is None else required,'additionalProperties':False}
def text(readonly=False):
    return {'type':'string', **({'readOnly':True} if readonly else {})}
def uid():
    return {'type':'string','format':'uuid'}
def field(key,label,description,widget='multiline',edit='revision',validation=None,**kwargs):
    return dict(key=key,path=key,label=label,description=description,widget=widget,edit=edit,validation=validation or {},**kwargs)
def ref_policy(type_code):
    return {'target_type':type_code,'scope':'same_project_same_function','identity':'artifact_id_and_revision_id','acceptance':'current_accepted_direct'}
def ref_schema():
    return obj({'artifact_id':uid(),'revision_id':uid()})
def source_schema():
    return obj({'artifact_id':{**uid(),'title':'UC对象身份','description':'来源选择器确定的真实UC身份，不用可变编号作为外键。'},'revision_id':{**uid(),'title':'UC内容版本','description':'固定引用的具体版本，不静默升级。'},'rationale':{'type':['string','null'],'title':'来源关联说明','description':'兼容导入及关联证据；本期来源选择器不单独编辑此值。','readOnly':True}})
def scenarios(categories):
    return {'type':'array','items':obj({'item_id':{**uid(),'title':'场景项身份','description':'系统保持的稳定行身份。','readOnly':True},'category':{'type':'string','enum':[x[0] for x in categories],'title':'场景类别','description':'由固定显示槽选择，不能自由填写类别。','readOnly':True},'position':{'type':'integer','minimum':0,'title':'类别内顺序','description':'系统维护的顺序。','readOnly':True},'body':{**text(),'title':'场景正文','description':'可在用例整表编辑中修改；无源记录的空槽不自动持久化。'}})}
def code_field(label='编号',key='code'):
    return field(key,label,'稳定身份编号；内容修改不得改变。','text','readonly')

def instance_contract():
    manifest=json.loads((BASE/'schema-manifest.json').read_text(encoding='utf-8'))
    fields={}
    for name in ['artifacts','artifact_revisions']:
        table=next(t for t in manifest['tables'] if t['name']==name)
        fields[name]=[{'key':f['name'],'storage_type':f['type'],'description':f['purpose'],'nullable':f['nullable']=='是','edit':'readonly','source':'database','json_encoding':'decimal_string' if f['type']=='bigint' else 'native'} for f in table['fields'] if f['name']!='ai_run_id']
    return {'contract_version':1,'scope':'shared_instance_adapter_not_deployed_OpenAPI',
      'identity_and_revision_fields':fields,
      'runtime_fields':[
        {'key':'review_status','values':['pending','accepted','rejected'],'source':'latest_review_for_viewed_revision','edit':'readonly'},
        {'key':'is_head','type':'boolean','source':'viewed_revision_equals_head','edit':'readonly'},
        {'key':'is_current_accepted','type':'boolean','source':'viewed_revision_equals_accepted_pointer','edit':'readonly'},
        {'key':'dependencies','type':'array','source':'direct_version_references_and_current_accepted_pointers','edit':'readonly','items':{'artifact_id':'uuid','referenced_revision_id':'uuid','current_accepted_revision_id':'uuid_or_null','changed':'boolean','has_unaccepted_working_revision':'boolean'}},
        {'key':'acceptance_issues','type':'array','source':'bound_definition_plus_direct_upstream_checks','edit':'readonly','not_authorization':True},
        {'key':'capabilities','source':'authenticated_backend_only','edit':'readonly','fields':['can_revise','can_accept','readonly_reasons'],'not_stored':True,'when_absent':'deny_writes'}],
      'effective_editability':'field_rule AND authenticated_permission AND current_view_and_version_checks; no client supplied capability is trusted',
      'acceptance':'explicit_authorized_action_only; saving and AI completion never accept',
      'implementation_status':'SQL content/state/validation adapters implemented; authenticated API and frontend metadata consumption pending'}

def definitions():
    result=[]
    definitions_by_type={
      'PRD':('PRD','业务功能的产品需求正文；不强制结构化章节。','prd','markdown_document'),
      'UC':('用例','独立用例及其场景结构，固定引用一版PRD。','uc','uc_merged_table'),
      'FR':('功能需求','单条需求描述及一个或多个明确UC版本来源。','fr','fr_detail'),
      'FR_ALLOCATION':('FR分配','一条FR具体版本到本项目子系统方案条目的分配集合。','fr-allocation','allocation_row'),
    }
    for typ,(title,description,workspace,renderer) in definitions_by_type.items():
        reference={}
        if typ=='PRD':
            properties={'code':text(True),'markdown_body':text()}
            fields=[code_field(),field('markdown_body','PRD正文',description,'markdown',validation={'accept_nonblank':True})]
            fields[0]['visible_in']=[]
        elif typ=='UC':
            labels=[('name','用例名称'),('description','用例描述'),('actors_text','参与者'),('preconditions','前置条件'),('postconditions','后置条件'),('extensions_text','扩展用例'),('hmi_logic','HMI 交互逻辑'),('regulations','法规需求'),('performance','性能需求'),('nonfunctional','非功能需求')]
            properties={k:text() for k,_ in labels}
            properties.update(code=text(True),scenario=obj({'main_flow':text(),'branches':scenarios(BRANCHES),'exceptions':scenarios(EXCEPTIONS)}),prd_source={**ref_schema(),'readOnly':True})
            lookup={k:field(k,label,label+'；保留原文，不自动补写N/A。',validation={'accept_nonblank':True} if k in ('name','description') else {}) for k,label in labels}
            fields=[lookup['name'],lookup['description'],code_field('用例编号'),lookup['actors_text'],lookup['preconditions'],
                field('scenario','场景','主流1行、分支4显示槽、异常5显示槽；空槽不生成虚构记录。','scenario_merged',children=[
                  field('main_flow','主事件流','主要事件顺序；接受时非空白。',validation={'accept_nonblank':True},path_segments=['scenario','main_flow']),
                  field('branches','分支事件流','仅存实际记录；显示槽与数据条数不同。','scenario_rows',path_segments=['scenario','branches'],slots=[{'key':k,'label':v} for k,v in BRANCHES]),
                  field('exceptions','异常事件流','仅存实际记录；不要求填满异常类别。','scenario_rows',path_segments=['scenario','exceptions'],slots=[{'key':k,'label':v} for k,v in EXCEPTIONS])]),
                *[lookup[k] for k in ('postconditions','extensions_text','hmi_logic','regulations','performance','nonfunctional')],
                field('prd_source','PRD依据','固定的PRD身份与内容版本。','reference','readonly',visible_in=[])]
            reference={'prd_source':ref_policy('PRD')}
        elif typ=='FR':
            properties={'code':text(True),'uc_sources':{'type':'array','items':source_schema()},'description':text()}
            fields=[code_field('需求编号'),field('uc_sources','需求来源','真实UC身份及版本；允许多选、增删、替换；不可手填编号。','uc_revision_picker',validation={'accept_min_items':1}),field('description','需求描述','单条功能需求正文。',validation={'accept_nonblank':True})]
            reference={'uc_sources':{**ref_policy('UC'),'selection':'current_accepted_revision','retain_unchanged_base_references':True,'pending_update_warning':True,'controlled_import':'dba_only_preserve_pending'}}
        else:
            properties={'fr_code':text(True),'uc_sources':{'type':'array','items':source_schema(),'readOnly':True},'description':text(True),'subsystem_ids':{'type':'array','uniqueItems':True,'items':uid()},'fr_source':{**ref_schema(),'readOnly':True},'scheme_version_id':{**uid(),'readOnly':True},'note':{'type':['string','null'],'readOnly':True}}
            fields=[code_field('需求编号','fr_code'),field('uc_sources','需求来源','从本分配引用的FR版本派生；本视图不可修改。','reference_list','derived'),field('description','需求描述','从本分配引用的FR版本派生。','multiline','derived'),field('subsystem_ids','子系统名称','从本项目目录搜索多选；空目标可暂存。','subsystem_picker',validation={'accept_min_items':1}),field('fr_source','FR依据','固定的FR身份与版本。','reference','readonly',visible_in=[]),field('scheme_version_id','子系统方案版本','固定方案版本；不静默升级历史。','text','readonly',visible_in=[]),field('note','导入备注','兼容既有存储；本期界面不开放编辑。','multiline','readonly',visible_in=[])]
            reference={'fr_source':ref_policy('FR'),'subsystem_ids':{'scope':'same_project','selection':'current_scheme_allocatable_items','identity':'scheme_version_id_and_subsystem_id','acceptance':'pinned_scheme_valid_items_not_latest'}}
        view_name='allocation' if typ=='FR_ALLOCATION' else 'detail'
        for f in fields:
            f.setdefault('visible_in',[view_name]);f.setdefault('path_segments',[f['key']])
            f['path']='.'.join(f['path_segments'])
            properties[f['key']].update(title=f['label'],description=f['description'])
            for c in f.get('children',[]):
                c.setdefault('visible_in',[view_name]);c['path']='.'.join(c['path_segments'])
                properties[f['key']]['properties'][c['key']].update(title=c['label'],description=c['description'])
        content={'$schema':SCHEMA,'title':title,'description':description,**obj(properties),'x-ee':{
            'contract_version':1,'type_code':typ,'workspace_key':workspace,'renderer':renderer,'instance_contract':instance_contract(),
            'editing':'selector_immediate_pending_revision' if typ=='FR_ALLOCATION' else 'whole_document_new_revision',
            'validation_stages':['save_structure_and_references','accept_business_completeness'],
            'references':reference,'type_upgrade':'explicit_new_definition_and_new_content_revision',
            'history':'pinned_definition_and_immutable_content','unknown_widget':'fail_closed',
        }}
        extra={'$schema':SCHEMA,'title':'系统管理的导入/来源附加信息','type':'object','readOnly':True,
            'properties':{
              'seed_checksum':{'type':'string','title':'导入批次校验值'},'file':{'type':'string','title':'来源文件'},'sha256':{'type':'string','title':'来源文件SHA-256'},
              'converter':{'type':'string','title':'转换器版本'},'table':{'type':'integer','title':'来源Word表序号'},'sheet':{'type':'string','title':'来源工作表'},'row':{'type':'integer','title':'来源行号'},
              'prd_relation':{'type':'string','title':'PRD关联证据说明'},'missing_branch_slots':{'type':'array','items':{'type':'string'},'title':'源文档缺失的分支槽'},
              'original_source_text':{'type':'string','title':'原始来源描述'},'original_target_name':{'type':'string','title':'原始分配目标名'},'canonical_target_name':{'type':'string','title':'确认后的目录名称'}},
            'additionalProperties':True,'description':'系统管理的来源证据；未知键原样保留并只读，不作为自定义业务字段、权限或正式状态。无一期业务扩展属性编辑器。'}
        result.append({'id':str(uuid.uuid5(NAMESPACE,typ+':2')),'type_code':typ,'version_no':2,'created_by':'__IMPORT_USER__','content_schema':content,'field_catalog':fields,'metadata_schema':extra})
    return result

def validate(defs):
    assert len(defs)==4 and {x['type_code'] for x in defs}=={'PRD','UC','FR','FR_ALLOCATION'}
    for d in defs:
        assert d['version_no']==2
        schema=d['content_schema']; keys=set(schema['properties']); fields=d['field_catalog']
        assert {x['key'] for x in fields}==keys, d['type_code']
        assert len(fields)==len(keys)
        assert set(schema['required'])==keys
        assert schema['x-ee']['contract_version']==1
        for f in fields:
            assert f['edit'] in ('readonly','revision','derived') and f['label'] and f['description']
            for v in [f]+f.get('children',[]):
                assert v['widget'] in {'text','markdown','multiline','scenario_merged','scenario_rows','reference','reference_list','uc_revision_picker','subsystem_picker'}
                assert v['edit'] in ('readonly','revision','derived') and v['label'] and v['description']
                assert set(v['validation'])<= {'accept_nonblank','accept_min_items'}
                target=schema
                for part in v['path_segments']: target=target['properties'][part]
                if v['validation'].get('accept_nonblank'): assert target['type']=='string'
                if 'accept_min_items' in v['validation']: assert target['type']=='array'
        if d['type_code']=='UC': assert len([f for f in fields if 'detail' in f['visible_in']])==12
        if d['type_code']=='FR_ALLOCATION': assert [f['key'] for f in fields if f['edit']=='revision']==['subsystem_ids']
    return True

def main():
    defs=definitions();validate(defs)
    (BASE/'data/instance-contract.json').write_text(json.dumps(instance_contract(),ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    (BASE/'data/type-definitions.json').write_text(json.dumps(defs,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    # Only replace type definitions and their revision binding; do not transform business sample content.
    package=json.loads((BASE/'data/seed-data.json').read_text(encoding='utf-8'))
    package['data']['artifact_type_versions']=defs
    ids={d['type_code']:d['id'] for d in defs}
    for row in package['data']['artifact_revisions']: row['type_version_id']=ids[row['type_code']]
    (BASE/'data/seed-data.json').write_text(json.dumps(package,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print('Four metadata v2 definitions compiled; sample business content unchanged.')

if __name__=='__main__': main()

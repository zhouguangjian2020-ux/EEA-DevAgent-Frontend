"""Isolated probes of reviewed source. No LLM, network, or repository writes."""
import ast, asyncio, json, sys, time
from pathlib import Path
from types import SimpleNamespace

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(r"E:\Git projects\Agent Project\ai_service")
sys.path.insert(0, str(ROOT))
sys.dont_write_bytecode = True
from api.schemas import AgentRequest, TaskStatus
from api.services.task_store import TaskRecord, TaskStore
from api.errors import skill_input_missing

results = []
def record(name, observation):
    results.append({"probe": name, "observation": observation})

def extract(path, names, namespace):
    tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
    nodes = [ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0)]
    nodes += [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names]
    exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), str(ROOT / path), "exec"), namespace)

record("request_model", {
    "empty_request_accepted_by_schema": AgentRequest().model_dump(),
    "unknown_top_level_field_ignored": "agent" not in AgentRequest.model_validate({"agent": "functional_safety_agent"}).model_dump(),
    "scene_normalized": AgentRequest(scene="one_click_expand").scene,
})
ns = {}
extract("api/services/agent_runner.py", {"_detect_interrupt", "_validate_inputs_against_schema"}, ns)
payload = {"step_id":"step_1", "tool":"product_agent", "skill":"feature_definition", "message":"需要人工确认", "input":"AEB"}
record("confirm_classification", ns["_detect_interrupt"]({"__interrupt__":[SimpleNamespace(value=payload)]}))
ns["skill_input_missing"] = skill_input_missing
ns["_validate_inputs_against_schema"]({"feature_name":123, "unknown":True}, {"feature_name":{"type":"string", "required":True}}, "feature_expand")
record("input_validation", "A numeric value for a declared string, and an unknown input key, both pass the actual presence-only validator.")
rec = TaskRecord(task_id="probe", thread_id="probe", status=TaskStatus.COMPLETED)
try:
    json.dumps(rec.to_detail_dict())
except TypeError as exc:
    record("callback_payload_json", str(exc))

async def probe_async_exception():
    store = TaskStore()
    rec = TaskRecord(task_id="probe-error", thread_id="probe", status=TaskStatus.PENDING, timeout_seconds=1)
    await store.create(rec)
    async def failing_invoke(**kwargs):
        raise skill_input_missing(["message"], "orchestration")
    async def noop(*args):
        return None
    ns = {"asyncio":asyncio, "TaskStatus":TaskStatus, "get_task_store":lambda:store, "get_callback_client":lambda:SimpleNamespace(notify_if_needed=noop), "run_invoke":failing_invoke}
    extract("api/services/agent_runner.py", {"_run_task_async"}, ns)
    try:
        await ns["_run_task_async"](rec)
    except Exception as exc:
        record("async_error_handler", {"exception":type(exc).__name__, "message":str(exc), "remaining_status":rec.status.value})

async def probe_sync_timeout():
    from api.schemas import InvokeResponse
    binding = SimpleNamespace(agent="product_agent", skill="feature_expand", response_format="text")
    async def slow_skill(*args, **kwargs):
        await asyncio.sleep(1.1)
        return SimpleNamespace(text="offline test output", structured=None, usage={})
    ns = {"json":json, "REFERENCE_DATA_MAX_BYTES":51200,
          "_new_task_id":lambda:"sync-probe", "_new_thread_id":lambda:"probe",
          "_make_llm_logger":lambda trace:None, "get_scene_resolver":lambda:SimpleNamespace(resolve=lambda scene:binding),
          "get_registry":lambda:{"agents":{"product_agent":{}}},
          "validate_binding":lambda *args:{"inputs":{"feature_name":{"required":True}}},
          "_validate_inputs_against_schema":lambda *args:None,
          "_execute_skill_v2_async":slow_skill, "InvokeResponse":InvokeResponse}
    extract("api/services/agent_runner.py", {"run_invoke"}, ns)
    start=time.monotonic()
    result=await ns["run_invoke"](message=None, scene="ONE_CLICK_EXPAND", inputs={"feature_name":"AEB"}, thread_id=None, context=None, reference_data=None, response_format=None, timeout_seconds=1, trace_id="probe")
    record("sync_timeout_ignored", {"requested_seconds":1, "elapsed_seconds":round(time.monotonic()-start,3), "result":result.output})

async def main():
    await probe_async_exception()
    await probe_sync_timeout()
asyncio.run(main())
record("python_syntax", {"files_parsed":len(list(ROOT.rglob("*.py"))), "errors":[str(p) for p in []]})
for path in ROOT.rglob("*.py"):
    ast.parse(path.read_text(encoding="utf-8"))
print(json.dumps({"method":"Source function extraction with local doubles; actual Pydantic models and TaskRecord; no full server or LLM integration test.", "results":results}, ensure_ascii=False, indent=2))


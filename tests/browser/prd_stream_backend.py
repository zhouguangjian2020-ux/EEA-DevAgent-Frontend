"""Isolated, loopback-only UI verification fixture. Never import this in production.

Uses the production auth and PRD SSE route/Agent adapter. Only project/workspace
reads are fixtures; no database DSN, migrations, writes, or auth bypass.
"""
import argparse
import asyncio
from pathlib import Path
import sys
import time
from uuid import UUID


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.backend_dir.resolve()))
    import json
    import uvicorn
    from fastapi import FastAPI, Cookie, HTTPException, Request
    from pydantic import SecretStr
    from app.core.config import settings

    # All authentication is real demo-cookie auth, with throwaway local credentials.
    settings.projects_database_url = SecretStr("")
    settings.projects_write_database_url = SecretStr("")
    settings.business_writes_enabled = False
    settings.demo_username = "prd-preview"
    settings.demo_password = "prd-preview-local-only"
    settings.cookie_secure = False
    # Security hashes the demo password at import, so set isolated credentials first.
    from app.api.routes import agent as agent_routes, auth, health
    from app.services.prd_generation import PrdGenerationContext, PrdGenerationError, stream_prd_generation
    from app.services.projects import ProjectReadError
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    control_file = output / "scenario.json"
    control_file.write_text('{"mode":"live"}', encoding="utf-8")
    evidence = {"fixture_data": True, "database_connections": 0, "business_writes": 0, "requests": [], "generations": []}

    project_id = UUID("10d4c8a0-ff3a-56c3-abf6-18dc3b531e62")
    function_id = UUID("20d4c8a0-ff3a-56c3-abf6-18dc3b531e62")
    prd_id = UUID("30d4c8a0-ff3a-56c3-abf6-18dc3b531e62")
    revision_id = UUID("40d4c8a0-ff3a-56c3-abf6-18dc3b531e62")
    sample = Path(__file__).resolve().parents[2] / "docs/current/database/seed-candidates/dvr-20260921/prd-body.draft.md"
    source = sample.read_text(encoding="utf-8")
    begin = source.index("3.2 功能定义")
    definition = source[begin:source.index("4 功能详细说明", begin)].strip()
    project = {"id": str(project_id), "code": "LOCAL-PRD-STREAM", "name": "测试项目1（本地流式联调）", "description": "仅用于浏览器验证的隔离样例，不是公司数据库", "lock_version": "1", "created_at": "2026-09-29T10:00:00Z", "updated_at": "2026-09-29T10:00:00Z", "can_update": False, "can_delete": False, "can_manage_access": False}
    workspace = {"project": project, "functions": [{"id": str(function_id), "code": "DVR", "name": "行车记录仪DVR", "description": definition, "lock_version": "1", "can_update": False, "can_delete": False, "can_create_prd": False, "can_create_uc": False, "can_create_fr": False, "accepted_use_cases": [], "use_cases": [], "functional_requirements": [], "fr_allocations": [], "subsystems": [], "prd": {"id": str(prd_id), "code": "PRD-DVR-01", "lock_version": "1", "can_delete": False, "markdown_body": "# 原 PRD（联调样例）\n\n原始正文应始终保留。生成内容只在独立预览中展示，不覆盖本段文字。", "source": "database", "revision": {"revision_id": str(revision_id), "accepted_revision_id": str(revision_id), "revision_no": "1", "status": "accepted", "type_version_id": str(revision_id), "created_via": "manual", "created_at": "2026-09-29T10:00:00Z"}}}], "capabilities": ["PRD.update", "PRD.accept"], "can_create_function": False, "read_only": False, "source": "database"}

    def save_evidence():
        (output / "browser-backend-evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")

    def read_context(subject, *, project_id: UUID, function_id: UUID):
        if subject != settings.demo_username or str(project_id) != project["id"] or str(function_id) != workspace["functions"][0]["id"]:
            raise ProjectReadError(404, "project_not_found", "项目不存在或无权访问")
        return PrdGenerationContext(project_id, project["name"], project["description"], function_id, "行车记录仪DVR", definition)

    async def fixture_stream(context, *, version, request_id):
        mode = json.loads(control_file.read_text(encoding="utf-8"))["mode"]
        started = time.monotonic()
        run = {"mode": mode, "request_id": request_id, "token_count": 0, "first_token_seconds": None, "elapsed_seconds": None, "done": False, "cancelled": False}
        evidence["generations"].append(run)
        save_evidence()
        try:
            if mode == "error":
                await asyncio.sleep(0.4)
                raise PrdGenerationError(502, "agent_upstream_error", "联调故障注入：Agent 暂不可用，原 PRD 未修改。")
            if mode in {"slow", "disconnect"}:
                run["token_count"] += 1
                yield {"type": "token", "content": "# 联调测试预览\n\n这是一段未完成的生成内容。"}
                if mode == "disconnect":
                    return  # no done; frontend must fail, never succeed
                await asyncio.sleep(120)
                return
            async for event in stream_prd_generation(context, version=version, request_id=request_id):
                if event["type"] == "token":
                    run["token_count"] += 1
                    if run["first_token_seconds"] is None:
                        run["first_token_seconds"] = round(time.monotonic() - started, 2)
                        save_evidence()
                    elif run["token_count"] % 500 == 0:
                        save_evidence()
                elif event["type"] == "done":
                    run.update(done=True, output_chars=len(event["output"]), scene=event["scene"], project_marker_present=project["name"] in event["output"])
                    (output / "live-output.md").write_text(event["output"], encoding="utf-8")
                yield event
        except asyncio.CancelledError:
            run["cancelled"] = True
            raise
        finally:
            run["elapsed_seconds"] = round(time.monotonic() - started, 2)
            save_evidence()

    agent_routes.read_prd_generation_context = read_context
    agent_routes.stream_prd_generation = fixture_stream
    app = FastAPI(title="LOCAL PRD stream fixture — no database")
    app.include_router(health.router)
    app.include_router(auth.router, prefix="/v1/auth")
    app.include_router(agent_routes.router, prefix="/v1/agent")

    @app.middleware("http")
    async def record_request(request: Request, call_next):
        item = {"method": request.method, "path": request.url.path}
        if request.url.path.endswith("/prd/generate/stream"):
            item["body"] = await request.json()
            item["browser_sent_agent_key"] = "x-api-key" in request.headers
        if request.method not in {"GET", "HEAD"} and request.url.path.startswith("/v1/projects"):
            evidence["business_writes"] += 1
        evidence["requests"].append(item)
        save_evidence()
        return await call_next(request)

    @app.get("/v1/projects")
    def projects(ts_session: str | None = Cookie(default=None)):
        auth.require_user(ts_session)
        return {"items": [project], "limit": 20, "offset": 0, "has_more": False, "capabilities": {"can_create": False}}

    @app.get("/v1/projects/{pid}/workspace")
    def read_workspace(pid: UUID, ts_session: str | None = Cookie(default=None)):
        auth.require_user(ts_session)
        if pid != project_id: raise HTTPException(404)
        return workspace

    @app.get("/v1/projects/{pid}")
    def read_project(pid: UUID, ts_session: str | None = Cookie(default=None)):
        auth.require_user(ts_session)
        if pid != project_id: raise HTTPException(404)
        return project

    # No public bind, no alternate auth, no project mutations. Real Agent URL/key come from backend environment.
    uvicorn.run(app, host="127.0.0.1", port=8134, access_log=False)


if __name__ == "__main__":
    main()

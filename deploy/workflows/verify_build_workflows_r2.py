"""Fixture-only Bash verification. Docker/curl/uname are replaced; no network calls."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime

SCRIPT = Path(__file__).with_name("build-workflows-r2.sh")
BASH = Path(r"D:\Program Files\Git\bin\bash.exe")
TAG = "20261003-workflows-r2"
DIR_NAMES = [f"ts-backend-{TAG}", f"ts-frontend-{TAG}",
             f"ts-backend-agent-console-{TAG}", f"ts-agent-console-{TAG}"]
IMAGES = [f"ts-agent-backend:{TAG}", f"ts-agent-frontend:{TAG}",
          f"ts-agent-backend:agent-console-{TAG}", f"ts-agent-console:{TAG}"]
BASES = ["python:3.12-slim", "node:22-bookworm-slim"]
ROOT = SCRIPT.parents[2] / "tmp" / ("workflow-build-check-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
ROOT.mkdir(parents=True, exist_ok=False)
MOCK = ROOT / "mock_commands.py"
MOCK.write_text(r'''import json, os, sys
from pathlib import Path
state_path = Path(os.environ["WORKFLOW_FIXTURE_STATE"])
s = json.loads(state_path.read_text(encoding="utf-8"))
tool, *a = sys.argv[1:]
s.setdefault("calls", []).append([tool, *a])
code, out = 0, ""
if tool == "uname":
    out = s.get("os_name", "Linux")
elif tool == "curl":
    s["health_count"] = s.get("health_count", 0) + 1
    code = 22 if s.get("health_fail_at") == s["health_count"] else 0
    out = '{"status":"ok"}' if code == 0 else "fixture health failure"
elif tool == "docker":
    if a[:1] == ["info"]:
        code = 1 if s.get("docker_unavailable") else 0
        out = "linux" if code == 0 else "fixture docker unavailable"
    elif a[:2] == ["image", "inspect"]:
        image = a[-1]
        exists = image in s["bases"] or image in s["built"]
        code = 0 if exists else 1
        if "--format" in a and exists:
            out = "sha256:" + "a" * 64
        if "--format" in a and s.get("id_inspect_fail"):
            code, out = 1, "fixture ID check failure"
    elif a[:1] == ["build"]:
        image = a[a.index("--tag") + 1]
        if s.get("build_fail_image") == image:
            code, out = 1, "fixture build failure"
        else:
            s["built"].append(image)
            out = "Successfully tagged " + image
    elif a[:1] == ["ps"]:
        out = "ORIGINAL_CONTAINERS_UNCHANGED"
    else:
        code, out = 97, "FORBIDDEN_DOCKER_COMMAND"
else:
    code, out = 98, "FORBIDDEN_COMMAND"
state_path.write_text(json.dumps(s), encoding="utf-8")
if out:
    print(out)
sys.exit(code)
''', encoding="utf-8")


def case(name, *, config=None, fault=None, expect_success=False, expect_builds=0):
    path = ROOT / name
    path.mkdir()
    release = path / "release"
    release.mkdir()
    for folder in DIR_NAMES:
        folder_path = release / folder
        folder_path.mkdir()
        files = {"Dockerfile": b"FROM local-fixture-only\n", ".dockerignore": b".env\n"}
        sums = []
        for filename, content in files.items():
            (folder_path / filename).write_bytes(content)
            sums.append(hashlib.sha256(content).hexdigest() + "  " + filename + "\n")
        (folder_path / "SHA256SUMS").write_bytes("".join(sums).encode())
    if fault == "checksum":
        (release / DIR_NAMES[1] / "Dockerfile").write_bytes(b"corrupted fixture\n")
    if fault == "missing-dockerfile":
        (release / DIR_NAMES[1] / "Dockerfile").unlink()
    state = {"bases": list(BASES), "built": [], "calls": []}
    state.update(config or {})
    state_path = path / "state.json"
    state_path.write_text(json.dumps(state), encoding="utf-8")
    source = SCRIPT.read_text(encoding="utf-8")
    assert source.count("/data/ts-platform-managed/20261003/workflows-r2") == 1
    source = source.replace("/data/ts-platform-managed/20261003/workflows-r2", release.as_posix())
    mock_command = f'"{Path(sys.executable).as_posix()}" "{MOCK.as_posix()}"'
    driver = path / "driver.sh"
    driver.write_bytes((
        f'docker() {{ {mock_command} docker "$@"; }}\n'
        f'curl() {{ {mock_command} curl "$@"; }}\n'
        f'uname() {{ {mock_command} uname "$@"; }}\n'
        + source).encode())
    env = dict(os.environ, WORKFLOW_FIXTURE_STATE=str(state_path))
    env.pop("BASH_ENV", None)
    env["PATH"] = str(BASH.parent.parent / "usr" / "bin") + os.pathsep + env["PATH"]
    result = subprocess.run([str(BASH), str(driver)], env=env, capture_output=True, text=True,
                            encoding="utf-8", errors="replace", timeout=45)
    (path / "output.txt").write_text(result.stdout + result.stderr, encoding="utf-8")
    final_state = json.loads(state_path.read_text(encoding="utf-8"))
    builds = [c for c in final_state["calls"] if c[:2] == ["docker", "build"]]
    assert (result.returncode == 0) == expect_success, (name, result.stdout, result.stderr)
    assert ("BUILD_OK:" in result.stdout) == expect_success, name
    assert len(builds) == expect_builds, (name, builds)
    assert "FORBIDDEN" not in result.stdout + result.stderr, name
    for i, call in enumerate(builds):
        assert "--network=host" in call and "--pull=false" in call, call
        assert call[call.index("--tag") + 1] == IMAGES[i], call
        assert Path(call[-1]).name == DIR_NAMES[i], call
        assert ("--build-arg" in call) == (i == 1), call
        if i == 1:
            assert "BACKEND_URL=http://192.168.64.3:7000" in call, call
    if expect_success:
        assert final_state["built"] == IMAGES
        assert final_state["health_count"] == 8
    return {"case": name, "status": "PASS", "build_calls": len(builds)}

syntax = subprocess.run([str(BASH), "-n", str(SCRIPT)], capture_output=True, text=True)
assert syntax.returncode == 0, syntax.stderr
results = [
    case("success", expect_success=True, expect_builds=4),
    case("existing-target-refused", config={"built": [IMAGES[2]]}),
    case("completed-rerun-refused", config={"built": list(IMAGES)}),
    case("missing-python-base", config={"bases": [BASES[1]]}),
    case("missing-node-base", config={"bases": [BASES[0]]}),
    case("docker-unavailable", config={"docker_unavailable": True}),
    case("not-linux", config={"os_name": "MINGW64_NT"}),
    case("checksum-rejected", fault="checksum"),
    case("missing-dockerfile", fault="missing-dockerfile"),
    case("unhealthy-before-build", config={"health_fail_at": 3}),
    case("backend-build-fails", config={"build_fail_image": IMAGES[0]}, expect_builds=1),
    case("frontend-build-fails", config={"build_fail_image": IMAGES[1]}, expect_builds=2),
    case("preview-build-fails", config={"build_fail_image": IMAGES[2]}, expect_builds=3),
    case("console-build-fails", config={"build_fail_image": IMAGES[3]}, expect_builds=4),
    case("unhealthy-after-build", config={"health_fail_at": 6}, expect_builds=4),
    case("image-id-check-fails", config={"id_inspect_fail": True}, expect_builds=4),
]
report = {"status": "PASS", "bash_syntax": "PASS", "company_connected": False,
          "real_docker_build_executed": False,
          "script_sha256": hashlib.sha256(SCRIPT.read_bytes()).hexdigest(),
          "cases": results,
          "note": "Local fixtures only. All docker, curl, uname calls were replaced; no company service, DB, network or container operation."}
(ROOT / "verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"status": "PASS", "cases": len(results), "evidence": str(ROOT / "verification.json")}, ensure_ascii=False))

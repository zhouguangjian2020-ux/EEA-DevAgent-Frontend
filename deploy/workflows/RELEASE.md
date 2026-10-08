# FR / allocation / private-chat release: 20261003-workflows-r2

## Status

This is a verified SOURCE delivery, not a Docker image or an applied migration.
Company containers, database, credentials, Agent Skills and write switches have
NOT been changed by the packaging step. The tag follows the packaging workstation
local date; it is not evidence of a company deployment date.

The earlier local workflow-release-20261002-workflow-r1 and
workflow-release-20261003-r1 folders are incomplete/superseded. Do not upload them.
Use this new, separately checksummed release. Published r7 artifacts are unchanged.

## Contents

- ts-backend-20261003-workflows-r2.tar.gz: main backend source, port 7000 default.
- ts-frontend-20261003-workflows-r2.tar.gz: product frontend source, port 7100.
- ts-agent-console-20261003-workflows-r2.tar.gz: independent console, port 7200.
- ts-backend-agent-console-20261003-workflows-r2.tar.gz: preview backend, loopback 7018.
- ts-db-agent-workflows-20261003-workflows-r2.tar.gz: reviewed independent SQL bundle.
- manifest.json, RELEASE.md and root SHA256SUMS.

All four application archives exclude docs/, tests/, private .env files, saved
traces/data, logs, caches, local dependencies and old deployment helpers. Only
.env.example placeholders are included. SQL documentation is deliberately in the
SEPARATE SQL archive, not in an application image. Every archive has exactly one
SHA256SUMS; the SQL files and their original manifest are preserved byte-for-byte.
All generated checksum files use UTF-8 without BOM, with LF line endings.

Both backend release Dockerfiles use python:3.12-slim, based on the reviewed
TS-agent-console/deployment/Backend.Dockerfile. The old TS-backend Dockerfile
uses Python 3.10 and is NOT the release recipe. Do not swap it into these archives.

Runtime dependencies and frontend package/lock fingerprints are recorded in
manifest.json. This source delivery is not an offline Docker build. Later server
builds must retain the verified --network=host --pull=false options. If DNS or
registry access fails, STOP without stopping old containers or changing DNS/TLS.

## User-provided server baseline (not a new assistant connection)

Main backend: ts-agent-backend-20261002-project-role-r1
 image sha256:a6f0dc8ba3a05bfd68ceee0cd6ac23bd1e2811fdef8ac4c6e9aad8c265401517
Main frontend: ts-agent-frontend-20261002-project-context-r1
 image sha256:e7dab5cc351ba5a670363a7ade59ee8874d4dc03fd8a12c838c5ef02624675b7
Preview backend: ts-agent-backend-console-20261002-r7
 image sha256:fee63cada1554284b3b6992faffd78d6615cc026e2730f3b98f827ae02b910f5
Console: ts-agent-console-20261002-r7
 image sha256:21a8e77ff84148894800f367c0909e728289017e3a5c7250dd878242a4d83e3b

All four reported healthy. Main BUSINESS_WRITES_ENABLED=true; preview=false.
DB and Agent settings are present; no secret values were supplied here. The eight
new OpenAPI paths are missing in the OLD main image, as expected, not a config
failure. Do not repeatedly query the old image expecting new code to appear.

## Ordered gates -- do NOT run the whole deployment automatically

1. Upload to a NEW incoming directory, verify anchored root SHA256SUMS, then all
   eight delivered files. Stop and return the receipt. Do not apply SQL or stop
   containers in this step.
2. Stage into a NEW managed directory and verify each archive; prepare/build all
   images with existing services kept running. Docker success must be obtained on
   the company host; local Python/Node checks are not Linux Docker build proof.
3. Read-only DB baseline inspection, target database/cluster fingerprint checks,
   backup and a reviewed maintenance window. Do not use a stored privileged DSN
   or print docker inspect Config.Env. Company SQL remains user-executed.
4. Deploy the new compatible MAIN backend first while retaining the old frontend;
   verify health, OpenAPI, auth and old project flows. This backend accepts both
   the existing and the new exact permission sets. Retain its old container.
5. Execute reviewed SQL apply/verify. Do not grant new allocation permissions
   while the old main backend is still the intended long-running version: its
   exact role whitelist can reject new-project creation.
6. Initialize presets ONLY if the explicit approved project has no catalogue and
   the user approves it. Never overwrite existing/partially initialized catalogues.
7. Deploy the frontend only after compatible backend and schema are ready. Then
   independently review console and preview updates. Preserve the console's
   actual data mount and each running container's private environment/config.
8. Keep preview BUSINESS_WRITES_ENABLED=false until an explicit isolated-write
   plan is approved. New thread/message tests require chat-history writes; new
   buttons do not silently enable that switch. No Agent source changes.
9. Joint browser acceptance per document 47. Real Agent Skill results remain a
   separate verification from local contract-Mock acceptance.

Approved integration target: project bf8f4d08-d086-44bf-9cbe-f31abc67ee03,
function 3bb1333a-1ebf-428c-831f-c26dcd66cfa3. Recheck saved revision IDs before
real requests. Do not substitute other projects or seed synthetic production data.

## Rollback boundaries

Prefer frontend/entry rollback while retaining the compatible backend and data.
After new role grants, reverting to the pre-workflow backend is NOT automatically
safe for project creation. SQL rollback-empty-only.sql refuses existing chat/new
allocation history or later custom-role grants. Never delete history to force a
rollback. Preset catalogues are not automatically removed. Keep old images,
containers and data; do not run broad docker prune/remove operations.

## Evidence boundaries

Local A-class verification: real frontend/backend/disposable PG18 + contract Mock,
not a real Agent Skill or a company migration. See documents 45 (requirements),
46 (contracts), 47 (acceptance) and 48 (this deployment preparation).
The original PASS evidence is under TS-backend/artifacts/deletion-20260928/
20261003-020137-246804/. Packaging verification is recorded separately.

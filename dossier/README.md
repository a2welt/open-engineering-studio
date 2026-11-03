# Change dossiers

`studio dossier build` assembles a **change dossier** (`studio.dossier/v0`, schema in
[../docs/schemas/studio.dossier.v0.schema.json](../docs/schemas/studio.dossier.v0.schema.json))
for one change: references to the evidence the Studio's tools already hold, as decided in
[ADR 0001](../docs/adr/0001-change-dossier-and-risk-tiered-review.md). Standard library plus
Repo X-Ray; it only reads.

```bash
uv sync
OAT_API_TOKEN=… RECALL_API_TOKEN=… uv run studio dossier build \
  --repo ../../Open-model-fabric --base main --head my-branch \
  --pr github:pr:findajay/Open-model-fabric#42 \
  --oat-url http://127.0.0.1:8787 --recall-url http://127.0.0.1:4321 \
  --out dossier.json
uv run studio dossier verify dossier.json
```

| Member | Filled from |
|---|---|
| `change` | Git: repository URL (origin, without credentials), full base and head commits, head commit author; `--pr` |
| `impact` | `xray impact --base --head` on the head tree: changed files, number of transitive dependents, layers and components, and the X-Ray result's digest |
| `actions` | `oat serve`: `GET /v1/receipts?reference=<pr>` (all pages), each checked with `POST /v1/verify` and by recomputing its `agentproof:sha256:` reference |
| `approvals` | Approvals embedded in those receipts |
| `intent` | Recall: `GET /api/links?reference=…` for the PR and every changed file's `git+<url>@<commit>#<path>`, at the base commit (before) and the head commit (after) |
| `verification` | Receipt counts, and `tests_changed_by_agent`: changed test files that a successful, non-read receipt names as its resource. `ci` stays `null` until the GitHub Action fills it |
| `model_calls`, `risk` | Empty for now, each with a gap: BallastOS request ids and the `change.merge` tier policy come later |
| `gaps` | Missing evidence: no PR, no receipts, unverified receipts, no linked decision, a tool not configured or unreachable |

Tokens come from the environment: `OAT_API_TOKEN` for `oat serve`, `RECALL_API_TOKEN` for
Recall. A tool that is not configured or can't be reached becomes a gap, not an error: a
change with missing evidence still gets a dossier.

`digest` is `sha256:` over the canonical JSON of the dossier without `digest` (sorted keys, no
whitespace, UTF-8, integers only, the AgentProof canonical form). Dossiers carry no timestamps,
so two builds from the same sources are byte-identical in canonical form;
`studio dossier verify` recomputes the digest.

## Development

```bash
uv run ruff check src tests && uv run ruff format --check src tests
uv run mypy
uv run pytest -q
```

Tests build throwaway git repositories and run fake `oat serve` and Recall servers on loopback.

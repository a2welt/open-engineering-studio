# Open Engineering Studio

One place to **understand** a codebase, **trust** what agents do in it, **remember** why it is
the way it is, and **optimize** what model calls cost. The Studio connects independent tools
through their existing APIs instead of merging them:

| Screen | Tool | Status |
|---|---|---|
| Lifecycle (home) | **All of them**: every change from intent to memory, changes in flight with their risk tier and evidence, what needs you | Live counts from X-Ray and OpenAgentTrust; sample change dossiers until `studio dossier build` output is served ([ADR 0001](docs/adr/0001-change-dossier-and-risk-tiered-review.md)) |
| Understand | **Repo X-Ray** (this repository, `xray/`): import graph, layers, "what breaks if I change X" | v0, live |
| Trust | **OpenAgentTrust**: agent approvals and verifiable AgentProof receipts | Live with `oat serve`, mock otherwise; see [docs/oat-api.md](docs/oat-api.md) |
| Remember | **Recall**: engineering decisions | Sample decisions; Recall API in Phase 2 |
| Optimize | **BallastOS**: gateway token savings | Placeholder; live savings in Phase 2 |

Tools link to each other with the shared reference URIs defined in OpenAgentTrust's
`docs/integration/shared-references.md` (`agentproof:sha256:…`, `recall:memory:…`,
`git+<repo>@<commit>#<path>`).

```
xray/     Repo X-Ray: Python package, CLI and HTTP endpoint (standard library only)
dossier/  Change dossiers: `studio dossier build` (standard library plus Repo X-Ray)
web/      Studio shell: React + Vite + TypeScript
docs/     Integration contracts and decisions (docs/adr)
```

## Run Repo X-Ray

Needs Python 3.11+ and [uv](https://docs.astral.sh/uv/).

```bash
cd xray
uv sync
uv run xray layers --root ../../Open-model-fabric
uv run xray impact python/omf/core/services/routing.py --root ../../Open-model-fabric
uv run xray serve --root ../../Open-model-fabric      # http://127.0.0.1:8765
```

See [xray/README.md](xray/README.md) for every command, the JSON it prints, import resolution
and the `xray.toml` layer overrides.

## Build a change dossier

A change dossier (`studio.dossier/v0`, [ADR 0001](docs/adr/0001-change-dossier-and-risk-tiered-review.md),
[schema](docs/schemas/studio.dossier.v0.schema.json)) collects one change's evidence as
references: what it affects (Repo X-Ray, commit to commit), which agent actions are behind it
and whether their receipts verify (OpenAgentTrust), which decisions it implements (Recall), and
what is missing (`gaps`). Its `digest` covers the canonical JSON, so two builds can be compared.

```bash
cd dossier
uv sync
OAT_API_TOKEN=… RECALL_API_TOKEN=… uv run studio dossier build --repo ../../Open-model-fabric   --base main --head my-branch --pr github:pr:findajay/Open-model-fabric#42   --oat-url http://127.0.0.1:8787 --recall-url http://127.0.0.1:4321 --out dossier.json
uv run studio dossier verify dossier.json
```

Receipts are found through the PR reference, which `oat mcp-proxy --reference` adds to every
agent request. Without `--pr`, `--oat-url` or `--recall-url` the dossier is still built, with
the missing evidence listed in `gaps`. Model calls and the risk tier are not filled yet (ADR
0001 steps 4 to 6). See [dossier/README.md](dossier/README.md).

## Run the Studio

Needs Node.js 24.

```bash
cd web
npm install
npm run dev                                         # http://localhost:5173
```

The dev server proxies `/xray` to `xray serve` on port 8765 and `/oat` to `oat serve` on port
8787. Without a running X-Ray server, the Understand screen falls back to a bundled analysis of
Open-model-fabric and says so; the Trust screen uses its built-in mock unless you switch it to
the real gateway. Copy `web/.env.example` to `web/.env.local` to change modes, targets or the
OpenAgentTrust endpoint paths (`VITE_OAT_PATHS`).

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

### Trust screen against a real gateway

With [open-agent-trust](https://github.com/findajay/open-agent-trust) checked out next to this
repository, start a seeded gateway that plays a coding agent working on Open-model-fabric:

```bash
uv run --project ../open-agent-trust python scripts/oat_demo.py   # oat serve on :8787
cd web && npm run dev
```

The first run writes `web/.env.local` (`VITE_OAT_MODE=http`, `OAT_TARGET`, `OAT_API_TOKEN`).
The agent reads files and runs tests (allowed), tries to edit CI (denied) and asks to edit
`routing.py` (needs approval). Approve it on the Trust screen: the agent makes the edit,
reports the outcome, and the signed receipt shows up and verifies. Use `--port` if 8787 is
taken (and match `OAT_TARGET`).

The design follows the Studio glass design on the Claude Design canvas: frosted glass panels over
drifting colour blobs, light and dark themes (stored choice, else the
system setting) with WCAG AA contrast checked in tests, keyboard and screen-reader friendly
controls, a bottom navigation bar on phones, and no animation when the system asks for reduced
motion.

## License

Apache-2.0. See [LICENSE](LICENSE).

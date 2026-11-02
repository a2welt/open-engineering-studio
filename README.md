# Open Engineering Studio

One place to **understand** a codebase, **trust** what agents do in it, **remember** why it is
the way it is, and **optimize** what model calls cost. The Studio connects independent tools
through their existing APIs instead of merging them:

| Screen | Tool | Status |
|---|---|---|
| Understand | **Repo X-Ray** (this repository, `xray/`): import graph, layers, "what breaks if I change X" | v0, live |
| Trust | **OpenAgentTrust**: agent approvals and verifiable AgentProof receipts | Live with `oat serve`, mock otherwise; see [docs/oat-api.md](docs/oat-api.md) |
| Remember | **Recall**: engineering decisions | Sample decisions; Recall API in Phase 2 |
| Optimize | **BallastOS**: gateway token savings | Placeholder; live savings in Phase 2 |

Tools link to each other with the shared reference URIs defined in OpenAgentTrust's
`docs/integration/shared-references.md` (`agentproof:sha256:…`, `recall:memory:…`,
`git+<repo>@<commit>#<path>`).

```
xray/   Repo X-Ray: Python package, CLI and HTTP endpoint (standard library only)
web/    Studio shell: React + Vite + TypeScript
docs/   Integration contracts and decisions (docs/adr)
```

## Run everything

One command starts Repo X-Ray, a seeded OpenAgentTrust gateway and the Studio, wired together:

```bash
python scripts/dev.py --repo ../Open-model-fabric
```

It prefixes each process's output (`[xray]`, `[oat]`, `[web]`), moves to the next free port
when one is taken (and points the Studio's proxy at it), prints the Studio URL when all three
are up, and stops all of them on Ctrl+C or when one exits. It needs uv and Node.js 24, runs
`npm ci` on first use, and expects an
[open-agent-trust](https://github.com/findajay/open-agent-trust) checkout next to this
repository (`--oat PATH` to point elsewhere, `--no-oat` to use the Trust screen's mock).

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

The design follows the Studio design reference: light and dark themes (stored choice, else the
system setting) with WCAG AA contrast checked in tests, keyboard and screen-reader friendly
controls, a bottom navigation bar on phones, and no animation when the system asks for reduced
motion.

## License

Apache-2.0. See [LICENSE](LICENSE).

# Open Engineering Studio

One place to **understand** a codebase, **trust** what agents do in it, **remember** why it is
the way it is, and **optimize** what model calls cost. The Studio connects independent tools
through their existing APIs instead of merging them:

| Screen | Tool | Status |
|---|---|---|
| Understand | **Repo X-Ray** (this repository, `xray/`): import graph, layers, "what breaks if I change X" | v0, live |
| Trust | **OpenAgentTrust**: agent approvals and verifiable AgentProof receipts | Mock client until `oat serve` lands; see [docs/oat-api.md](docs/oat-api.md) |
| Remember | **Recall**: engineering decisions | Sample decisions; Recall API in Phase 2 |
| Optimize | **BallastOS**: gateway token savings | Placeholder; live savings in Phase 2 |

Tools link to each other with the shared reference URIs defined in OpenAgentTrust's
`docs/integration/shared-references.md` (`agentproof:sha256:…`, `recall:memory:…`,
`git+<repo>@<commit>#<path>`).

```
xray/   Repo X-Ray: Python package, CLI and HTTP endpoint (standard library only)
web/    Studio shell: React + Vite + TypeScript
docs/   Integration contracts
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

The design follows the Studio design reference: light and dark themes (stored choice, else the
system setting) with WCAG AA contrast checked in tests, keyboard and screen-reader friendly
controls, a bottom navigation bar on phones, and no animation when the system asks for reduced
motion.

## License

Apache-2.0. See [LICENSE](LICENSE).

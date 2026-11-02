# Repo X-Ray

Import graph, architecture layers and change impact for Python and TypeScript source trees.
Standard library only; it reads sources and never runs project code.

```bash
uv sync
uv run xray layers --root ../../Open-model-fabric
uv run xray impact python/omf/core/services/routing.py --root ../../Open-model-fabric
uv run xray graph --root . --compact
uv run xray serve --root ../../Open-model-fabric --port 8765
```

| Command | Output |
|---|---|
| `xray graph` | Every analysed file (language, layer, component), every import edge, and counts of unresolved (external) imports |
| `xray layers` | Layers with their components and file counts, cross-layer import counts, and imports that break the allowed directions |
| `xray impact PATH [--max-depth N]` | Files that import `PATH` directly or transitively, each with its depth, the file it goes through and the full chain; a summary by layer and component |
| `xray serve` | The same answers over HTTP: `GET /health`, `/graph`, `/layers`, `/impact?path=…&max_depth=…` (add `refresh=1` to re-analyse) |

All commands print JSON (`schema: "xray/v0"`). `PATH` can be a file, a directory (every file in it
counts as changed) or a unique suffix such as `services/routing.py`. When the root is a git
checkout with an `origin` remote, results carry the repository URL and commit, and impact
targets a code reference in the shared form `git+<url>@<commit>#<path>` (credentials in the
remote URL are dropped).

## How imports resolve

- **Python:** source roots are the parents of outermost packages (directories with
  `__init__.py`) plus the analysis root. `import a.b`, `from a import b`, relative imports and
  `importlib.import_module("…")` with a constant string resolve to the most specific file.
- **TypeScript/JavaScript:** `import`/`export … from`, side-effect imports, `import()` and
  `require()`. Relative paths (including `.js` specifiers for `.ts` files), `tsconfig.json`
  `paths`/`baseUrl`, configured aliases and workspace packages (any `package.json` with a
  `name`) resolve to files. Declaration files and build output are not graph nodes.
- Hidden directories, `node_modules`, virtualenvs and build output are skipped.

## Layers

Default conventions, by path segment: `bootstrap`/`composition`/`wiring` → composition root;
`adapters/*`, `infrastructure`, `integrations` → adapters; `core/*`, `domain`, `services`,
`ports`, `application` → core; `apps/*`, `packages/*`, `api`, `web`, `ui`, `cli` → presentation;
test directories and `test_*.py`/`*.test.ts` files → tests; everything else → other. The
outermost matching directory wins, and the matched directories name the component.

Allowed directions: presentation → core, composition; adapters → core; core → core only;
composition and tests → anything. Imports to or from "other" are never violations.

Override with an `xray.toml` at the analysed root (or `--config`):

```toml
exclude = ["legacy"]
python_roots = ["python", "apps/api"]
replace_default_layers = false   # true: only the rules below, no test rule

[[layers]]
layer = "core"
match = ["engine/*"]             # directory globs; files = ["*_handler.py"] also works

[aliases]
"@/" = "web/src/"

[allowed_dependencies]
core = ["core"]
```

## Development

```bash
uv run ruff check src tests && uv run ruff format --check src tests
uv run mypy
uv run pytest -q
```

`tests/test_open_model_fabric.py` checks the routing service's real dependents when an
Open-model-fabric checkout sits next to this repository (or `XRAY_OMF_ROOT` points to one).

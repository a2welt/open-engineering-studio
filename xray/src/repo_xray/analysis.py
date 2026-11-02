"""Analyse a source tree once, then answer graph, layer and impact questions as JSON."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import LAYER_LABELS, Config, load_config
from .discover import source_files, walk
from .gitinfo import Repository, repository
from .impact import reverse_edges, walk_dependents
from .layers import Placement, is_allowed, place
from .python_imports import PythonResolver, read_source
from .ts_imports import TsResolver

SCHEMA_VERSION = "xray/v0"


class TargetError(LookupError):
    """An impact target does not name any analysed file."""


@dataclass
class Analysis:
    root: Path
    config: Config
    files: dict[str, str]  # path -> language
    edges: dict[str, set[str]]  # importer -> imported files
    external: Counter[str]
    placements: dict[str, Placement]
    repo: Repository | None
    _reverse: dict[str, set[str]] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        self._reverse = reverse_edges(self.edges)

    # ---- shared pieces -------------------------------------------------------------

    def _header(self) -> dict[str, Any]:
        return {
            "schema": SCHEMA_VERSION,
            "root": str(self.root),
            "repository": self.repo.to_dict() if self.repo else None,
            "config": self.config.source,
        }

    def _file_entry(self, path: str) -> dict[str, Any]:
        placed = self.placements[path]
        entry: dict[str, Any] = {
            "path": path,
            "language": self.files[path],
            "layer": placed.layer,
            "component": placed.component,
        }
        return entry

    def ref(self, path: str) -> str | None:
        return self.repo.ref(path) if self.repo else None

    # ---- graph ---------------------------------------------------------------------

    def graph(self) -> dict[str, Any]:
        edge_list = [
            {"from": importer, "to": target}
            for importer in sorted(self.edges)
            for target in sorted(self.edges[importer])
        ]
        languages = Counter(self.files.values())
        return {
            **self._header(),
            "stats": {
                "files": len(self.files),
                "edges": len(edge_list),
                "languages": dict(sorted(languages.items())),
            },
            "files": [self._file_entry(p) for p in sorted(self.files)],
            "edges": edge_list,
            "external": dict(self.external.most_common()),
        }

    # ---- layers --------------------------------------------------------------------

    def layers(self) -> dict[str, Any]:
        by_component: dict[str, dict[str, Any]] = {}
        for path in sorted(self.files):
            placed = self.placements[path]
            comp = by_component.setdefault(
                placed.component,
                {
                    "id": placed.component,
                    "name": placed.name,
                    "layer": placed.layer,
                    "files": 0,
                    "languages": Counter(),
                },
            )
            comp["files"] += 1
            comp["languages"][self.files[path]] += 1

        layer_names = list(self.config.layer_order)
        for comp in by_component.values():
            if comp["layer"] not in layer_names:
                layer_names.append(comp["layer"])

        layers = []
        for name in layer_names:
            comps = sorted(
                (c for c in by_component.values() if c["layer"] == name),
                key=lambda c: (-c["files"], c["id"]),
            )
            if not comps:
                continue
            layers.append(
                {
                    "name": name,
                    "label": LAYER_LABELS.get(name, name.replace("_", " ").capitalize()),
                    "files": sum(c["files"] for c in comps),
                    "components": [{**c, "languages": dict(c["languages"])} for c in comps],
                }
            )

        dependencies: Counter[tuple[str, str]] = Counter()
        violations = []
        for importer in sorted(self.edges):
            src = self.placements[importer].layer
            for target in sorted(self.edges[importer]):
                dst = self.placements[target].layer
                if src != dst:
                    dependencies[(src, dst)] += 1
                if not is_allowed(self.config, src, dst):
                    violations.append(
                        {"from": importer, "to": target, "from_layer": src, "to_layer": dst}
                    )
        return {
            **self._header(),
            "layers": layers,
            "dependencies": [
                {"from": src, "to": dst, "imports": count}
                for (src, dst), count in sorted(dependencies.items())
            ],
            "rules": {
                layer: sorted(allowed) for layer, allowed in sorted(self.config.allowed.items())
            },
            "violations": violations,
        }

    # ---- impact --------------------------------------------------------------------

    def resolve_target(self, target: str) -> list[str]:
        """Files named by ``target``: a file or directory under the root, or a unique suffix."""
        raw = Path(target)
        if raw.is_absolute():
            try:
                target = raw.resolve().relative_to(self.root).as_posix()
            except ValueError as exc:
                raise TargetError(f"{target} is outside {self.root}") from exc
        rel = target.replace("\\", "/").strip("/").removeprefix("./")
        if rel in self.files:
            return [rel]
        under = sorted(p for p in self.files if p.startswith(f"{rel}/") or rel in ("", "."))
        if under:
            return under
        suffix = sorted(p for p in self.files if p.endswith(f"/{rel}"))
        if len(suffix) == 1:
            return suffix
        if len(suffix) > 1:
            raise TargetError(f"'{target}' is ambiguous: " + ", ".join(suffix[:10]))
        raise TargetError(f"'{target}' does not match any analysed file")

    def impact(self, target: str, max_depth: int | None = None) -> dict[str, Any]:
        changed = self.resolve_target(target)
        affected = walk_dependents(self._reverse, set(changed), max_depth)

        entries = []
        for item in affected:
            entry = self._file_entry(item.path)
            entry.update(depth=item.depth, via=item.via, chain=list(item.chain))
            entries.append(entry)

        direct = [e for e in entries if e["depth"] == 1]
        by_layer = Counter(e["layer"] for e in entries)
        components = Counter(e["component"] for e in entries)
        component_layer = {e["component"]: e["layer"] for e in entries}
        target_place = self.placements[changed[0]]
        return {
            **self._header(),
            "target": {
                "query": target,
                "path": changed[0] if len(changed) == 1 else None,
                "files": changed,
                "layer": target_place.layer,
                "component": target_place.component,
                "ref": self.ref(changed[0]) if len(changed) == 1 else None,
            },
            "max_depth": max_depth,
            "summary": {
                "direct": len(direct),
                "total": len(entries),
                "max_depth_reached": max((e["depth"] for e in entries), default=0),
                "tests": by_layer.get("tests", 0),
                "by_layer": dict(sorted(by_layer.items())),
                "components": [
                    {"id": comp, "layer": component_layer[comp], "files": count}
                    for comp, count in components.most_common()
                ],
            },
            "direct": [e["path"] for e in direct],
            "affected": entries,
        }


def analyze(root: Path | str, config: Config | None = None) -> Analysis:
    root = Path(root).resolve()
    if not root.is_dir():
        raise NotADirectoryError(str(root))
    if config is None:
        config = load_config(root)

    all_files = walk(root, config.exclude)
    files = source_files(all_files)
    python_files = [p for p, lang in files.items() if lang == "python"]
    ts_files = {p for p, lang in files.items() if lang == "typescript"}

    py = PythonResolver(python_files, config.python_roots)
    ts = TsResolver(root, ts_files, all_files, config.aliases)

    edges: dict[str, set[str]] = {}
    external: Counter[str] = Counter()
    for path, language in sorted(files.items()):
        try:
            source = read_source(root, path)
        except OSError:
            continue
        resolver: PythonResolver | TsResolver = py if language == "python" else ts
        found, missing = resolver.resolve(path, source)
        if found:
            edges[path] = found
        external.update(missing)

    placements = {path: place(path, config) for path in files}
    return Analysis(root, config, files, edges, external, placements, repository(root))

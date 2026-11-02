"""Resolve imports between TypeScript and JavaScript files.

Specifiers are found with regular expressions after comments are stripped, which covers
``import``/``export ... from``, side-effect imports, ``import()`` and ``require()``.
Relative specifiers, ``tsconfig.json`` ``paths``/``baseUrl``, configured aliases and
workspace package names (any ``package.json`` with a ``name``) resolve to files.
"""

from __future__ import annotations

import json
import re
from pathlib import Path, PurePosixPath
from typing import Any

_TOKENS = re.compile(
    r"""("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|//[^\n]*|/\*.*?\*/""",
    re.DOTALL,
)
_SPECIFIERS = (
    re.compile(r"""\b(?:import|export)\s+(?:type\s+)?[\w*{}\s,$]*?\s*from\s*['"]([^'"\n]+)['"]"""),
    re.compile(r"""\bimport\s*['"]([^'"\n]+)['"]"""),
    re.compile(r"""\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)"""),
    re.compile(r"""\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)"""),
)
_TRAILING_COMMA = re.compile(r",(\s*[}\]])")

EXTENSIONS = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs")
_JS_TO_TS = {".js": (".ts", ".tsx"), ".jsx": (".tsx",), ".mjs": (".mts",), ".cjs": (".cts",)}


def strip_comments(source: str) -> str:
    return _TOKENS.sub(lambda m: m.group(1) or " ", source)


def specifiers(source: str) -> list[str]:
    text = strip_comments(source)
    found: list[str] = []
    for pattern in _SPECIFIERS:
        found.extend(pattern.findall(text))
    return found


def _load_jsonc(path: Path) -> Any:
    try:
        text = strip_comments(path.read_text(encoding="utf-8"))
        return json.loads(_TRAILING_COMMA.sub(r"\1", text))
    except (OSError, ValueError):
        return None


def _join(*parts: str) -> str:
    """Normalise a posix path, collapsing ``.`` and ``..`` (never above the root)."""
    out: list[str] = []
    for part in "/".join(p for p in parts if p).split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if out:
                out.pop()
            continue
        out.append(part)
    return "/".join(out)


class TsResolver:
    def __init__(
        self,
        root: Path,
        sources: set[str],
        all_files: list[str],
        aliases: dict[str, str] | None = None,
    ) -> None:
        self.sources = sources
        self.aliases = sorted((aliases or {}).items(), key=lambda kv: -len(kv[0]))
        # tsconfig dir -> (baseUrl dir or None, [(pattern, [targets])])
        self.tsconfigs: dict[str, tuple[str | None, list[tuple[str, list[str]]]]] = {}
        self.packages: dict[str, tuple[str, list[str]]] = {}
        for path in all_files:
            name = PurePosixPath(path).name
            folder = str(PurePosixPath(path).parent)
            folder = "" if folder == "." else folder
            if name == "tsconfig.json":
                self._load_tsconfig(root, path, folder)
            elif name == "package.json":
                self._load_package(root, path, folder)

    def _load_tsconfig(self, root: Path, path: str, folder: str) -> None:
        data = _load_jsonc(root / path)
        options = data.get("compilerOptions") if isinstance(data, dict) else None
        if not isinstance(options, dict):
            return
        base_url = options.get("baseUrl")
        base = _join(folder, base_url) if isinstance(base_url, str) else None
        mapped = []
        paths = options.get("paths")
        if isinstance(paths, dict):
            for pattern, targets in paths.items():
                if isinstance(targets, list):
                    joined = [_join(base or folder, t) for t in targets if isinstance(t, str)]
                    mapped.append((pattern, joined))
        if base is not None or mapped:
            self.tsconfigs[folder] = (base, mapped)

    def _load_package(self, root: Path, path: str, folder: str) -> None:
        data = _load_jsonc(root / path)
        if not isinstance(data, dict) or not isinstance(data.get("name"), str):
            return
        entries: list[str] = []
        for key in ("source", "types", "module", "main"):
            if isinstance(data.get(key), str):
                entries.append(data[key])
        exports = data.get("exports")
        if isinstance(exports, dict):
            exports = exports.get(".", exports)
        if isinstance(exports, str):
            entries.append(exports)
        elif isinstance(exports, dict):
            for key in ("source", "types", "import", "default", "require"):
                if isinstance(exports.get(key), str):
                    entries.append(exports[key])
        entries += ["src/index", "index"]
        self.packages[data["name"]] = (folder, [_join(folder, e) for e in entries])

    def _candidates(self, base: str) -> list[str]:
        suffix = PurePosixPath(base).suffix
        found = [base]
        if suffix in _JS_TO_TS:
            stem = base[: -len(suffix)]
            found += [stem + ext for ext in _JS_TO_TS[suffix]]
        if base.endswith(".d.ts"):
            found.append(base[: -len(".d.ts")] + ".ts")
        found += [base + ext for ext in EXTENSIONS]
        found += [f"{base}/index{ext}" for ext in EXTENSIONS]
        return found

    def _file(self, base: str) -> str | None:
        for candidate in self._candidates(base):
            if candidate in self.sources:
                return candidate
        return None

    def _nearest_tsconfig(self, path: str) -> tuple[str | None, list[tuple[str, list[str]]]]:
        folder = PurePosixPath(path).parent
        while True:
            key = "" if str(folder) == "." else str(folder)
            if key in self.tsconfigs:
                return self.tsconfigs[key]
            if key == "":
                return None, []
            folder = folder.parent

    def resolve_one(self, importer: str, spec: str) -> str | None:
        spec = spec.split("?")[0]
        if spec.startswith("."):
            folder = str(PurePosixPath(importer).parent)
            return self._file(_join("" if folder == "." else folder, spec))

        for prefix, target in self.aliases:
            if spec.startswith(prefix):
                return self._file(_join(target, spec[len(prefix) :]))

        base, mapped = self._nearest_tsconfig(importer)
        for pattern, targets in mapped:
            if pattern.endswith("*") and spec.startswith(pattern[:-1]):
                rest = spec[len(pattern) - 1 :]
                for target in targets:
                    hit = self._file(target.replace("*", rest, 1))
                    if hit:
                        return hit
            elif pattern == spec:
                for target in targets:
                    hit = self._file(target)
                    if hit:
                        return hit
        if base is not None:
            hit = self._file(_join(base, spec))
            if hit:
                return hit

        parts = spec.split("/")
        name_len = 2 if spec.startswith("@") else 1
        package = self.packages.get("/".join(parts[:name_len]))
        if package is None:
            return None
        folder, entries = package
        sub = "/".join(parts[name_len:])
        if sub:
            return self._file(_join(folder, sub)) or self._file(_join(folder, "src", sub))
        for entry in entries:
            hit = self._file(entry)
            if hit:
                return hit
        return None

    def resolve(self, path: str, source: str) -> tuple[set[str], set[str]]:
        found: set[str] = set()
        external: set[str] = set()
        for spec in specifiers(source):
            hit = self.resolve_one(path, spec)
            if hit is None:
                if not spec.startswith("."):
                    parts = spec.split("/")
                    external.add("/".join(parts[: 2 if spec.startswith("@") else 1]))
            elif hit != path:
                found.add(hit)
        return found, external

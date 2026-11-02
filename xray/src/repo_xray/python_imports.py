"""Resolve imports between Python files.

Source roots are where top-level packages live: the parent of every outermost directory
holding an ``__init__.py``, plus the analysis root itself and any configured roots. Every
file gets a dotted module name under each root that contains it.
"""

from __future__ import annotations

import ast
from pathlib import Path, PurePosixPath


def source_roots(files: list[str], configured: tuple[str, ...]) -> list[str]:
    inits = {str(PurePosixPath(f).parent) for f in files if f.endswith("__init__.py")}
    roots = {"."} | {r.strip("/") or "." for r in configured}
    for package in inits:
        parent = str(PurePosixPath(package).parent)
        if parent not in inits:
            roots.add(parent)
    # Longest first, so a file's most specific name comes first.
    return sorted(roots, key=lambda r: (-len(r), r))


def module_names(path: str, roots: list[str]) -> list[str]:
    names = []
    pure = PurePosixPath(path)
    for root in roots:
        try:
            rel = pure.relative_to(root) if root != "." else pure
        except ValueError:
            continue
        parts = list(rel.with_suffix("").parts)
        if parts and parts[-1] == "__init__":
            parts.pop()
        if parts and all(p.isidentifier() for p in parts):
            names.append(".".join(parts))
    return names


class PythonResolver:
    def __init__(self, files: list[str], configured_roots: tuple[str, ...] = ()) -> None:
        self.roots = source_roots(files, configured_roots)
        self.modules: dict[str, str] = {}
        self.own_name: dict[str, str] = {}
        for path in files:
            names = module_names(path, self.roots)
            if not names:
                continue
            self.own_name[path] = names[0]
            for name in names:
                self.modules.setdefault(name, path)

    def _lookup(self, dotted: str) -> str | None:
        """The file for ``dotted``, or for its longest importable prefix."""
        parts = dotted.split(".")
        while parts:
            hit = self.modules.get(".".join(parts))
            if hit is not None:
                return hit
            parts.pop()
        return None

    def _package_of(self, path: str) -> list[str]:
        name = self.own_name.get(path)
        if name is None:
            return []
        parts = name.split(".") if name else []
        return parts if path.endswith("__init__.py") else parts[:-1]

    def resolve(self, path: str, source: str) -> tuple[set[str], set[str]]:
        """Files imported by ``path``, and the top-level names of unresolved imports."""
        try:
            tree = ast.parse(source, filename=path)
        except (SyntaxError, ValueError):
            return set(), set()
        found: set[str] = set()
        external: set[str] = set()

        def add(dotted: str) -> None:
            hit = self._lookup(dotted)
            if hit is None:
                external.add(dotted.split(".")[0])
            elif hit != path:
                found.add(hit)

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    add(alias.name)
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    package = self._package_of(path)
                    up = node.level - 1
                    if up > len(package):
                        continue
                    base = package[: len(package) - up] if up else package
                    prefix = ".".join([*base, node.module] if node.module else base)
                else:
                    prefix = node.module or ""
                for alias in node.names:
                    target = f"{prefix}.{alias.name}" if prefix else alias.name
                    if alias.name != "*" and target in self.modules:
                        if self.modules[target] != path:
                            found.add(self.modules[target])
                    elif prefix:
                        add(prefix)
            elif isinstance(node, ast.Call) and _is_dynamic_import(node):
                arg = node.args[0]
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    add(arg.value)
        return found, external


def _is_dynamic_import(node: ast.Call) -> bool:
    func = node.func
    name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
    return name in {"import_module", "__import__"} and bool(node.args)


def read_source(root: Path, path: str) -> str:
    return (root / path).read_text(encoding="utf-8", errors="replace")

"""Find the source files to analyse under a root."""

from __future__ import annotations

import os
from fnmatch import fnmatchcase
from pathlib import Path

PYTHON_SUFFIXES = (".py",)
TS_SUFFIXES = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs")


def language_of(path: str) -> str | None:
    if path.endswith(PYTHON_SUFFIXES):
        return "python"
    if path.endswith(".d.ts") or path.endswith(".min.js"):
        return None
    if path.endswith(TS_SUFFIXES):
        return "typescript"
    return None


def _excluded(rel_dir: str, name: str, exclude: tuple[str, ...]) -> bool:
    if name.startswith("."):
        return True
    rel = f"{rel_dir}/{name}" if rel_dir else name
    return any(fnmatchcase(name, pattern) or fnmatchcase(rel, pattern) for pattern in exclude)


def walk(root: Path, exclude: tuple[str, ...]) -> list[str]:
    """Every file under ``root`` (as a posix path relative to it), skipping excluded dirs."""
    found: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = Path(dirpath).relative_to(root).as_posix()
        rel_dir = "" if rel_dir == "." else rel_dir
        dirnames[:] = sorted(d for d in dirnames if not _excluded(rel_dir, d, exclude))
        for name in sorted(filenames):
            found.append(f"{rel_dir}/{name}" if rel_dir else name)
    return found


def source_files(all_files: list[str]) -> dict[str, str]:
    """Map each analysable file to its language."""
    sources: dict[str, str] = {}
    for path in all_files:
        language = language_of(path)
        if language is not None:
            sources[path] = language
    return sources

"""Reverse-dependency walk: which files can break when some files change."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class Affected:
    path: str
    depth: int  # 1 = imports a changed file directly
    via: str  # the file it imports on the shortest path towards the change
    chain: tuple[str, ...]  # path, ..., changed file


def reverse_edges(edges: dict[str, set[str]]) -> dict[str, set[str]]:
    reverse: dict[str, set[str]] = {}
    for importer, imported in edges.items():
        for target in imported:
            reverse.setdefault(target, set()).add(importer)
    return reverse


def walk_dependents(
    reverse: dict[str, set[str]], targets: set[str], max_depth: int | None = None
) -> list[Affected]:
    """Breadth-first over importers, so each file is reported at its shortest depth."""
    parent: dict[str, str] = {}
    depth = dict.fromkeys(targets, 0)
    queue = deque(sorted(targets))
    found: list[str] = []
    while queue:
        current = queue.popleft()
        if max_depth is not None and depth[current] >= max_depth:
            continue
        for importer in sorted(reverse.get(current, ())):
            if importer in depth:
                continue
            depth[importer] = depth[current] + 1
            parent[importer] = current
            found.append(importer)
            queue.append(importer)

    results = []
    for path in found:
        chain = [path]
        while chain[-1] in parent:
            chain.append(parent[chain[-1]])
        results.append(Affected(path, depth[path], parent[path], tuple(chain)))
    results.sort(key=lambda a: (a.depth, a.path))
    return results

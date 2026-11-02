"""Assign files to architecture layers and components by path convention."""

from __future__ import annotations

from dataclasses import dataclass
from fnmatch import fnmatchcase
from pathlib import PurePosixPath

from .config import OTHER, Config, LayerRule


@dataclass(frozen=True)
class Placement:
    layer: str
    component: str  # directory path that identifies the component, e.g. "python/omf/core/services"
    name: str  # short display name, e.g. "services"


def _match_dirs(rule: LayerRule, dirs: list[str]) -> tuple[int, int] | None:
    """Earliest (start, length) where a rule pattern matches consecutive directories."""
    best: tuple[int, int] | None = None
    for pattern in rule.match:
        segments = pattern.strip("/").split("/")
        for start in range(len(dirs) - len(segments) + 1):
            window = dirs[start : start + len(segments)]
            if all(fnmatchcase(d, s) for d, s in zip(window, segments, strict=True)):
                if best is None or start < best[0]:
                    best = (start, len(segments))
                break
    return best


def _placement(rule: LayerRule, dirs: list[str], name: str) -> Placement | None:
    hit = _match_dirs(rule, dirs)
    if hit is not None:
        start, length = hit
        end = start + length
        return Placement(rule.layer, "/".join(dirs[:end]), "/".join(dirs[start:end]))
    if any(fnmatchcase(name, pattern) for pattern in rule.files):
        component = "/".join(dirs) or "."
        return Placement(rule.layer, component, dirs[-1] if dirs else ".")
    return None


def place(path: str, config: Config) -> Placement:
    """Custom rules win in order; then tests; then the default rule matching outermost."""
    pure = PurePosixPath(path)
    dirs = list(pure.parts[:-1])
    for rule in config.custom_rules:
        placed = _placement(rule, dirs, pure.name)
        if placed is not None:
            return placed
    if config.test_rule is not None:
        placed = _placement(config.test_rule, dirs, pure.name)
        if placed is not None:
            return placed
    best: tuple[int, Placement] | None = None
    for rule in config.default_rules:
        hit = _match_dirs(rule, dirs)
        if hit is not None and (best is None or hit[0] < best[0]):
            placed = _placement(rule, dirs, pure.name)
            assert placed is not None
            best = (hit[0], placed)
    if best is not None:
        return best[1]
    return Placement(OTHER, "/".join(dirs) or ".", dirs[-1] if dirs else ".")


def is_allowed(config: Config, from_layer: str, to_layer: str) -> bool:
    if OTHER in (from_layer, to_layer):
        return True
    allowed = config.allowed.get(from_layer)
    return allowed is None or to_layer in allowed

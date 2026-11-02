"""Analysis settings: what to skip, how to resolve imports and how paths map to layers.

Defaults follow common conventions (``core/``, ``adapters/``, ``bootstrap/``, ``apps/``...).
A repository can override them with an ``xray.toml`` at its root::

    exclude = ["legacy"]
    python_roots = ["python", "apps/api"]
    replace_default_layers = false

    [[layers]]
    layer = "core"
    match = ["engine/*"]

    [aliases]
    "@/" = "web/src/"

    [allowed_dependencies]
    core = ["core"]

Custom layer rules are tried before the defaults (or instead of them with
``replace_default_layers = true``).
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

CONFIG_FILE = "xray.toml"

# Directory names never analysed. Any directory whose name starts with "." is skipped too.
DEFAULT_EXCLUDE = (
    "node_modules",
    "__pycache__",
    "site-packages",
    "venv",
    "dist",
    "build",
    "out",
    "coverage",
    "htmlcov",
)

PRESENTATION = "presentation"
CORE = "core"
ADAPTERS = "adapters"
COMPOSITION = "composition"
TESTS = "tests"
OTHER = "other"

LAYER_LABELS = {
    PRESENTATION: "Presentation",
    CORE: "Application core",
    ADAPTERS: "Adapters",
    COMPOSITION: "Composition root",
    TESTS: "Tests",
    OTHER: "Other",
}

DEFAULT_LAYER_ORDER = (PRESENTATION, CORE, ADAPTERS, COMPOSITION, TESTS, OTHER)


@dataclass(frozen=True)
class LayerRule:
    """Assigns ``layer`` to files under a directory matching one of ``match``.

    A pattern is one or more ``/``-separated directory segments, each an ``fnmatch`` glob,
    matched against consecutive directories of a file's path (``core/*`` matches
    ``python/omf/core/services/routing.py``). The matched directories name the component.
    ``files`` are globs on the file name, for rules such as ``test_*.py``.
    """

    layer: str
    match: tuple[str, ...] = ()
    files: tuple[str, ...] = ()


TEST_RULE = LayerRule(
    TESTS,
    match=("tests", "test", "__tests__", "e2e"),
    files=("test_*.py", "*_test.py", "conftest.py", "*.test.*", "*.spec.*"),
)

DEFAULT_LAYER_RULES = (
    LayerRule(COMPOSITION, match=("bootstrap", "composition", "composition_root", "wiring", "di")),
    LayerRule(
        ADAPTERS,
        match=(
            "adapters/*",
            "adapters",
            "infrastructure/*",
            "infrastructure",
            "infra",
            "integrations/*",
            "integrations",
            "persistence",
            "repositories",
            "gateways",
        ),
    ),
    LayerRule(
        CORE,
        match=(
            "core/*",
            "core",
            "domain",
            "application",
            "services",
            "ports",
            "usecases",
            "use_cases",
            "entities",
            "security",
        ),
    ),
    LayerRule(
        PRESENTATION,
        match=(
            "apps/*",
            "packages/*",
            "api",
            "web",
            "ui",
            "cli",
            "routes",
            "controllers",
            "views",
            "pages",
            "components",
            "frontend",
        ),
    ),
)

# Which layers each layer may import. Edges to or from "other" are never violations.
DEFAULT_ALLOWED = {
    PRESENTATION: frozenset({PRESENTATION, CORE, COMPOSITION}),
    CORE: frozenset({CORE}),
    ADAPTERS: frozenset({ADAPTERS, CORE}),
    COMPOSITION: frozenset(DEFAULT_LAYER_ORDER),
    TESTS: frozenset(DEFAULT_LAYER_ORDER),
}


class ConfigError(ValueError):
    """The configuration file is not valid."""


@dataclass(frozen=True)
class Config:
    exclude: tuple[str, ...] = DEFAULT_EXCLUDE
    custom_rules: tuple[LayerRule, ...] = ()
    default_rules: tuple[LayerRule, ...] = DEFAULT_LAYER_RULES
    test_rule: LayerRule | None = TEST_RULE
    layer_order: tuple[str, ...] = DEFAULT_LAYER_ORDER
    allowed: dict[str, frozenset[str]] = field(default_factory=lambda: dict(DEFAULT_ALLOWED))
    python_roots: tuple[str, ...] = ()
    aliases: dict[str, str] = field(default_factory=dict)
    source: str | None = None


def _strings(value: Any, where: str) -> tuple[str, ...]:
    if isinstance(value, str):
        return (value,)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ConfigError(f"{where}: expected a string or a list of strings")
    return tuple(value)


def load_config(root: Path, path: Path | None = None) -> Config:
    """Load ``path``, or ``<root>/xray.toml`` when present, else the defaults."""
    if path is None:
        candidate = root / CONFIG_FILE
        if not candidate.is_file():
            return Config()
        path = candidate
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ConfigError(f"{path}: {exc}") from exc
    return config_from_dict(data, source=str(path))


def config_from_dict(data: dict[str, Any], source: str | None = None) -> Config:
    base = Config()
    exclude = base.exclude + _strings(data.get("exclude", []), "exclude")

    rules = []
    for index, raw in enumerate(data.get("layers", [])):
        where = f"layers[{index}]"
        if not isinstance(raw, dict) or not isinstance(raw.get("layer"), str):
            raise ConfigError(f"{where}: expected a table with a 'layer' string")
        rule = LayerRule(
            raw["layer"],
            match=_strings(raw.get("match", []), f"{where}.match"),
            files=_strings(raw.get("files", []), f"{where}.files"),
        )
        if not rule.match and not rule.files:
            raise ConfigError(f"{where}: needs 'match' or 'files'")
        rules.append(rule)

    replace = data.get("replace_default_layers", False)
    if not isinstance(replace, bool):
        raise ConfigError("replace_default_layers: expected true or false")

    layer_order = list(base.layer_order)
    for rule in rules:
        if rule.layer not in layer_order:
            layer_order.insert(layer_order.index(TESTS), rule.layer)

    allowed = dict(base.allowed)
    raw_allowed = data.get("allowed_dependencies", {})
    if not isinstance(raw_allowed, dict):
        raise ConfigError("allowed_dependencies: expected a table")
    for layer, targets in raw_allowed.items():
        allowed[layer] = frozenset(_strings(targets, f"allowed_dependencies.{layer}"))

    aliases = data.get("aliases", {})
    if not isinstance(aliases, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in aliases.items()
    ):
        raise ConfigError("aliases: expected a table of strings")

    return Config(
        exclude=exclude,
        custom_rules=tuple(rules),
        default_rules=() if replace else base.default_rules,
        test_rule=None if replace else base.test_rule,
        layer_order=tuple(layer_order),
        allowed=allowed,
        python_roots=_strings(data.get("python_roots", []), "python_roots"),
        aliases=dict(aliases),
        source=source,
    )

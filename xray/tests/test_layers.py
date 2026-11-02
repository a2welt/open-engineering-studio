from __future__ import annotations

from pathlib import Path

import pytest

from conftest import HEX_SERVICE, Tree
from repo_xray import analyze, load_config
from repo_xray.config import Config, ConfigError, config_from_dict
from repo_xray.layers import place


@pytest.mark.parametrize(
    ("path", "layer", "component"),
    [
        ("python/omf/core/services/routing.py", "core", "python/omf/core/services"),
        ("python/omf/adapters/inference/openai.py", "adapters", "python/omf/adapters/inference"),
        ("python/omf/bootstrap/container.py", "composition", "python/omf/bootstrap"),
        ("apps/api/omf_api/routers/chat.py", "presentation", "apps/api"),
        ("packages/sdk-typescript/src/core/client.ts", "presentation", "packages/sdk-typescript"),
        ("tests/unit/test_routing.py", "tests", "tests"),
        ("apps/web/src/pages/Home.test.tsx", "tests", "apps/web/src/pages"),
        ("scripts/release.py", "other", "scripts"),
        ("setup.py", "other", "."),
    ],
)
def test_default_conventions(path: str, layer: str, component: str) -> None:
    placed = place(path, Config())
    assert (placed.layer, placed.component) == (layer, component)


def test_outermost_match_wins() -> None:
    # "adapters" is outside "services", so the file is an adapter.
    placed = place("pkg/adapters/db/services/repo.py", Config())
    assert placed.layer == "adapters"
    assert placed.name == "adapters/db"


def test_layers_report_components_dependencies_and_violations(make_tree: Tree) -> None:
    files = dict(HEX_SERVICE)
    # The core must not import an adapter.
    files["src/shop/core/services/refunds.py"] = "from shop.adapters.stripe import client\n"
    report = analyze(make_tree(files)).layers()

    names = [layer["name"] for layer in report["layers"]]
    # Package roots such as src/shop/__init__.py fall outside every convention.
    assert names == ["presentation", "core", "adapters", "composition", "tests", "other"]
    core = next(layer for layer in report["layers"] if layer["name"] == "core")
    assert {c["name"] for c in core["components"]} >= {"core/services", "core/domain"}

    deps = {(d["from"], d["to"]) for d in report["dependencies"]}
    assert ("adapters", "core") in deps
    assert ("presentation", "composition") in deps

    assert report["violations"] == [
        {
            "from": "src/shop/core/services/refunds.py",
            "to": "src/shop/adapters/stripe/client.py",
            "from_layer": "core",
            "to_layer": "adapters",
        }
    ]


def test_config_file_overrides(make_tree: Tree) -> None:
    root = make_tree(
        {
            "xray.toml": (
                'exclude = ["legacy"]\n'
                '[[layers]]\nlayer = "engine"\nmatch = ["engine/*"]\n'
                "[allowed_dependencies]\nengine = []\n"
            ),
            "engine/solver/run.py": "from lib import util\n",
            "lib/__init__.py": "",
            "lib/util.py": "",
            "legacy/old.py": "",
        }
    )
    config = load_config(root)
    assert config.source == str(root / "xray.toml")
    analysis = analyze(root)
    assert "legacy/old.py" not in analysis.files
    assert analysis.placements["engine/solver/run.py"].layer == "engine"
    # "lib" is in the "other" layer, which never counts as a violation.
    assert analysis.layers()["violations"] == []
    assert "engine" in config.layer_order


def test_replace_default_layers() -> None:
    config = config_from_dict(
        {"replace_default_layers": True, "layers": [{"layer": "ui", "match": "web"}]}
    )
    assert place("web/a.ts", config).layer == "ui"
    assert place("tests/test_a.py", config).layer == "other"


@pytest.mark.parametrize(
    "data",
    [
        {"layers": [{"match": ["x"]}]},
        {"layers": [{"layer": "x"}]},
        {"exclude": [1]},
        {"replace_default_layers": "yes"},
        {"aliases": {"a": 1}},
    ],
)
def test_invalid_config(data: dict[str, object]) -> None:
    with pytest.raises(ConfigError):
        config_from_dict(data)


def test_unreadable_config(tmp_path: Path) -> None:
    bad = tmp_path / "xray.toml"
    bad.write_text("not = [valid", encoding="utf-8")
    with pytest.raises(ConfigError):
        load_config(tmp_path)

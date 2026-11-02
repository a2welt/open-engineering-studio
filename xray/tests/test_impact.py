from __future__ import annotations

import pytest

from conftest import HEX_SERVICE, Tree
from repo_xray import analyze
from repo_xray.analysis import TargetError
from repo_xray.impact import walk_dependents


def test_walk_reports_shortest_depth_and_chain() -> None:
    #   a -> b -> c, a -> c, d -> a, and a cycle b <-> e
    reverse = {"c": {"a", "b"}, "b": {"a", "e"}, "a": {"d"}, "e": {"b"}}
    affected = {a.path: a for a in walk_dependents(reverse, {"c"})}
    assert affected["a"].depth == 1
    assert affected["b"].depth == 1
    assert affected["d"].depth == 2
    assert affected["d"].chain == ("d", "a", "c")
    assert affected["e"].via == "b"
    assert "c" not in affected


def test_walk_respects_max_depth() -> None:
    reverse = {"c": {"b"}, "b": {"a"}}
    assert [a.path for a in walk_dependents(reverse, {"c"}, max_depth=1)] == ["b"]


def test_impact_of_a_core_service(make_tree: Tree) -> None:
    report = analyze(make_tree(HEX_SERVICE)).impact("src/shop/core/services/pricing.py")

    assert report["target"]["layer"] == "core"
    assert report["target"]["files"] == ["src/shop/core/services/pricing.py"]
    assert report["direct"] == [
        "apps/api/shop_api/app.py",
        "src/shop/core/services/checkout.py",
    ]
    by_path = {e["path"]: e for e in report["affected"]}
    assert by_path["src/shop/bootstrap/container.py"]["depth"] == 2
    assert by_path["tests/test_checkout.py"]["chain"] == [
        "tests/test_checkout.py",
        "src/shop/core/services/checkout.py",
        "src/shop/core/services/pricing.py",
    ]
    assert report["summary"]["tests"] == 1
    assert report["summary"]["by_layer"]["composition"] == 1


def test_impact_of_a_directory_excludes_files_inside_it(make_tree: Tree) -> None:
    report = analyze(make_tree(HEX_SERVICE)).impact("src/shop/core/domain")
    assert report["target"]["path"] is None
    assert "src/shop/core/domain/models.py" in report["target"]["files"]
    assert not any(e["path"].startswith("src/shop/core/domain/") for e in report["affected"])
    assert "src/shop/core/ports/payments.py" in report["direct"]


def test_impact_target_by_unique_suffix(make_tree: Tree) -> None:
    analysis = analyze(make_tree(HEX_SERVICE))
    assert analysis.resolve_target("services/checkout.py") == ["src/shop/core/services/checkout.py"]
    with pytest.raises(TargetError, match="ambiguous"):
        analysis.resolve_target("__init__.py")
    with pytest.raises(TargetError, match="does not match"):
        analysis.resolve_target("nope.py")


def test_absolute_target_outside_root_is_rejected(make_tree: Tree) -> None:
    root = make_tree(HEX_SERVICE)
    analysis = analyze(root)
    with pytest.raises(TargetError, match="outside"):
        analysis.resolve_target(str(root.parent))
    assert analysis.resolve_target(str(root / "src/shop/core/domain/models.py")) == [
        "src/shop/core/domain/models.py"
    ]

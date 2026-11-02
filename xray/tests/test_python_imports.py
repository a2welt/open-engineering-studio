from __future__ import annotations

from conftest import HEX_SERVICE, Tree
from repo_xray import analyze
from repo_xray.python_imports import PythonResolver, module_names, source_roots


def test_source_roots_are_parents_of_outermost_packages() -> None:
    files = ["src/shop/__init__.py", "src/shop/core/__init__.py", "apps/api/x/__init__.py"]
    assert source_roots(files, ()) == ["apps/api", "src", "."]


def test_module_names_drop_init_and_skip_non_identifiers() -> None:
    roots = ["src", "."]
    assert module_names("src/shop/core/__init__.py", roots) == ["shop.core", "src.shop.core"]
    assert module_names("my-scripts/run.py", roots) == []


def test_absolute_relative_star_and_dynamic_imports(make_tree: Tree) -> None:
    analysis = analyze(make_tree(HEX_SERVICE))
    edges = analysis.edges

    # "from shop.core.ports.payments import Order" -> the module, not a submodule "Order".
    assert "src/shop/core/ports/payments.py" in edges["src/shop/core/services/checkout.py"]
    # "from . import pricing" and "from .pricing import *".
    assert "src/shop/core/services/pricing.py" in edges["src/shop/core/services/checkout.py"]
    # "from ..domain import models" resolves the submodule.
    assert edges["src/shop/core/services/pricing.py"] == {"src/shop/core/domain/models.py"}
    # importlib.import_module with a constant string.
    assert "src/shop/core/services/pricing.py" in edges["apps/api/shop_api/app.py"]
    # "from shop.core.services import checkout" from a test outside any package.
    assert edges["tests/test_checkout.py"] == {"src/shop/core/services/checkout.py"}


def test_excluded_and_hidden_directories_are_skipped(make_tree: Tree) -> None:
    analysis = analyze(make_tree(HEX_SERVICE))
    assert not any(p.startswith((".venv/", "node_modules/")) for p in analysis.files)


def test_unresolved_imports_count_as_external(make_tree: Tree) -> None:
    analysis = analyze(make_tree(HEX_SERVICE))
    assert analysis.external["httpx"] == 1
    assert analysis.external["importlib"] == 1


def test_syntax_errors_do_not_stop_the_analysis() -> None:
    resolver = PythonResolver(["a.py"])
    assert resolver.resolve("a.py", "def broken(:\n") == (set(), set())


def test_relative_import_above_top_level_is_ignored() -> None:
    resolver = PythonResolver(["pkg/__init__.py", "pkg/mod.py"])
    found, external = resolver.resolve("pkg/mod.py", "from ... import nothing\n")
    assert found == set()
    assert external == set()

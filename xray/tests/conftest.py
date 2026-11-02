from __future__ import annotations

import os
import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest

Tree = Callable[[dict[str, str]], Path]


def git(root: Path, *args: str) -> str:
    """Run git in ``root`` with a fixed identity and dates, ignoring user and system config."""
    env = {
        **os.environ,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_AUTHOR_NAME": "Test",
        "GIT_AUTHOR_EMAIL": "test@example.invalid",
        "GIT_COMMITTER_NAME": "Test",
        "GIT_COMMITTER_EMAIL": "test@example.invalid",
        "GIT_AUTHOR_DATE": "2026-01-01T00:00:00Z",
        "GIT_COMMITTER_DATE": "2026-01-01T00:00:00Z",
    }
    git_bin = shutil.which("git")
    assert git_bin is not None
    done = subprocess.run(
        [git_bin, "-C", str(root), *args], capture_output=True, text=True, env=env, check=True
    )
    return done.stdout.strip()


def write_files(root: Path, files: dict[str, str | None]) -> None:
    """Write (or, for ``None``, delete) files under ``root``."""
    for rel, content in files.items():
        path = root / rel
        if content is None:
            path.unlink()
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def commit_all(root: Path, message: str) -> str:
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", message)
    return git(root, "rev-parse", "HEAD")


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    """An empty git repository whose ``origin`` is an https GitHub URL."""
    root = tmp_path / "gitrepo"
    root.mkdir()
    git(root, "init", "-q", "-b", "main")
    git(root, "remote", "add", "origin", "https://github.com/acme/shop.git")
    return root


@pytest.fixture
def make_tree(tmp_path: Path) -> Tree:
    """Write ``{relative path: content}`` under a fresh directory and return it."""

    def build(files: dict[str, str]) -> Path:
        root = tmp_path / "repo"
        for rel, content in files.items():
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        return root

    return build


# A small hexagonal Python service: presentation -> core <- adapters, wired in bootstrap.
HEX_SERVICE = {
    "src/shop/__init__.py": "",
    "src/shop/core/__init__.py": "",
    "src/shop/core/domain/__init__.py": "",
    "src/shop/core/domain/models.py": "class Order: ...\n",
    "src/shop/core/ports/__init__.py": "",
    "src/shop/core/ports/payments.py": "from shop.core.domain.models import Order\n",
    "src/shop/core/services/__init__.py": "",
    "src/shop/core/services/pricing.py": "from ..domain import models\n",
    "src/shop/core/services/checkout.py": (
        "from shop.core.ports.payments import Order\n"
        "from . import pricing\n"
        "from .pricing import *\n"
    ),
    "src/shop/adapters/__init__.py": "",
    "src/shop/adapters/stripe/__init__.py": "",
    "src/shop/adapters/stripe/client.py": ("import httpx\nfrom shop.core.ports import payments\n"),
    "src/shop/bootstrap/__init__.py": "",
    "src/shop/bootstrap/container.py": (
        "from shop.adapters.stripe.client import *\nfrom shop.core.services.checkout import *\n"
    ),
    "apps/api/shop_api/__init__.py": "",
    "apps/api/shop_api/app.py": (
        "import importlib\n"
        "from shop.bootstrap.container import *\n"
        "plugin = importlib.import_module('shop.core.services.pricing')\n"
    ),
    "tests/test_checkout.py": "from shop.core.services import checkout\n",
    ".venv/lib/shop_shadow.py": "import shop.core.services.checkout\n",
    "node_modules/pkg/index.py": "import shop\n",
}

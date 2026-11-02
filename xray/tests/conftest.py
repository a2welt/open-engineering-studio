from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

Tree = Callable[[dict[str, str]], Path]


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

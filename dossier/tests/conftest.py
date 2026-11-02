from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from repo_xray import digest

REPO_URL = "https://github.com/acme/shop"
PR = "github:pr:acme/shop#7"
OAT_TOKEN = "oat-test-token"
RECALL_TOKEN = "recall-test-token"


def git(root: Path, *args: str) -> str:
    """Run git in ``root`` with a fixed identity and dates, ignoring user and system config."""
    env = {
        **os.environ,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_AUTHOR_NAME": "Dana Dev",
        "GIT_AUTHOR_EMAIL": "dana@example.invalid",
        "GIT_COMMITTER_NAME": "Dana Dev",
        "GIT_COMMITTER_EMAIL": "dana@example.invalid",
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


SHOP = {
    "src/shop/__init__.py": "",
    "src/shop/core/__init__.py": "",
    "src/shop/core/domain/__init__.py": "",
    "src/shop/core/domain/models.py": "class Order: ...\n",
    "src/shop/core/services/__init__.py": "",
    "src/shop/core/services/checkout.py": "from shop.core.domain.models import Order\n",
    "apps/api/shop_api/__init__.py": "",
    "apps/api/shop_api/app.py": "from shop.core.services import checkout\n",
    "tests/test_checkout.py": "from shop.core.services import checkout\n",
    "README.md": "shop\n",
}


@dataclass
class Change:
    root: Path
    base: str
    head: str


@pytest.fixture
def change(tmp_path: Path) -> Change:
    """A repository whose change edits the domain model and its test, and the README."""
    root = tmp_path / "shop"
    root.mkdir()
    git(root, "init", "-q", "-b", "main")
    git(root, "remote", "add", "origin", f"{REPO_URL}.git")
    write_files(root, SHOP)
    base = commit_all(root, "base")
    write_files(
        root,
        {
            "src/shop/core/domain/models.py": "class Order:\n    total = 0\n",
            "tests/test_models.py": "from shop.core.domain.models import Order\n",
            "README.md": "shop, now with totals\n",
        },
    )
    head = commit_all(root, "add order totals")
    return Change(root, base, head)


def receipt(
    number: int,
    action: str,
    resource: str,
    references: list[str],
    status: str = "succeeded",
    approval: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A receipt-shaped document; the fake gateway decides whether it verifies."""
    return {
        "type": "agentproof.receipt/v0.1",
        "id": f"rcp_{number:024x}",
        "request": {
            "type": "agentproof.request/v0.1",
            "action": action,
            "resource": resource,
            "arguments": {"path": resource, "references": references},
        },
        "outcome": {"status": status},
        "approval": approval,
    }


APPROVAL = {
    "type": "agentproof.approval/v0.1",
    "id": "apr_1",
    "approver": "ed25519:approver",
    "decision": "approved",
}


@dataclass
class FakeOat:
    receipts: list[dict[str, Any]] = field(default_factory=list)
    bad: set[str] = field(default_factory=set)  # receipt ids that fail verification
    wrong_ref: set[str] = field(default_factory=set)  # receipt ids served with a wrong ref
    page_size: int = 2
    queries: list[dict[str, str]] = field(default_factory=list)
    url: str = ""


@dataclass
class FakeRecall:
    links: dict[str, list[str]] = field(default_factory=dict)  # reference -> memory ids
    queries: list[str] = field(default_factory=list)
    url: str = ""


def _handler(token: str, route: Any) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            pass

        def _reply(self, status: int, body: Any) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _handle(self, method: str) -> None:
            if self.headers.get("Authorization") != f"Bearer {token}":
                self._reply(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length)) if length else None
            url = urlsplit(self.path)
            query = {k: v[-1] for k, v in parse_qs(url.query).items()}
            status, reply = route(method, url.path, query, body)
            self._reply(status, reply)

        def do_GET(self) -> None:
            self._handle("GET")

        def do_POST(self) -> None:
            self._handle("POST")

    return Handler


def _serve(handler: type[BaseHTTPRequestHandler]) -> Iterator[str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture
def oat() -> Iterator[FakeOat]:
    """``oat serve``: GET /v1/receipts?reference&limit&offset and POST /v1/verify."""
    fake = FakeOat()

    def route(method: str, path: str, query: dict[str, str], body: Any) -> tuple[int, Any]:
        if (method, path) == ("GET", "/v1/receipts"):
            fake.queries.append(query)
            ref = query.get("reference")
            matching = [r for r in fake.receipts if ref in r["request"]["arguments"]["references"]]
            offset = int(query.get("offset", 0))
            limit = min(int(query.get("limit", 50)), fake.page_size)
            page = matching[offset : offset + limit]
            return 200, {
                "total": len(matching),
                "receipts": [
                    {
                        "ref": "agentproof:sha256:"
                        + ("0" * 64 if r["id"] in fake.wrong_ref else digest(r).split(":")[1]),
                        "receipt": r,
                    }
                    for r in page
                ],
            }
        if (method, path) == ("POST", "/v1/verify"):
            ok = body["receipt"]["id"] not in fake.bad
            return 200, {"ok": ok, "checks": []}
        return 404, {"error": "no route"}

    for url in _serve(_handler(OAT_TOKEN, route)):
        fake.url = url
        yield fake


@pytest.fixture
def recall() -> Iterator[FakeRecall]:
    """Recall: GET /api/links?reference=<uri>."""
    fake = FakeRecall()

    def route(method: str, path: str, query: dict[str, str], body: Any) -> tuple[int, Any]:
        if (method, path) != ("GET", "/api/links"):
            return 404, {"error": "no route"}
        ref = query["reference"]
        fake.queries.append(ref)
        links = [
            {"memory_id": memory, "reference": ref, "relation": "constrains"}
            for memory in fake.links.get(ref, [])
        ]
        return 200, {"reference": ref, "match": "exact", "links": links}

    for url in _serve(_handler(RECALL_TOKEN, route)):
        fake.url = url
        yield fake

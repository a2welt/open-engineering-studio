from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from conftest import HEX_SERVICE, Tree
from repo_xray.cli import main
from repo_xray.gitinfo import Repository, normalise_remote
from repo_xray.server import make_server


def run_cli(capsys: pytest.CaptureFixture[str], *argv: str) -> tuple[int, Any, str]:
    code = main(list(argv))
    out, err = capsys.readouterr()
    return code, json.loads(out) if out.strip() else None, err


def test_cli_commands_emit_json(make_tree: Tree, capsys: pytest.CaptureFixture[str]) -> None:
    root = str(make_tree(HEX_SERVICE))

    code, graph, _ = run_cli(capsys, "graph", "--root", root, "--compact")
    assert code == 0
    assert graph["schema"] == "xray/v0"
    assert graph["stats"]["languages"] == {"python": len(graph["files"])}

    code, layers, _ = run_cli(capsys, "layers", "--root", root)
    assert code == 0
    assert layers["layers"][0]["name"] == "presentation"

    code, impact, _ = run_cli(
        capsys, "impact", "src/shop/core/domain/models.py", "--root", root, "--max-depth", "1"
    )
    assert code == 0
    assert impact["max_depth"] == 1
    assert {e["depth"] for e in impact["affected"]} == {1}


def test_cli_reports_bad_target(make_tree: Tree, capsys: pytest.CaptureFixture[str]) -> None:
    code, out, err = run_cli(capsys, "impact", "missing.py", "--root", str(make_tree(HEX_SERVICE)))
    assert code == 2
    assert out is None
    assert "does not match" in err


@pytest.fixture
def server(make_tree: Tree) -> Iterator[str]:
    srv = make_server(make_tree(HEX_SERVICE), port=0)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    host, port = srv.server_address[:2]
    try:
        yield f"http://{host!s}:{port}"
    finally:
        srv.shutdown()
        srv.server_close()


def fetch(url: str, origin: str | None = None) -> tuple[int, dict[str, Any], dict[str, str]]:
    request = urllib.request.Request(url, headers={"Origin": origin} if origin else {})
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read()), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read()), dict(exc.headers)


def test_http_endpoints(server: str) -> None:
    status, body, _ = fetch(f"{server}/health")
    assert (status, body["ok"]) == (200, True)

    status, body, _ = fetch(f"{server}/layers")
    assert status == 200
    assert body["violations"] == []

    status, body, _ = fetch(f"{server}/graph?refresh=1")
    assert status == 200
    assert body["stats"]["edges"] > 0

    status, body, _ = fetch(f"{server}/impact?path=services/pricing.py&max_depth=2")
    assert status == 200
    assert body["target"]["path"] == "src/shop/core/services/pricing.py"


@pytest.mark.parametrize(
    ("query", "status"),
    [
        ("/impact", 400),
        ("/impact?path=nope.py", 404),
        ("/impact?path=services/pricing.py&max_depth=0", 400),
        ("/impact?path=services/pricing.py&max_depth=x", 400),
        ("/nothing", 404),
    ],
)
def test_http_errors(server: str, query: str, status: int) -> None:
    got, body, _ = fetch(server + query)
    assert got == status
    assert "error" in body


def test_cors_only_for_loopback_origins(server: str) -> None:
    _, _, headers = fetch(f"{server}/health", origin="http://localhost:5173")
    assert headers.get("Access-Control-Allow-Origin") == "http://localhost:5173"
    _, _, headers = fetch(f"{server}/health", origin="https://evil.example")
    assert "Access-Control-Allow-Origin" not in headers


@pytest.mark.parametrize(
    ("remote", "expected"),
    [
        (
            "git@github.com:findajay/Open-model-fabric.git",
            "https://github.com/findajay/Open-model-fabric",
        ),
        ("https://github.com/findajay/repo.git", "https://github.com/findajay/repo"),
        ("https://user:ghp_secret@github.com/findajay/repo", "https://github.com/findajay/repo"),
        ("ssh://git@github.com/findajay/repo.git", "https://github.com/findajay/repo"),
    ],
)
def test_normalise_remote_drops_credentials(remote: str, expected: str) -> None:
    assert normalise_remote(remote) == expected


def test_code_reference_uri() -> None:
    repo = Repository(url="https://github.com/o/r", commit="abc123", prefix="sub")
    assert repo.ref("a/b.py") == "git+https://github.com/o/r@abc123#sub/a/b.py"
    assert Repository(url=None, commit="abc", prefix="").ref("a.py") is None


def test_outside_git_there_is_no_repository(tmp_path: Path) -> None:
    from repo_xray.gitinfo import repository

    assert repository(tmp_path) is None

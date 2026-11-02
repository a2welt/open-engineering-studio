from __future__ import annotations

import json
import shutil
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from conftest import HEX_SERVICE, commit_all, git, write_files
from repo_xray.canonical import CanonicalizationError, canonical_bytes, digest
from repo_xray.change import ChangeError, change_impact, verify_digest
from repo_xray.cli import main
from repo_xray.server import make_server

URL = "https://github.com/acme/shop"
Change = tuple[Path, str, str]


@pytest.fixture
def change(git_repo: Path) -> Change:
    """HEX_SERVICE, then a change that edits the domain model, renames, adds and deletes."""
    write_files(git_repo, {**HEX_SERVICE, "README.md": "shop\n", "docs/old.md": "old\n"})
    base = commit_all(git_repo, "base")
    write_files(
        git_repo,
        {
            "src/shop/core/domain/models.py": "class Order:\n    total = 0\n",
            "tests/test_models.py": "from shop.core.domain.models import Order\n",
            "docs/old.md": None,
            "docs/new.md": "old\n",
            "README.md": None,
        },
    )
    head = commit_all(git_repo, "change")
    return git_repo, base, head


def test_change_lists_files_dependents_layers_and_refs(change: Change) -> None:
    root, base, head = change
    report = change_impact(root, base, head)

    assert report["kind"] == "change"
    assert (report["base"], report["head"]) == (base, head)
    assert report["repository"] == {"url": URL, "path": None}
    changed = {c["path"]: c for c in report["changed"]}
    assert {p: c["status"] for p, c in changed.items()} == {
        "README.md": "deleted",
        "docs/new.md": "renamed",
        "src/shop/core/domain/models.py": "modified",
        "tests/test_models.py": "added",
    }
    assert list(changed) == sorted(changed)
    assert changed["docs/new.md"]["old_path"] == "docs/old.md"
    assert changed["README.md"]["ref"] == f"git+{URL}@{base}#README.md"
    assert changed["tests/test_models.py"]["layer"] == "tests"
    model = changed["src/shop/core/domain/models.py"]
    assert (model["layer"], model["ref"]) == ("core", f"git+{URL}@{head}#{model['path']}")

    dependents = {d["path"]: d for d in report["dependents"]}
    assert dependents["src/shop/core/ports/payments.py"]["depth"] == 1
    assert dependents["apps/api/shop_api/app.py"]["layer"] == "presentation"
    assert "tests/test_models.py" not in dependents  # changed, so not a dependent
    assert report["summary"]["dependents"] == len(dependents)
    assert {"core", "tests", "presentation", "adapters"} <= set(report["layers"])
    assert report["layers"] == sorted(report["layers"])
    assert report["components"] == sorted(report["components"])


def test_digest_is_reproducible_across_clones(change: Change, tmp_path: Path) -> None:
    root, base, head = change
    first = change_impact(root, base, head)
    assert first == change_impact(root, base, head)
    assert verify_digest(first)
    assert first["digest"] == digest({k: v for k, v in first.items() if k != "digest"})

    clone = tmp_path / "elsewhere" / "clone"
    git(tmp_path, "clone", "-q", str(root), str(clone))
    git(clone, "remote", "set-url", "origin", "git@github.com:acme/shop.git")
    assert change_impact(clone, base[:10], head)["digest"] == first["digest"]


def test_working_copy_does_not_matter(change: Change) -> None:
    root, base, head = change
    before = change_impact(root, base, head)
    write_files(root, {"extra.py": "import shop\n"})
    git(root, "checkout", "-q", base)
    assert change_impact(root, base, head) == before
    assert not verify_digest({**before, "max_depth": 1})


def test_subdirectory_root_and_max_depth(git_repo: Path) -> None:
    write_files(git_repo, {f"svc/{p}": c for p, c in HEX_SERVICE.items()})
    write_files(git_repo, {"svc/xray.toml": 'exclude = ["apps"]\n', "ci.yml": "a\n"})
    base = commit_all(git_repo, "base")
    write_files(git_repo, {"svc/src/shop/core/domain/models.py": "x = 1\n", "ci.yml": "b\n"})
    head = commit_all(git_repo, "change")

    report = change_impact(git_repo / "svc", base, head, max_depth=1)
    assert report["repository"] == {"url": URL, "path": "svc"}
    assert report["config"] == "xray.toml"
    assert report["outside_root"] == ["ci.yml"]
    assert [c["path"] for c in report["changed"]] == ["src/shop/core/domain/models.py"]
    assert report["changed"][0]["ref"].endswith("#svc/src/shop/core/domain/models.py")
    assert {d["depth"] for d in report["dependents"]} == {1}
    assert not any(d["path"].startswith("apps/") for d in report["dependents"])


@pytest.mark.parametrize("rev", ["--output=x", "", "a b", "nosuchbranch", "0" * 40])
def test_bad_revisions_are_refused(change: Change, rev: str) -> None:
    root, _, head = change
    with pytest.raises(ChangeError):
        change_impact(root, rev, head)


def test_outside_git_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(ChangeError):
        change_impact(tmp_path, "HEAD~1", "HEAD")


def test_git_missing(monkeypatch: pytest.MonkeyPatch, change: Change) -> None:
    root, base, head = change
    monkeypatch.setattr(shutil, "which", lambda _: None)
    with pytest.raises(ChangeError, match="not installed"):
        change_impact(root, base, head)


def test_canonical_form() -> None:
    assert canonical_bytes({"b": [1, None], "a": "ü"}) == '{"a":"ü","b":[1,null]}'.encode()
    with pytest.raises(CanonicalizationError):
        canonical_bytes({"x": 1.5})
    with pytest.raises(CanonicalizationError):
        canonical_bytes(2**53)


def test_cli_change_impact(change: Change, capsys: pytest.CaptureFixture[str]) -> None:
    root, base, head = change
    assert main(["impact", "--base", base, "--head", head, "--root", str(root), "--compact"]) == 0
    assert verify_digest(json.loads(capsys.readouterr().out))

    assert main(["impact", "--base", "nope", "--head", head, "--root", str(root)]) == 2
    assert "does not name a commit" in capsys.readouterr().err


@pytest.mark.parametrize(
    "argv",
    [["impact", "--base", "HEAD"], ["impact"], ["impact", "a.py", "--base", "a", "--head", "b"]],
)
def test_cli_rejects_mixed_targets(argv: list[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        main(argv)
    assert exc.value.code == 2


@pytest.fixture
def change_server(change: Change) -> Iterator[tuple[str, str, str]]:
    root, base, head = change
    srv = make_server(root, port=0)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    host, port = srv.server_address[:2]
    try:
        yield f"http://{host!s}:{port}", base, head
    finally:
        srv.shutdown()
        srv.server_close()


def fetch(url: str) -> tuple[int, dict[str, Any]]:
    try:
        with urllib.request.urlopen(url) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def test_http_change_impact(change_server: tuple[str, str, str]) -> None:
    server, base, head = change_server
    status, body = fetch(f"{server}/impact?base={base}&head={head}")
    assert status == 200
    assert verify_digest(body)
    assert fetch(f"{server}/impact?base={base[:12]}&head=HEAD")[1] == body

    for query in (f"base={base}", f"base={base}&head={head}&path=x.py", "base=zzz&head=HEAD"):
        status, body = fetch(f"{server}/impact?{query}")
        assert status == 400
        assert "error" in body

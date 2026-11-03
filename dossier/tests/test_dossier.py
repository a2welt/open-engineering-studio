from __future__ import annotations

import json
import socket
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from repo_xray import change_impact, digest

from conftest import (
    APPROVAL,
    OAT_TOKEN,
    PR,
    RECALL_TOKEN,
    REPO_URL,
    Change,
    FakeOat,
    FakeRecall,
    commit_all,
    git,
    receipt,
    write_files,
)
from studio_dossier import DossierError, Sources, build_dossier, verify_dossier
from studio_dossier.cli import main

SCHEMA = json.loads(
    (Path(__file__).parents[2] / "docs/schemas/studio.dossier.v0.schema.json").read_text("utf-8")
)
VALIDATOR = Draft202012Validator(SCHEMA)
MODELS = "src/shop/core/domain/models.py"
NOT_IMPLEMENTED = ["model-calls-unknown", "risk-not-assessed"]


def valid(dossier: dict[str, Any]) -> dict[str, Any]:
    VALIDATOR.validate(dossier)
    assert verify_dossier(dossier)
    return dossier


def codes(dossier: dict[str, Any]) -> list[str]:
    return [g["code"] for g in dossier["gaps"]]


def sources(oat: FakeOat | None = None, recall: FakeRecall | None = None) -> Sources:
    return Sources(
        oat_url=oat.url if oat else None,
        oat_token=OAT_TOKEN,
        recall_url=recall.url if recall else None,
        recall_token=RECALL_TOKEN,
    )


def test_schema_is_valid_draft_2020_12() -> None:
    Draft202012Validator.check_schema(SCHEMA)


def test_full_dossier(change: Change, oat: FakeOat, recall: FakeRecall) -> None:
    edit_model = receipt(1, "mcp.repo.write_file", MODELS, [PR])
    edit_test = receipt(2, "mcp.repo.write_file", "./tests/test_models.py", [PR], approval=APPROVAL)
    read_test = receipt(3, "mcp.repo.read_file", "tests/test_checkout.py", [PR])
    failed = receipt(4, "mcp.repo.edit_file", "README.md", [PR], status="failed")
    tampered = receipt(5, "mcp.repo.write_file", "README.md", [PR])
    other_change = receipt(6, "mcp.repo.write_file", MODELS, ["github:pr:acme/shop#8"])
    oat.receipts = [edit_model, edit_test, read_test, failed, tampered, other_change]
    oat.bad = {tampered["id"]}
    base_ref = f"git+{REPO_URL}@{change.base}#{MODELS}"
    recall.links = {base_ref: ["3f0c9d2e", "a1"], PR: ["a1"], "unrelated": ["zz"]}

    dossier = valid(build_dossier(change.root, change.base, change.head, PR, sources(oat, recall)))

    assert dossier["type"] == "studio.dossier/v0"
    assert dossier["change"] == {
        "repository": REPO_URL,
        "path": None,
        "base": change.base,
        "head": change.head,
        "pull_request": PR,
        "author": "Dana Dev",
    }
    assert dossier["intent"] == ["recall:memory:3f0c9d2e", "recall:memory:a1"]
    assert base_ref in recall.queries
    assert f"git+{REPO_URL}@{change.head}#tests/test_models.py" in recall.queries
    assert f"git+{REPO_URL}@{change.base}#tests/test_models.py" not in recall.queries  # added

    impact = change_impact(change.root, change.base, change.head)
    assert dossier["impact"] == {
        "xray_digest": impact["digest"],
        "changed": ["README.md", MODELS, "tests/test_models.py"],
        "dependents": impact["summary"]["dependents"],
        "layers": impact["layers"],
        "components": impact["components"],
    }
    assert dossier["impact"]["dependents"] == 3  # checkout, app, test_checkout

    refs = {r["id"]: "agentproof:sha256:" + digest(r).split(":")[1] for r in oat.receipts}
    assert [a["ref"] for a in dossier["actions"]] == sorted(refs[r["id"]] for r in oat.receipts[:5])
    verified = {a["ref"]: a["verified"] for a in dossier["actions"]}
    assert verified[refs[tampered["id"]]] is False
    assert verified[refs[edit_model["id"]]] is True
    assert dossier["verification"] == {
        "ci": None,
        "receipts": 5,
        "receipts_verified": 4,
        "tests_changed_by_agent": ["tests/test_models.py"],
    }
    assert dossier["approvals"] == [
        {
            "ref": "agentproof:" + digest(APPROVAL),
            "receipt": refs[edit_test["id"]],
            "approver": "ed25519:approver",
            "decision": "approved",
        }
    ]
    assert dossier["gaps"][-1]["code"] == "unverified-receipt"
    assert dossier["gaps"][-1]["subject"] == refs[tampered["id"]]
    assert codes(dossier) == [*NOT_IMPLEMENTED, "unverified-receipt"]
    assert dossier["model_calls"] == []
    assert dossier["risk"] is None
    assert len(oat.queries) == 3  # five receipts, pages of two
    assert {q["reference"] for q in oat.queries} == {PR}


def test_builds_are_reproducible(change: Change, oat: FakeOat, recall: FakeRecall) -> None:
    oat.receipts = [receipt(1, "mcp.repo.write_file", MODELS, [PR])]
    first = build_dossier(change.root, change.base, change.head, PR, sources(oat, recall))
    second = build_dossier(change.root, change.base[:8], "HEAD", PR, sources(oat, recall))
    assert first == second
    assert first["digest"] == digest({k: v for k, v in first.items() if k != "digest"})
    assert not verify_dossier({**first, "intent": ["recall:memory:x"]})


def test_missing_evidence_becomes_gaps(change: Change, oat: FakeOat, recall: FakeRecall) -> None:
    dossier = valid(build_dossier(change.root, change.base, change.head, PR, sources(oat, recall)))
    assert codes(dossier) == [
        "model-calls-unknown",
        "no-linked-decision",
        "no-receipts",
        "risk-not-assessed",
    ]

    dossier = valid(build_dossier(change.root, change.base, change.head))
    assert codes(dossier) == [
        "model-calls-unknown",
        "no-pull-request",
        "recall-not-configured",
        "risk-not-assessed",
    ]
    assert dossier["change"]["pull_request"] is None


def test_oat_without_pr_is_not_queried(change: Change, oat: FakeOat) -> None:
    dossier = valid(build_dossier(change.root, change.base, change.head, None, sources(oat)))
    assert "no-pull-request" in codes(dossier)
    assert oat.queries == []

    dossier = valid(build_dossier(change.root, change.base, change.head, PR, Sources()))
    assert "oat-not-configured" in codes(dossier)


def _closed_port() -> str:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return f"http://127.0.0.1:{sock.getsockname()[1]}"


def test_unreachable_or_refusing_sources(change: Change, oat: FakeOat, recall: FakeRecall) -> None:
    down = Sources(oat_url=_closed_port(), recall_url=_closed_port())
    dossier = valid(build_dossier(change.root, change.base, change.head, PR, down))
    assert {"oat-unavailable", "recall-unavailable"} <= set(codes(dossier))

    oat.receipts = [receipt(1, "mcp.repo.write_file", MODELS, [PR])]
    wrong = Sources(oat_url=oat.url, oat_token="nope", recall_url=recall.url)
    dossier = valid(build_dossier(change.root, change.base, change.head, PR, wrong))
    unavailable = {g["code"]: g["detail"] for g in dossier["gaps"]}
    assert "401" in unavailable["oat-unavailable"]
    assert "401" in unavailable["recall-unavailable"]
    assert dossier["actions"] == []


def test_receipt_named_with_wrong_digest(change: Change, oat: FakeOat) -> None:
    oat.receipts = [receipt(1, "mcp.repo.write_file", MODELS, [PR])]
    oat.wrong_ref = {oat.receipts[0]["id"]}
    dossier = valid(build_dossier(change.root, change.base, change.head, PR, sources(oat)))
    assert dossier["actions"][0]["verified"] is False
    assert {"receipt-digest-mismatch", "unverified-receipt"} <= set(codes(dossier))


def test_without_origin_only_the_pr_is_looked_up(change: Change, recall: FakeRecall) -> None:
    git(change.root, "remote", "remove", "origin")
    recall.links = {PR: ["m1"]}
    dossier = valid(build_dossier(change.root, change.base, change.head, PR, sources(None, recall)))
    assert dossier["change"]["repository"] is None
    assert recall.queries == [PR]
    assert dossier["intent"] == ["recall:memory:m1"]
    assert "no-repository-url" in codes(dossier)


def test_renamed_files_are_looked_up_under_their_old_path(
    change: Change, recall: FakeRecall
) -> None:
    git(change.root, "mv", MODELS, "src/shop/core/domain/orders.py")
    head = commit_all(change.root, "rename")
    build_dossier(change.root, change.head, head, None, sources(None, recall))
    assert f"git+{REPO_URL}@{change.head}#{MODELS}" in recall.queries
    assert f"git+{REPO_URL}@{head}#src/shop/core/domain/orders.py" in recall.queries


def test_git_refs_in_receipt_resources(change: Change, oat: FakeOat) -> None:
    ref = f"git+{REPO_URL}@{change.head}#tests/test_models.py:L1-L3"
    oat.receipts = [receipt(1, "mcp.repo.edit_file", ref, [PR])]
    dossier = build_dossier(change.root, change.base, change.head, PR, sources(oat))
    assert dossier["verification"]["tests_changed_by_agent"] == ["tests/test_models.py"]


def test_bad_pull_request_reference(change: Change) -> None:
    with pytest.raises(DossierError):
        build_dossier(change.root, change.base, change.head, "https://github.com/acme/shop/pull/7")


def test_cli_build_and_verify(
    change: Change,
    oat: FakeOat,
    recall: FakeRecall,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("OAT_API_TOKEN", OAT_TOKEN)
    monkeypatch.setenv("RECALL_API_TOKEN", RECALL_TOKEN)
    oat.receipts = [receipt(1, "mcp.repo.write_file", MODELS, [PR])]
    out = tmp_path / "dossier.json"
    argv = ["dossier", "build", "--repo", str(change.root), "--base", change.base]
    argv += ["--head", change.head, "--pr", PR, "--oat-url", oat.url, "--recall-url", recall.url]
    assert main([*argv, "--out", str(out)]) == 0
    dossier = valid(json.loads(out.read_text("utf-8")))
    assert dossier["verification"]["receipts_verified"] == 1
    assert "1 receipts" in capsys.readouterr().err

    assert main(["dossier", "verify", str(out)]) == 0
    assert capsys.readouterr().out.strip() == f"ok {dossier['digest']}"

    out.write_text(json.dumps({**dossier, "risk": {"tier": "low", "rule": "x"}}), "utf-8")
    assert main(["dossier", "verify", str(out)]) == 1

    assert main([*argv[:-4], "--pr", "pr-7"]) == 2
    assert "github:pr:" in capsys.readouterr().err
    assert main(["dossier", "build", "--repo", str(tmp_path), "--base", "a", "--head", "b"]) == 2


def test_cli_prints_to_stdout(change: Change, capsys: pytest.CaptureFixture[str]) -> None:
    args = ["dossier", "build", "--repo", str(change.root)]
    assert main([*args, "--base", change.base, "--head", change.head]) == 0
    valid(json.loads(capsys.readouterr().out))


def test_subdirectory_repo(tmp_path: Path) -> None:
    root = tmp_path / "mono"
    root.mkdir()
    git(root, "init", "-q", "-b", "main")
    git(root, "remote", "add", "origin", f"{REPO_URL}.git")
    write_files(
        root, {f"svc/{p}": c for p, c in {"a.py": "", "tests/test_a.py": "import a\n"}.items()}
    )
    base = commit_all(root, "base")
    write_files(root, {"svc/a.py": "x = 1\n"})
    head = commit_all(root, "change")
    dossier = valid(build_dossier(root / "svc", base, head))
    assert dossier["change"]["path"] == "svc"
    assert dossier["impact"]["changed"] == ["a.py"]

"""Assemble a ``studio.dossier/v0`` for one change (see docs/adr/0001).

The dossier holds references, not copies: X-Ray's impact digest, receipt references with
their verification result, Recall memory references. Missing evidence becomes a gap
instead of an error, and nothing time-dependent goes in, so two builds over the same
sources produce the same ``digest``.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from repo_xray import change_impact, digest
from repo_xray.config import TESTS

from .sources import OatClient, RecallClient, SourceError

DOSSIER_TYPE = "studio.dossier/v0"
RECEIPT_PREFIX = "agentproof:"
PR_REF = re.compile(r"^github:pr:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#[1-9][0-9]*$")

# Action verbs that read or run things rather than change files.
READ_VERBS = ("read", "list", "get", "search", "find", "grep", "view", "stat", "run", "test")


class DossierError(ValueError):
    """The dossier can't be built from these inputs."""


@dataclass(frozen=True)
class Sources:
    oat_url: str | None = None
    oat_token: str | None = None
    recall_url: str | None = None
    recall_token: str | None = None


def _gap(code: str, detail: str, subject: str | None = None) -> dict[str, Any]:
    return {"code": code, "subject": subject, "detail": detail}


def _author(repo: Path, commit: str) -> str | None:
    git = shutil.which("git")
    if git is None:
        return None
    done = subprocess.run(  # noqa: S603 - fixed git subcommand, resolved commit hash
        [git, "-C", str(repo), "log", "-1", "--format=%an", commit],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
        check=False,
    )
    name: str = done.stdout.strip()
    return name if done.returncode == 0 and name else None


def _resource_path(resource: Any) -> str | None:
    """A receipt resource as a repository path: plain paths and ``git+…#path`` refs."""
    if not isinstance(resource, str) or not resource:
        return None
    path: str = resource
    if path.startswith("git+") and "#" in path:
        path = re.sub(r":L\d+(-L?\d+)?$", "", path.split("#", 1)[1])
    return path.replace("\\", "/").removeprefix("./")


def _changes_files(action: Any) -> bool:
    if not isinstance(action, str):
        return False
    verb = action.rsplit(".", 1)[-1].lower()
    return not verb.startswith(READ_VERBS)


def _code_refs(impact: dict[str, Any]) -> list[str]:
    """Code refs of every changed file, at the base commit (before) and at the head (after)."""
    url = impact["repository"]["url"]
    if url is None:
        return []
    prefix = impact["repository"]["path"]
    refs = []
    for item in impact["changed"]:
        if item["status"] != "deleted":
            refs.append(item["ref"])
        old = item["old_path"] or item["path"]
        if item["status"] != "added":
            full = f"{prefix}/{old}" if prefix else old
            refs.append(f"git+{url}@{impact['base']}#{full}")
    return sorted(set(refs))


def _actions(
    oat: OatClient, pull_request: str, gaps: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Actions, approvals and the raw receipts behind them."""
    actions = []
    approvals = []
    receipts = []
    for item in oat.receipts(pull_request):
        receipt = item["receipt"]
        ref = RECEIPT_PREFIX + digest(receipt)
        verified = oat.verify(receipt)
        if item.get("ref") != ref:
            verified = False
            gaps.append(
                _gap("receipt-digest-mismatch", "oat serve named this receipt differently", ref)
            )
        if not verified:
            gaps.append(_gap("unverified-receipt", "receipt did not verify", ref))
        request = receipt.get("request") if isinstance(receipt.get("request"), dict) else {}
        outcome = receipt.get("outcome") if isinstance(receipt.get("outcome"), dict) else {}
        actions.append(
            {
                "ref": ref,
                "action": request.get("action"),
                "resource": request.get("resource"),
                "status": outcome.get("status"),
                "verified": verified,
            }
        )
        approval = receipt.get("approval")
        if isinstance(approval, dict):
            approvals.append(
                {
                    "ref": RECEIPT_PREFIX + digest(approval),
                    "receipt": ref,
                    "approver": approval.get("approver"),
                    "decision": approval.get("decision"),
                }
            )
        receipts.append(receipt)
    actions.sort(key=lambda a: str(a["ref"]))
    approvals.sort(key=lambda a: (a["receipt"], a["ref"]))
    return actions, approvals, receipts


def tests_changed_by_agent(receipts: Iterable[dict[str, Any]], impact: dict[str, Any]) -> list[str]:
    """Changed test files that a receipt shows an agent successfully writing to."""
    tests = [c["path"] for c in impact["changed"] if c["layer"] == TESTS]
    prefix = impact["repository"]["path"]
    found = set()
    for receipt in receipts:
        request = receipt.get("request")
        outcome = receipt.get("outcome")
        if not isinstance(request, dict) or not isinstance(outcome, dict):
            continue
        if outcome.get("status") != "succeeded" or not _changes_files(request.get("action")):
            continue
        resource = _resource_path(request.get("resource"))
        if resource is None:
            continue
        for path in tests:
            full = f"{prefix}/{path}" if prefix else path
            if resource in (path, full) or resource.endswith(f"/{full}"):
                found.add(path)
    return sorted(found)


def build_dossier(
    repo: Path | str,
    base: str,
    head: str,
    pull_request: str | None = None,
    sources: Sources | None = None,
    xray_config: Path | None = None,
) -> dict[str, Any]:
    sources = sources or Sources()
    if pull_request is not None and not PR_REF.match(pull_request):
        raise DossierError(f"'{pull_request}' is not a github:pr:<owner>/<repo>#<number> ref")
    impact = change_impact(repo, base, head, xray_config)
    gaps: list[dict[str, Any]] = []

    actions: list[dict[str, Any]] = []
    approvals: list[dict[str, Any]] = []
    receipts: list[dict[str, Any]] = []
    if pull_request is None:
        gaps.append(_gap("no-pull-request", "without a PR reference, receipts can't be found"))
    elif sources.oat_url is None:
        gaps.append(_gap("oat-not-configured", "no OpenAgentTrust gateway was given"))
    else:
        try:
            oat = OatClient(sources.oat_url, sources.oat_token)
            receipt_gaps: list[dict[str, Any]] = []
            actions, approvals, receipts = _actions(oat, pull_request, receipt_gaps)
        except SourceError as exc:
            gaps.append(_gap("oat-unavailable", str(exc)))
        else:
            gaps.extend(receipt_gaps)
            if not actions:
                gaps.append(_gap("no-receipts", "no agent action carries this change's reference"))

    intent: list[str] = []
    if sources.recall_url is None:
        gaps.append(_gap("recall-not-configured", "no Recall server was given"))
    else:
        refs = _code_refs(impact) + ([pull_request] if pull_request else [])
        if impact["repository"]["url"] is None:
            gaps.append(_gap("no-repository-url", "no origin remote, so no code references"))
        try:
            recall = RecallClient(sources.recall_url, sources.recall_token)
            intent = sorted({memory for ref in refs for memory in recall.memories_for(ref)})
        except SourceError as exc:
            gaps.append(_gap("recall-unavailable", str(exc)))
        else:
            if not intent:
                gaps.append(_gap("no-linked-decision", "no Recall decision links to this change"))

    gaps.append(_gap("model-calls-unknown", "not implemented: model calls are not collected yet"))
    gaps.append(_gap("risk-not-assessed", "not implemented: risk tiers come with ADR 0001 step 4"))

    dossier: dict[str, Any] = {
        "type": DOSSIER_TYPE,
        "change": {
            "repository": impact["repository"]["url"],
            "path": impact["repository"]["path"],
            "base": impact["base"],
            "head": impact["head"],
            "pull_request": pull_request,
            "author": _author(Path(repo), impact["head"]),
        },
        "intent": intent,
        "impact": {
            "xray_digest": impact["digest"],
            "changed": [c["path"] for c in impact["changed"]],
            "dependents": impact["summary"]["dependents"],
            "layers": impact["layers"],
            "components": impact["components"],
        },
        "actions": actions,
        "model_calls": [],
        "verification": {
            "ci": None,
            "receipts": len(actions),
            "receipts_verified": sum(1 for a in actions if a["verified"]),
            "tests_changed_by_agent": tests_changed_by_agent(receipts, impact),
        },
        "risk": None,
        "approvals": approvals,
        "gaps": sorted(gaps, key=lambda g: (g["code"], g["subject"] or "")),
    }
    dossier["digest"] = digest(dossier)
    return dossier


def verify_dossier(dossier: dict[str, Any]) -> bool:
    """True when ``dossier["digest"]`` covers the rest of the dossier."""
    body = {k: v for k, v in dossier.items() if k != "digest"}
    return dossier.get("digest") == digest(body)

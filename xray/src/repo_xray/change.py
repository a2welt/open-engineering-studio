"""Commit-to-commit impact: what a change between two commits touches and can break.

``git diff --name-status`` lists the changed files; the head commit's tree (exported with
``git archive``, so the working copy is never touched) is analysed for their dependents.
The result has no timestamps or machine paths and every list is sorted, so its canonical
JSON digest is the same on every machine that builds it.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tarfile
import tempfile
from collections import Counter
from pathlib import Path
from typing import IO, Any

from .analysis import SCHEMA_VERSION, analyze
from .canonical import digest
from .config import CONFIG_FILE, TESTS, Config, load_config
from .discover import language_of
from .gitinfo import Repository, normalise_remote
from .impact import reverse_edges, walk_dependents
from .layers import place

_REV = re.compile(r"^[\w./~^@{}-]+$")

STATUS = {
    "A": "added",
    "M": "modified",
    "D": "deleted",
    "R": "renamed",
    "C": "copied",
    "T": "type-changed",
}


class ChangeError(ValueError):
    """The commits can't be compared: not a git checkout, unknown commit, git failed."""


def _git_binary() -> str:
    git = shutil.which("git")
    if git is None:
        raise ChangeError("git is not installed")
    return git


def _git(top: Path, *args: str) -> str:
    try:
        done = subprocess.run(  # noqa: S603 - fixed git subcommands, validated revisions
            [_git_binary(), "-C", str(top), *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ChangeError(f"git {args[0]} failed: {exc}") from exc
    if done.returncode != 0:
        raise ChangeError(f"git {args[0]} failed: {done.stderr.strip()}")
    return done.stdout


def resolve_commit(top: Path, rev: str) -> str:
    """Full commit hash for ``rev``; refuses anything git could read as an option."""
    if not rev or rev.startswith("-") or not _REV.match(rev):
        raise ChangeError(f"'{rev}' is not a valid revision")
    try:
        return _git(top, "rev-parse", "--verify", "--quiet", f"{rev}^{{commit}}").strip()
    except ChangeError as exc:
        raise ChangeError(f"'{rev}' does not name a commit") from exc


def diff_name_status(top: Path, base: str, head: str) -> list[tuple[str, str, str | None]]:
    """``(status, path, old_path)`` for every file that differs, paths from the repo top."""
    out = _git(
        top,
        "-c",
        "core.quotepath=false",
        "diff",
        "--name-status",
        "-z",
        "--find-renames",
        "--no-ext-diff",
        "--no-textconv",
        base,
        head,
        "--",
    )
    tokens = out.split("\0")
    changes: list[tuple[str, str, str | None]] = []
    index = 0
    while index < len(tokens) and tokens[index]:
        code = tokens[index][0]
        if code in "RC":
            old, new = tokens[index + 1], tokens[index + 2]
            changes.append((STATUS[code], new, old))
            index += 3
        else:
            changes.append((STATUS.get(code, "modified"), tokens[index + 1], None))
            index += 2
    return sorted(changes, key=lambda c: c[1])


def _extract(stream: IO[bytes], dest: Path) -> None:
    """Regular files and directories only; no links, nothing outside ``dest``."""
    dest = dest.resolve()
    with tarfile.open(fileobj=stream, mode="r|") as archive:
        for member in archive:
            target = (dest / member.name).resolve()
            if not target.is_relative_to(dest):
                continue
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                source = archive.extractfile(member)
                if source is None:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                try:
                    target.write_bytes(source.read())
                except OSError:
                    continue  # a name this filesystem can't hold


def export_tree(top: Path, commit: str, prefix: str, dest: Path) -> None:
    """Write the tree of ``commit`` (only ``prefix`` when set) under ``dest``."""
    treeish = f"{commit}:{prefix}" if prefix else commit
    try:
        with subprocess.Popen(  # noqa: S603 - fixed git subcommand, resolved commit hash
            [_git_binary(), "-C", str(top), "archive", "--format=tar", treeish],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        ) as proc:
            assert proc.stdout is not None
            _extract(proc.stdout, dest)
            proc.stdout.read()
            err = proc.stderr.read() if proc.stderr else b""
            code = proc.wait(timeout=60)
    except (OSError, subprocess.SubprocessError, tarfile.TarError) as exc:
        raise ChangeError(f"git archive failed: {exc}") from exc
    if code != 0:
        raise ChangeError(f"git archive failed: {err.decode('utf-8', 'replace').strip()}")


def _toplevel(root: Path) -> tuple[Path, str]:
    top = Path(_git(root, "rev-parse", "--show-toplevel").strip()).resolve()
    try:
        prefix = root.resolve().relative_to(top).as_posix()
    except ValueError as exc:
        raise ChangeError(f"{root} is outside its repository {top}") from exc
    return top, "" if prefix == "." else prefix


def _remote_url(top: Path) -> str | None:
    try:
        remote = _git(top, "config", "--get", "remote.origin.url").strip()
    except ChangeError:
        return None
    return normalise_remote(remote) if remote else None


def change_impact(
    root: Path | str,
    base: str,
    head: str,
    config_path: Path | None = None,
    max_depth: int | None = None,
) -> dict[str, Any]:
    """Impact of the change ``base..head`` on the tree under ``root`` (a git checkout)."""
    root = Path(root).resolve()
    if not root.is_dir():
        raise NotADirectoryError(str(root))
    top, prefix = _toplevel(root)
    base_commit = resolve_commit(top, base)
    head_commit = resolve_commit(top, head)
    url = _remote_url(top)
    head_repo = Repository(url, head_commit, prefix)
    base_repo = Repository(url, base_commit, prefix)

    inside = f"{prefix}/" if prefix else ""
    changes = []
    outside = []
    for status, path, old in diff_name_status(top, base_commit, head_commit):
        if not path.startswith(inside):
            outside.append(path)
            continue
        rel_old = old.removeprefix(inside) if old and old.startswith(inside) else old
        changes.append((status, path.removeprefix(inside), rel_old))

    with tempfile.TemporaryDirectory(prefix="xray-") as tmp:
        tree = Path(tmp)
        export_tree(top, head_commit, prefix, tree)
        if config_path is not None:
            config = load_config(tree, config_path)
            try:  # name it without machine paths, so the digest stays reproducible
                config_name: str | None = config_path.resolve().relative_to(root).as_posix()
            except ValueError:
                config_name = config_path.name
        else:
            config = load_config(tree)
            config_name = CONFIG_FILE if config.source else None
        analysis = analyze(tree, config)
    return _report(
        analysis.files,
        analysis.edges,
        config,
        config_name,
        changes,
        outside,
        head_repo,
        base_repo,
        max_depth,
    )


def _report(
    files: dict[str, str],
    edges: dict[str, set[str]],
    config: Config,
    config_name: str | None,
    changes: list[tuple[str, str, str | None]],
    outside: list[str],
    head_repo: Repository,
    base_repo: Repository,
    max_depth: int | None,
) -> dict[str, Any]:
    def entry(path: str) -> dict[str, Any]:
        placed = place(path, config)
        return {
            "path": path,
            "language": files.get(path) or language_of(path),
            "layer": placed.layer,
            "component": placed.component,
        }

    changed = []
    for status, path, old in changes:
        item = entry(path)
        repo = base_repo if status == "deleted" else head_repo
        item.update(status=status, old_path=old, ref=repo.ref(path))
        changed.append(item)

    seeds = {path for _, path, _ in changes if path in files}
    affected = walk_dependents(reverse_edges(edges), seeds, max_depth)
    dependents = []
    for hit in affected:
        item = entry(hit.path)
        item.update(depth=hit.depth, via=hit.via, ref=head_repo.ref(hit.path))
        dependents.append(item)

    touched = changed + dependents
    by_layer = Counter(e["layer"] for e in dependents)
    report: dict[str, Any] = {
        "schema": SCHEMA_VERSION,
        "kind": "change",
        "repository": {"url": head_repo.url, "path": head_repo.prefix or None},
        "base": base_repo.commit,
        "head": head_repo.commit,
        "config": config_name,
        "max_depth": max_depth,
        "summary": {
            "changed": len(changed),
            "dependents": len(dependents),
            "direct": sum(1 for e in dependents if e["depth"] == 1),
            "tests": by_layer.get(TESTS, 0),
            "by_layer": dict(sorted(by_layer.items())),
        },
        "layers": sorted({e["layer"] for e in touched}),
        "components": sorted({e["component"] for e in touched}),
        "changed": changed,
        "outside_root": sorted(outside),
        "dependents": dependents,
    }
    report["digest"] = digest(report)
    return report


def verify_digest(report: dict[str, Any]) -> bool:
    """True when ``report["digest"]`` matches the rest of the report."""
    body = {k: v for k, v in report.items() if k != "digest"}
    return report.get("digest") == digest(body)

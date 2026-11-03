"""``studio`` command line: ``studio dossier build`` and ``studio dossier verify``."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from repo_xray import ChangeError
from repo_xray.config import ConfigError

from . import __version__
from .build import DossierError, Sources, build_dossier, verify_dossier

OAT_TOKEN_ENV = "OAT_API_TOKEN"  # noqa: S105 - a variable name, not a secret
RECALL_TOKEN_ENV = "RECALL_API_TOKEN"  # noqa: S105 - a variable name, not a secret


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="studio", description="Open Engineering Studio tools.")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)
    dossier = sub.add_parser("dossier", help="change dossiers (studio.dossier/v0)")
    actions = dossier.add_subparsers(dest="action", required=True)

    build = actions.add_parser(
        "build",
        help="assemble the dossier of a change",
        description=(
            f"Tokens come from the environment: {OAT_TOKEN_ENV} for oat serve, "
            f"{RECALL_TOKEN_ENV} for Recall."
        ),
    )
    build.add_argument("--repo", type=Path, default=Path(), help="git checkout (default: .)")
    build.add_argument("--base", required=True, help="base commit of the change")
    build.add_argument("--head", required=True, help="head commit of the change")
    build.add_argument("--pr", help="pull request reference, github:pr:<owner>/<repo>#<n>")
    build.add_argument("--oat-url", help="oat serve base URL, e.g. http://127.0.0.1:8787")
    build.add_argument("--recall-url", help="Recall base URL, e.g. http://127.0.0.1:4321")
    build.add_argument("--xray-config", type=Path, help="xray.toml to use instead of the head's")
    build.add_argument("--out", default="-", help="output file (default: stdout)")

    verify = actions.add_parser("verify", help="check that a dossier's digest matches it")
    verify.add_argument("file", type=Path)
    return parser


def _write(data: dict[str, Any], out: str) -> None:
    text = json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    if out == "-":
        sys.stdout.write(text)
    else:
        Path(out).write_text(text, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.action == "verify":
            dossier = json.loads(args.file.read_text(encoding="utf-8"))
            if isinstance(dossier, dict) and verify_dossier(dossier):
                print(f"ok {dossier['digest']}")
                return 0
            print(f"studio: {args.file} does not match its digest", file=sys.stderr)
            return 1

        sources = Sources(
            oat_url=args.oat_url,
            oat_token=os.environ.get(OAT_TOKEN_ENV) or None,
            recall_url=args.recall_url,
            recall_token=os.environ.get(RECALL_TOKEN_ENV) or None,
        )
        dossier = build_dossier(args.repo, args.base, args.head, args.pr, sources, args.xray_config)
        _write(dossier, args.out)
        print(
            f"dossier {dossier['digest']}: {len(dossier['impact']['changed'])} changed, "
            f"{dossier['impact']['dependents']} dependents, {len(dossier['actions'])} receipts, "
            f"{len(dossier['gaps'])} gaps",
            file=sys.stderr,
        )
        return 0
    except (DossierError, ChangeError, ConfigError, NotADirectoryError, OSError) as exc:
        print(f"studio: {exc}", file=sys.stderr)
        return 2
    except ValueError as exc:  # unreadable JSON in verify
        print(f"studio: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

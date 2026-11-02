"""``xray`` command line: JSON on stdout, errors on stderr."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .analysis import TargetError, analyze
from .change import ChangeError, change_impact
from .config import ConfigError, load_config
from .server import LOOPBACK_HOSTS, make_server


def _positive(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return number


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="xray",
        description="Import graph, architecture layers and change impact for a source tree.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--root", type=Path, default=Path(), help="tree to analyse (default: current directory)"
    )
    common.add_argument(
        "--config", type=Path, default=None, help="config file (default: <root>/xray.toml)"
    )
    common.add_argument("--compact", action="store_true", help="one-line JSON")

    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("graph", parents=[common], help="files and import edges")
    sub.add_parser("layers", parents=[common], help="layers, components and violations")
    impact = sub.add_parser(
        "impact", parents=[common], help="what breaks if PATH changes, or a change BASE..HEAD"
    )
    impact.add_argument(
        "path", nargs="?", help="file or directory, relative to the root, or a unique suffix"
    )
    impact.add_argument("--base", help="base commit of a change (with --head)")
    impact.add_argument("--head", help="head commit of a change (with --base)")
    impact.add_argument("--max-depth", type=_positive, default=None, help="stop after N hops")

    serve = sub.add_parser("serve", parents=[common], help="serve the analysis over HTTP")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)
    return parser


def _emit(data: dict[str, Any], compact: bool) -> None:
    text = json.dumps(data, separators=(",", ":")) if compact else json.dumps(data, indent=2)
    sys.stdout.write(text + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "impact":
        commits = (args.base is not None, args.head is not None)
        if any(commits) and not all(commits):
            parser.error("--base and --head go together")
        if all(commits) == (args.path is not None):
            parser.error("give either PATH or --base and --head")
    root: Path = args.root.resolve()
    try:
        config = load_config(root, args.config)
        if args.command == "serve":
            if args.host not in LOOPBACK_HOSTS:
                print(
                    f"warning: serving source structure of {root} on {args.host}",
                    file=sys.stderr,
                )
            server = make_server(root, args.host, args.port, config)
            print(f"xray serving {root} on http://{args.host}:{args.port}", file=sys.stderr)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
            finally:
                server.server_close()
            return 0

        if args.command == "impact" and args.base is not None:
            _emit(
                change_impact(root, args.base, args.head, args.config, args.max_depth),
                args.compact,
            )
            return 0

        analysis = analyze(root, config)
        if args.command == "graph":
            _emit(analysis.graph(), args.compact)
        elif args.command == "layers":
            _emit(analysis.layers(), args.compact)
        else:
            _emit(analysis.impact(args.path, args.max_depth), args.compact)
        return 0
    except (ConfigError, TargetError, ChangeError, NotADirectoryError) as exc:
        print(f"xray: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

"""Start everything the Studio talks to, in one terminal.

Runs three processes and prefixes their output:

    [xray]  Repo X-Ray on the repository you point it at       (xray serve)
    [oat]   a seeded OpenAgentTrust gateway playing an agent   (scripts/oat_demo.py)
    [web]   the Studio dev server, wired to both               (vite)

Ports that are taken (by another app, or a previous run) are skipped: the next free
port is used and the Studio's proxy is pointed at it. Ctrl+C stops all three.

    python scripts/dev.py --repo ../Open-model-fabric
    python scripts/dev.py --repo ../Open-model-fabric --no-oat

Needs uv and Node.js 24; the gateway needs an open-agent-trust checkout next to this
repository (or --oat PATH). Uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import contextlib
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import IO

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
COLORS = {"xray": "\033[36m", "oat": "\033[32m", "web": "\033[35m", "dev": "\033[33m"}
RESET = "\033[0m"


def say(name: str, line: str) -> None:
    color = COLORS.get(name, "") if sys.stdout.isatty() else ""
    sys.stdout.write(f"{color}[{name}]{RESET if color else ''} {line}\n")
    sys.stdout.flush()


def port_free(port: int) -> bool:
    """Free on both loopbacks: dev servers often listen on ::1 only ("localhost")."""
    for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        with socket.socket(family, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.3)
            if sock.connect_ex((host, port)) == 0:
                return False
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def free_port(preferred: int, taken: set[int]) -> int:
    port = preferred
    while port in taken or not port_free(port):
        port += 1
    taken.add(port)
    return port


def wait_for_port(port: int, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with contextlib.suppress(OSError), socket.create_connection(("localhost", port), 0.5):
            return True
        time.sleep(0.3)
    return False


def read_env(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    pairs = (line.split("=", 1) for line in path.read_text(encoding="utf-8").splitlines())
    return {k.strip(): v.strip() for k, v in (p for p in pairs if len(p) == 2)}


def tool(name: str) -> str:
    """Resolve an executable, including npm.cmd and uv.exe on Windows."""
    found = shutil.which(name)
    if not found:
        raise SystemExit(f"dev: '{name}' is not on PATH")
    return found


class Group:
    """Child processes started in their own process groups, so stopping takes their children."""

    def __init__(self) -> None:
        self.children: list[tuple[str, subprocess.Popen[bytes]]] = []

    def start(self, name: str, args: list[str], cwd: Path, env: dict[str, str]) -> None:
        kwargs: dict[str, object] = {}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        child = subprocess.Popen(  # noqa: S603 - fixed developer commands
            args,
            cwd=cwd,
            env={**os.environ, **env, "PYTHONUNBUFFERED": "1", "FORCE_COLOR": "1"},
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            **kwargs,  # type: ignore[call-overload]
        )
        self.children.append((name, child))
        threading.Thread(target=self._pump, args=(name, child.stdout), daemon=True).start()

    @staticmethod
    def _pump(name: str, stream: IO[bytes] | None) -> None:
        for raw in stream or ():
            say(name, raw.decode("utf-8", "replace").rstrip())

    def exited(self) -> str | None:
        return next((name for name, child in self.children if child.poll() is not None), None)

    def stop(self) -> None:
        for _, child in self.children:
            if child.poll() is not None:
                continue
            if os.name == "nt":
                subprocess.run(  # noqa: S603 - stop the child\'s whole tree
                    [tool("taskkill"), "/T", "/F", "/PID", str(child.pid)],
                    capture_output=True,
                    check=False,
                )
            else:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(child.pid, signal.SIGTERM)
        for _, child in self.children:
            with contextlib.suppress(subprocess.TimeoutExpired):
                child.wait(timeout=10)


def main() -> int:
    # Child output carries symbols (Vite prints "➜"); a cp1252 console must not crash on them.
    for stream in (sys.stdout, sys.stderr):
        with contextlib.suppress(AttributeError, ValueError):
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--repo", type=Path, default=ROOT.parent / "Open-model-fabric", help="repository X-Ray maps"
    )
    parser.add_argument(
        "--oat",
        type=Path,
        default=ROOT.parent / "open-agent-trust",
        help="open-agent-trust checkout",
    )
    parser.add_argument(
        "--no-oat", action="store_true", help="use the Trust screen's built-in mock"
    )
    parser.add_argument("--xray-port", type=int, default=8765)
    parser.add_argument("--oat-port", type=int, default=8787)
    parser.add_argument("--web-port", type=int, default=5173)
    args = parser.parse_args()

    repo = args.repo.resolve()
    if not repo.is_dir():
        raise SystemExit(f"dev: {repo} is not a directory; pass --repo PATH")
    use_oat = not args.no_oat
    if use_oat and not (args.oat / "pyproject.toml").exists():
        say("dev", f"no open-agent-trust checkout at {args.oat}; the Trust screen uses its mock")
        use_oat = False

    uv, npm = tool("uv"), tool("npm")
    taken: set[int] = set()
    xray_port = free_port(args.xray_port, taken)
    oat_port = free_port(args.oat_port, taken) if use_oat else None
    web_port = free_port(args.web_port, taken)
    for name, wanted, got in (
        ("xray", args.xray_port, xray_port),
        ("oat", args.oat_port, oat_port),
        ("web", args.web_port, web_port),
    ):
        if got is not None and got != wanted:
            say("dev", f"port {wanted} is taken; {name} uses {got}")

    if not (WEB / "node_modules").exists():
        say("dev", "installing web dependencies (npm ci)")
        subprocess.run([npm, "ci"], cwd=WEB, check=True)  # noqa: S603

    web_env = {"XRAY_TARGET": f"http://127.0.0.1:{xray_port}", "VITE_XRAY_MODE": "http"}
    group = Group()
    group.start(
        "xray",
        [
            uv,
            "run",
            "--project",
            str(ROOT / "xray"),
            "xray",
            "serve",
            "--root",
            str(repo),
            "--port",
            str(xray_port),
        ],
        ROOT / "xray",
        {},
    )
    if use_oat:
        # One token for the gateway and the dev proxy; reuse the one in web/.env.local.
        token = read_env(WEB / ".env.local").get("OAT_API_TOKEN") or secrets.token_urlsafe(32)
        group.start(
            "oat",
            [
                uv,
                "run",
                "--project",
                str(args.oat.resolve()),
                "python",
                str(ROOT / "scripts" / "oat_demo.py"),
                "--port",
                str(oat_port),
            ],
            ROOT,
            {"OAT_API_TOKEN": token},
        )
        web_env |= {
            "VITE_OAT_MODE": "http",
            "OAT_TARGET": f"http://127.0.0.1:{oat_port}",
            "OAT_API_TOKEN": token,
        }
    else:
        web_env["VITE_OAT_MODE"] = "mock"
    group.start(
        "web", [npm, "run", "dev", "--", "--port", str(web_port), "--strictPort"], WEB, web_env
    )

    try:
        ready = [("xray", xray_port), ("oat", oat_port), ("web", web_port)]
        for name, port in ready:
            if port is not None and not wait_for_port(port, 120):
                say("dev", f"{name} did not start on port {port}")
                return 1
        say("dev", f"Studio ready: http://localhost:{web_port}  (Ctrl+C stops everything)")
        while (gone := group.exited()) is None:
            time.sleep(0.5)
        say("dev", f"{gone} exited; stopping the others")
        return 1
    except KeyboardInterrupt:
        say("dev", "stopping")
        return 0
    finally:
        group.stop()


if __name__ == "__main__":
    raise SystemExit(main())

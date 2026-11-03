"""A small read-only HTTP endpoint over one analysed root, for the Studio backend.

    GET /health                         {"ok": true, ...}
    GET /graph                          import graph
    GET /layers                         layers, components and violations
    GET /impact?path=<p>&max_depth=<n>  what breaks if <p> changes
    GET /impact?base=<a>&head=<b>       impact of the change between two commits (with digest)

Add ``refresh=1`` to any query to re-analyse the tree. The server binds to loopback by
default and only answers CORS requests from loopback origins.
"""

from __future__ import annotations

import json
import threading
from collections import OrderedDict
from collections.abc import Callable
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from . import __version__
from .analysis import Analysis, TargetError, analyze
from .change import change_impact, resolve_commit
from .config import CONFIG_FILE, Config

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}
CHANGE_CACHE_SIZE = 32


class AnalysisCache:
    def __init__(self, root: Path, config: Config | None) -> None:
        self.root = root
        self.config = config
        self._lock = threading.Lock()
        self._analysis: Analysis | None = None
        self._changes: OrderedDict[tuple[str, str, int | None], dict[str, Any]] = OrderedDict()

    def get(self, refresh: bool = False) -> Analysis:
        with self._lock:
            if self._analysis is None or refresh:
                self._analysis = analyze(self.root, self.config)
            return self._analysis

    def change(self, base: str, head: str, max_depth: int | None) -> dict[str, Any]:
        """Change impact; commits never change, so results are cached by commit hash."""
        key = (resolve_commit(self.root, base), resolve_commit(self.root, head), max_depth)
        with self._lock:
            if key in self._changes:
                self._changes.move_to_end(key)
                return self._changes[key]
        # The head commit's own xray.toml applies unless the server was given another file.
        source = Path(self.config.source) if self.config and self.config.source else None
        config_path = None if source is None or source == self.root / CONFIG_FILE else source
        result = change_impact(self.root, key[0], key[1], config_path, max_depth)
        with self._lock:
            self._changes[key] = result
            while len(self._changes) > CHANGE_CACHE_SIZE:
                self._changes.popitem(last=False)
        return result


def _loopback_origin(origin: str | None) -> bool:
    if not origin:
        return False
    host = urlsplit(origin).hostname
    return host is not None and (host in LOOPBACK_HOSTS or host.endswith(".localhost"))


def make_handler(cache: AnalysisCache) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = f"repo-xray/{__version__}"

        def log_message(self, format: str, *args: Any) -> None:
            pass

        def _send(self, status: HTTPStatus, body: dict[str, Any]) -> None:
            data = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            origin = self.headers.get("Origin")
            if _loopback_origin(origin):
                self.send_header("Access-Control-Allow-Origin", origin or "")
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self) -> None:
            self.send_response(HTTPStatus.NO_CONTENT)
            origin = self.headers.get("Origin")
            if _loopback_origin(origin):
                self.send_header("Access-Control-Allow-Origin", origin or "")
                self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
                self.send_header("Vary", "Origin")
            self.end_headers()

        def do_GET(self) -> None:
            url = urlsplit(self.path)
            query = {k: v[-1] for k, v in parse_qs(url.query).items()}
            refresh = query.get("refresh") in {"1", "true"}
            routes: dict[str, Callable[[Analysis], dict[str, Any]]] = {
                "/graph": Analysis.graph,
                "/layers": Analysis.layers,
            }
            try:
                if url.path == "/health":
                    self._send(
                        HTTPStatus.OK,
                        {"ok": True, "version": __version__, "root": str(cache.root)},
                    )
                elif url.path in routes:
                    self._send(HTTPStatus.OK, routes[url.path](cache.get(refresh)))
                elif url.path == "/impact":
                    target = query.get("path")
                    base, head = query.get("base"), query.get("head")
                    raw_depth = query.get("max_depth")
                    depth = int(raw_depth) if raw_depth else None
                    if depth is not None and depth < 1:
                        raise ValueError("max_depth must be at least 1")
                    if base or head:
                        if not (base and head) or target:
                            raise ValueError("give 'base' and 'head' together, without 'path'")
                        self._send(HTTPStatus.OK, cache.change(base, head, depth))
                        return
                    if not target:
                        self._send(HTTPStatus.BAD_REQUEST, {"error": "missing 'path'"})
                        return
                    self._send(HTTPStatus.OK, cache.get(refresh).impact(target, depth))
                else:
                    self._send(HTTPStatus.NOT_FOUND, {"error": f"no route {url.path}"})
            except TargetError as exc:
                self._send(HTTPStatus.NOT_FOUND, {"error": str(exc)})
            except ValueError as exc:
                self._send(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    return Handler


def make_server(
    root: Path, host: str = "127.0.0.1", port: int = 8765, config: Config | None = None
) -> ThreadingHTTPServer:
    cache = AnalysisCache(root.resolve(), config)
    return ThreadingHTTPServer((host, port), make_handler(cache))

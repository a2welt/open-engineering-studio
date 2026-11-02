"""Read-only HTTP clients for the tools a dossier references: ``oat serve`` and Recall."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from typing import Any

TIMEOUT_SECONDS = 15
RECEIPT_PAGE = 500  # the most ``oat serve`` returns per page


class SourceError(RuntimeError):
    """A tool could not be reached or answered with something unusable."""


def _base(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise SourceError(f"{url} is not an http(s) URL")
    return url.rstrip("/")


class JsonClient:
    def __init__(self, base_url: str, token: str | None, name: str) -> None:
        self.base_url = _base(base_url)
        self.token = token
        self.name = name

    def request(self, method: str, path: str, body: Any = None) -> Any:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(  # noqa: S310 - scheme checked in _base
            self.base_url + path, data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            raise SourceError(f"{self.name} answered {exc.code} for {method} {path}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            reason = getattr(exc, "reason", exc)
            raise SourceError(f"{self.name} at {self.base_url} is unreachable: {reason}") from exc
        except ValueError as exc:
            raise SourceError(f"{self.name} returned invalid JSON for {path}") from exc


class OatClient(JsonClient):
    """``oat serve``: receipts by reference and receipt verification."""

    def __init__(self, base_url: str, token: str | None) -> None:
        super().__init__(base_url, token, "oat serve")

    def receipts(self, reference: str) -> Iterator[dict[str, Any]]:
        """Every ``{"ref", "receipt"}`` whose request carries ``reference``."""
        offset = 0
        while True:
            query = urllib.parse.urlencode(
                {"reference": reference, "limit": RECEIPT_PAGE, "offset": offset}
            )
            page = self.request("GET", f"/v1/receipts?{query}")
            items = page.get("receipts") if isinstance(page, dict) else None
            if not isinstance(items, list):
                raise SourceError("oat serve returned receipts in an unknown shape")
            for item in items:
                if isinstance(item, dict) and isinstance(item.get("receipt"), dict):
                    yield item
            offset += len(items)
            total = page.get("total")
            if not items or not isinstance(total, int) or offset >= total:
                return

    def verify(self, receipt: dict[str, Any]) -> bool:
        report = self.request("POST", "/v1/verify", {"receipt": receipt})
        return isinstance(report, dict) and report.get("ok") is True


class RecallClient(JsonClient):
    """Recall's links API: which memories link to a reference URI."""

    def __init__(self, base_url: str, token: str | None) -> None:
        super().__init__(base_url, token, "Recall")

    def memories_for(self, reference: str) -> list[str]:
        """``recall:memory:<id>`` of every memory linked to ``reference``."""
        query = urllib.parse.urlencode({"reference": reference}, quote_via=urllib.parse.quote)
        body = self.request("GET", f"/api/links?{query}")
        links = body.get("links") if isinstance(body, dict) else None
        if not isinstance(links, list):
            raise SourceError("Recall returned links in an unknown shape")
        found = []
        for link in links:
            memory = link.get("memory_id") if isinstance(link, dict) else None
            if isinstance(memory, str) and memory:
                found.append(memory if memory.startswith("recall:") else f"recall:memory:{memory}")
        return found

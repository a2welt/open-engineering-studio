"""Canonical JSON and ``sha256:`` digests, in the AgentProof canonical form.

Object keys sorted, no whitespace, UTF-8, and only values every implementation encodes the
same way: no floats, integers within ±(2^53-1), ASCII member names. Two builds of the same
document therefore hash to the same digest.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

MAX_SAFE_INTEGER = 2**53 - 1
DIGEST_PREFIX = "sha256:"


class CanonicalizationError(ValueError):
    """A value is outside the canonical JSON subset."""


def _check(value: Any, path: str) -> None:
    if value is None or isinstance(value, bool | str):
        return
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            raise CanonicalizationError(f"{path}: integer outside the safe range ±(2^53-1)")
        return
    if isinstance(value, float):
        raise CanonicalizationError(f"{path}: floating-point numbers are not allowed")
    if isinstance(value, list | tuple):
        for index, item in enumerate(value):
            _check(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or not key.isascii():
                raise CanonicalizationError(f"{path}: object member names must be ASCII strings")
            _check(item, f"{path}.{key}")
        return
    raise CanonicalizationError(f"{path}: {type(value).__name__} is not a JSON value")


def canonical_bytes(value: Any) -> bytes:
    _check(value, "$")
    text = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )
    return text.encode("utf-8")


def digest(value: Any) -> str:
    """``sha256:<hex>`` over the canonical form of ``value``."""
    return DIGEST_PREFIX + hashlib.sha256(canonical_bytes(value)).hexdigest()

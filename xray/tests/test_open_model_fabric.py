"""Acceptance check against a real checkout of Open-model-fabric, when one is available.

Set ``XRAY_OMF_ROOT`` to its path, or keep it next to this repository.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from repo_xray import analyze

OMF_ROOT = Path(
    os.environ.get("XRAY_OMF_ROOT", Path(__file__).resolve().parents[3] / "Open-model-fabric")
)
ROUTING = "python/omf/core/services/routing.py"

pytestmark = pytest.mark.skipif(
    not (OMF_ROOT / ROUTING).is_file(), reason="Open-model-fabric checkout not found"
)


def test_routing_service_dependents() -> None:
    analysis = analyze(OMF_ROOT)
    report = analysis.impact(ROUTING)

    assert report["target"]["layer"] == "core"
    # The two modules that import the router directly.
    assert set(report["direct"]) >= {
        "python/omf/bootstrap/container.py",
        "python/omf/core/services/inference.py",
    }
    affected = {e["path"]: e for e in report["affected"]}
    # The API reaches routing through the container and the inference service.
    assert affected["apps/api/omf_api/app.py"]["layer"] == "presentation"
    assert affected["tests/unit/test_routing_and_inference.py"]["layer"] == "tests"
    # The core never imports adapters in this codebase.
    assert not [
        v
        for v in analysis.layers()["violations"]
        if (v["from_layer"], v["to_layer"]) == ("core", "adapters")
    ]

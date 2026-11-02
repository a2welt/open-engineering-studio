"""Run a seeded OpenAgentTrust gateway for the Studio's Trust screen.

Starts ``oat serve`` in-process with demo identities and a policy for a coding agent
working on Open-model-fabric, then plays the agent: it reads files and runs tests
(allowed), tries to edit CI (denied), and asks to edit the routing service (needs
approval). When you approve in the Studio, the agent "makes the edit" and reports the
outcome, so the receipt appears in the activity log.

Run it with OpenAgentTrust from a sibling checkout::

    uv run --project ../open-agent-trust python scripts/oat_demo.py

It writes keys and the ledger to ``.oat-demo/`` and, if ``web/.env.local`` does not exist,
creates it with ``VITE_OAT_MODE=http`` and the API token so ``npm run dev`` connects.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import secrets
import threading
from datetime import timedelta
from pathlib import Path
from typing import Any

from openagenttrust import Gateway, Ledger, Policy, Scope, SigningKey, issue_delegation
from openagenttrust.requests import create_request
from openagenttrust.server import GatewayService, make_server, serve

ROOT = Path(__file__).resolve().parents[1]
OMF = "git+https://github.com/findajay/Open-model-fabric@b5680964319da1ec4a7963ab7e65ebd01d1aaec5"
ROUTING = "python/omf/core/services/routing.py"


def read_env(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    pairs = (line.split("=", 1) for line in path.read_text(encoding="utf-8").splitlines())
    return {k.strip(): v.strip() for k, v in (p for p in pairs if len(p) == 2)}


def load_or_create(path: Path, name: str) -> SigningKey:
    if path.exists():
        return SigningKey.load(path)
    key = SigningKey.generate(name)
    key.save(path)
    return key


def policy_for(approver: SigningKey) -> dict[str, Any]:
    return {
        "id": "studio-demo@1",
        "default": "deny",
        "rules": [
            {"id": "read-anything", "effect": "allow", "actions": ["mcp.repo.read_file"]},
            {"id": "tests-allowed", "effect": "allow", "actions": ["mcp.repo.run_tests"]},
            {
                "id": "protect-ci",
                "effect": "deny",
                "actions": ["mcp.repo.write_file"],
                "resources": [".github/*"],
                "description": "CI configuration is never changed by agents",
            },
            {
                "id": "core-services-need-review",
                "effect": "require_approval",
                "actions": ["mcp.repo.write_file"],
                "resources": ["python/omf/core/*"],
                "approvers": [approver.key_id],
                "description": "Changes to core services need a human review",
            },
        ],
    }


class Agent:
    """Plays the coding agent: submits requests and reports outcomes like the MCP proxy."""

    def __init__(self, service: GatewayService, key: SigningKey, chain: list[dict[str, Any]]):
        self.service, self.key, self.chain = service, key, chain

    def submit(self, action: str, resource: str, **arguments: Any) -> dict[str, Any]:
        request = create_request(self.key, action, resource, {"path": resource, **arguments})
        return self.service.submit({"request": request, "delegation_chain": self.chain})

    def run(self, action: str, resource: str, result: Any, **arguments: Any) -> dict[str, Any]:
        submitted = self.submit(action, resource, **arguments)
        if submitted["status"] == "allowed":
            return self.service.report_outcome(submitted["id"], {"result": result})
        return submitted

    def wait_and_edit(self, action_id: str) -> None:
        while True:
            state = self.service.action(action_id, wait=30)
            if state["status"] == "allowed":
                self.service.report_outcome(action_id, {"result": {"edited": ROUTING}})
                print(f"agent: edited {ROUTING} after approval", flush=True)
                return
            if state["status"] != "pending_approval":
                print(f"agent: {ROUTING} edit {state['status']}", flush=True)
                return


def seed(agent: Agent) -> str:
    agent.run("mcp.repo.read_file", "python/omf/core/services/router_rules.py", {"lines": 120})
    agent.run("mcp.repo.run_tests", "tests/unit", {"passed": 214, "failed": 0})
    agent.submit("mcp.repo.write_file", ".github/workflows/ci.yml")
    pending = agent.submit(
        "mcp.repo.write_file",
        ROUTING,
        references=[f"{OMF}#{ROUTING}", "recall:memory:3f0c9d2e-8b1a-4c5e-9a77-2d4e6f1b0c13"],
        change={"lines_added": 18, "lines_removed": 6, "tests_passed": True},
    )
    return str(pending["id"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dir", type=Path, default=ROOT / ".oat-demo")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    args.dir.mkdir(parents=True, exist_ok=True)

    org = load_or_create(args.dir / "org.json", "acme-engineering")
    agent_key = load_or_create(args.dir / "agent.json", "coding agent")
    approver = load_or_create(args.dir / "approver.json", "you")
    gateway_key = load_or_create(args.dir / "gateway.json", "studio-gateway")
    chain = [
        issue_delegation(
            org,
            agent_key.key_id,
            Scope(actions=["mcp.repo.*"], resources=["*"]),
            expires_in=timedelta(hours=12),
            subject_name="coding agent",
        )
    ]
    (args.dir / "trust.json").write_text(
        json.dumps({"trust_anchors": [org.key_id], "gateways": [gateway_key.key_id]}, indent=2),
        encoding="utf-8",
    )
    gateway = Gateway(
        gateway_key,
        Policy.from_mapping(policy_for(approver)),
        trust_anchors=[org.key_id],
        ledger=Ledger(args.dir / "ledger.jsonl"),
    )
    service = GatewayService(gateway, approver_key=approver, approval_timeout=timedelta(hours=1))

    env_local = ROOT / "web" / ".env.local"
    existing = read_env(env_local)
    token = (
        os.environ.get("OAT_API_TOKEN")
        or existing.get("OAT_API_TOKEN")
        or secrets.token_urlsafe(32)
    )
    if not env_local.exists():
        env_local.write_text(
            f"VITE_OAT_MODE=http\nOAT_TARGET=http://127.0.0.1:{args.port}\nOAT_API_TOKEN={token}\n",
            encoding="utf-8",
        )
        print(f"wrote {env_local} (VITE_OAT_MODE=http, OAT_TARGET and the API token)")
    elif existing.get("OAT_API_TOKEN") != token:
        print(
            f"{env_local} has a different OAT_API_TOKEN; the Studio will get 401 until they match"
        )

    server = make_server(service, token=token, port=args.port)
    pending = seed(Agent(service, agent_key, chain))
    threading.Thread(
        target=Agent(service, agent_key, chain).wait_and_edit, args=(pending,), daemon=True
    ).start()
    print(f"oat serve on http://127.0.0.1:{args.port}; approve the {ROUTING} edit in the Studio")
    with contextlib.suppress(KeyboardInterrupt):
        serve(server, service)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

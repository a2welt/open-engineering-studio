# OpenAgentTrust HTTP API the Studio expects (draft)

**Status:** draft. `oat serve` is being built in parallel in the
[open-agent-trust](https://github.com/findajay/open-agent-trust) repository. The Trust screen
talks to it through a typed client (`web/src/api/oat/`) with a mock, so this contract can move:
every path below is configurable with `VITE_OAT_PATHS`, and the client tolerates either a bare
JSON array or an envelope object for list endpoints.

Bodies are JSON with snake_case members. Errors are any non-2xx status with
`{"error": "<message>"}` (or `{"detail": ...}`).

| Key in `VITE_OAT_PATHS` | Default path | Method | Purpose |
|---|---|---|---|
| `pendingApprovals` | `/v1/approvals?status=pending` | GET | Requests whose policy decision is `require_approval` and that nobody has decided yet |
| `approve` | `/v1/approvals/{id}/approve` | POST | Approve, sign the approval with the configured approver key, let the gateway execute |
| `reject` | `/v1/approvals/{id}/reject` | POST | Reject; the gateway records a `not_executed` receipt |
| `activity` | `/v1/activity` | GET | Recent requests, newest first |
| `receipt` | `/v1/receipts/{digest}` | GET | One receipt, looked up by its digest (`sha256:…`) |
| `verify` | `/v1/verify` | POST | Run the checks of `oat proof verify` on a receipt |
| `ledger` | `/v1/ledger` | GET | The receipt ledger as JSON Lines |

## Bodies

`GET pendingApprovals` → `{"approvals": [PendingApproval]}`

```json
{
  "id": "req-0914-routing",
  "request_digest": "sha256:…",
  "agent_name": "coding agent",
  "action": "repo.edit",
  "resource": "python/omf/core/services/routing.py",
  "rule_id": "core-services-need-review",
  "reason": "Changes to core services need a human review.",
  "requested_at": "2026-11-02T09:14:00Z",
  "references": ["git+https://github.com/findajay/Open-model-fabric@<commit>#python/omf/core/services/routing.py"],
  "change": {"lines_added": 18, "lines_removed": 6, "tests_passed": true}
}
```

`references` is `request.arguments.references` (see OpenAgentTrust's
`docs/integration/shared-references.md`). `change` is optional context the gateway may have.

`POST approve` / `POST reject` with `{"reason": "…"}` (optional) →
`{"status": "executed" | "rejected", "receipt_digest": "sha256:…" | null}`

`GET activity` → `{"entries": [ActivityEntry]}`

```json
{
  "id": "req-0912-read",
  "at": "2026-11-02T09:12:00Z",
  "agent_name": "coding agent",
  "action": "repo.read",
  "resource": "core/services/**",
  "effect": "allow | deny | require_approval | null",
  "status": "executed | denied | rejected | pending | refused",
  "receipt_digest": "sha256:… | null",
  "verified": true,
  "note": null
}
```

`effect` is null and `status` is `refused` when the gateway refused the request before policy
ran (outside the agent's delegated authority), so no receipt exists.

`GET receipt` → `{"digest": "sha256:…", "receipt": <AgentProof v0.1 receipt>}` (a bare receipt
document is accepted too).

`POST verify` with `{"receipt": <AgentProof v0.1 receipt>}` → the `to_dict()` of
`openagenttrust.verify.Report`: `{"ok": true, "checks": [{"name", "status", "detail"}]}`.

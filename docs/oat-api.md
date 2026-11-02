# How the Studio uses the OpenAgentTrust API

The Trust screen talks to `oat serve`, the HTTP API of the
[OpenAgentTrust](https://github.com/findajay/open-agent-trust) gateway. The API itself is
documented in that repository's `docs/gateway-api.md`; this page only says which parts the
Studio uses and how. The client is `web/src/api/oat/http.ts`; `web/src/api/oat/mock.ts` stands
in when `VITE_OAT_MODE` is not `http`.

| Studio needs | Endpoint (default path, `VITE_OAT_PATHS` key) |
|---|---|
| Approval cards | `GET /v1/approvals` (`pendingApprovals`) |
| Approve / Reject | `POST /v1/approvals/{id}` with `{decision: "approved" \| "rejected", reason?}` (`decide`) |
| Activity log | `GET /v1/receipts?limit=50` (`receipts`) plus `GET /v1/actions` (`actions`) for actions that have no receipt yet |
| Receipt panel | `GET /v1/receipts/{digest}` (`receipt`) and `POST /v1/verify` (`verify`) |
| Export ledger | `GET /v1/ledger` (`ledger`), JSON Lines |

## Statuses

The activity log reads each receipt's decision, approval and outcome:

| Receipt or action | Shown as |
|---|---|
| outcome `succeeded` | Allowed |
| outcome `failed` (`ToolError`, `McpError`, …) | Failed |
| outcome `failed` with `OutcomeNotReported`, or `require_approval` never decided | Expired |
| `not_executed` with a rejected approval | Rejected |
| `not_executed` otherwise | Denied |
| action `pending_approval` (no receipt yet) | Needs approval |
| action `allowed` (approved or allowed, the agent is running it) | Running |

## Approvals and the token

`oat serve` signs approvals made through the API with its `--approver-key`, so the API token
is what identifies the person approving. The Vite dev server's `/oat` proxy adds
`Authorization: Bearer $OAT_API_TOKEN` to every request. `OAT_API_TOKEN` has no `VITE_`
prefix, so Vite never puts it in the browser bundle. A production deployment needs the same
arrangement: a server-side proxy that authenticates the user and adds the token.

## Display fields

`agent_name` comes from the delegation chain's last link, and `references` from
`request.arguments.references` (see OpenAgentTrust's `docs/integration/shared-references.md`).
An approval card shows `request.arguments.change` (`lines_added`, `lines_removed`,
`tests_passed`) when the agent sent it.

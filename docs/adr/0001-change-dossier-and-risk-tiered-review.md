# ADR 0001: Change dossiers and risk-tiered review

- Status: proposed
- Date: 2026-11-02

## Context

When agents write a large share of the code, parts of the usual engineering lifecycle stop
working:

- **Review doesn't scale.** Agents open more changes than people can read line by line, so
  reviews either become a bottleneck or turn into rubber stamps.
- **Authorship stops meaning accountability.** "Who wrote this line" is an agent. What matters
  is who authorized the agent, within which limits, and who approved the result.
- **The "why" gets lost.** Intent lives in prompts and chat threads that nobody keeps, so the
  next person (or agent) can't tell which decision a change implements or must respect.
- **Tests can be self-confirming.** An agent that writes both the code and its tests can
  encode its own misunderstanding in both.
- **Model calls are a new cost and a new dependency** that no lifecycle step accounts for.
- **Regulation asks for provenance.** The EU AI Act and the Cyber Resilience Act push teams to
  show how AI-made changes were controlled.

Other parts matter more than before: version control, CI, tests, review gates, release
management and incident response. They are where agent output gets checked.

The Studio already connects four tools that each hold one piece of the evidence: Repo X-Ray
(what a change affects), OpenAgentTrust (what agents were allowed to do, as signed receipts),
Recall (engineering decisions) and BallastOS (model calls and their cost). They reference each
other with the shared reference URIs in OpenAgentTrust's
`docs/integration/shared-references.md`. What is missing is one place where a change's evidence
comes together, and a review process that uses it.

## Decision

### 1. Every change gets a change dossier

A **change dossier** is a JSON document, `studio.dossier/v0`, assembled for one change (a
pull request). It collects references to evidence the tools already hold; it does not copy
the evidence or replace any tool.

| Member | Content | Source |
|---|---|---|
| `change` | repository, base and head commits, PR URL, author | Git, GitHub |
| `intent` | decisions the change implements or must respect (`recall:memory:…`), linked issue | Recall, PR |
| `impact` | changed files, transitive dependents, layers and components touched, digest of the X-Ray result | Repo X-Ray |
| `actions` | receipts of the agent actions behind the change (`agentproof:sha256:…`), with their verification result | OpenAgentTrust |
| `model_calls` | gateway request ids (`omf:request:…`, `ballast:request:…`), models used, tokens and cost | BallastOS, Open Model Fabric |
| `verification` | CI results, tests run, which tests the same agent changed, receipt and ledger checks | CI, OpenAgentTrust |
| `risk` | the tier (below) and the rule that set it | Studio |
| `approvals` | signed AgentProof approvals and GitHub reviews | OpenAgentTrust, GitHub |
| `gaps` | evidence that is missing, such as an agent edit without a receipt or no linked decision | Studio |

Rules:

- **Derived, not authoritative.** Anyone with access to the tools can rebuild a dossier from
  its references. Its `digest` covers the canonical JSON (the AgentProof canonical form), so
  two builds can be compared. The sources stay the source of truth.
- **No prompts or model output.** Model calls appear as request ids, digests and cost. That
  keeps confidential prompts and code out of the dossier, so it can be shared with auditors.
- **Gaps are shown, not hidden.** A change with missing evidence still gets a dossier. The
  `gaps` list is what reviewers and the risk tier act on.

Example (shortened):

```json
{
  "type": "studio.dossier/v0",
  "change": {
    "repository": "https://github.com/findajay/Open-model-fabric",
    "base": "b5680964319da1ec4a7963ab7e65ebd01d1aaec5",
    "head": "…",
    "pull_request": "github:pr:findajay/Open-model-fabric#42"
  },
  "intent": ["recall:memory:3f0c9d2e-8b1a-4c5e-9a77-2d4e6f1b0c13"],
  "impact": {
    "xray_digest": "sha256:…",
    "changed": ["python/omf/core/services/routing.py"],
    "dependents": 5,
    "layers": ["core"],
    "components": ["services"]
  },
  "actions": [{"ref": "agentproof:sha256:…", "verified": true}],
  "model_calls": [{"ref": "ballast:request:…", "model": "…", "cost_usd_micros": 41000}],
  "verification": {"ci": "passed", "tests_changed_by_agent": ["tests/unit/test_routing.py"]},
  "risk": {"tier": "high", "rule": "core-layer"},
  "approvals": [{"ref": "agentproof:sha256:…", "decision": "approved"}],
  "gaps": [],
  "digest": "sha256:…"
}
```

### 2. Review depth follows risk, decided deterministically

Each change gets a **risk tier**, computed from the dossier by rules, not by a model:

| Tier | Typical trigger | Gate |
|---|---|---|
| `low` | docs, tests only, or files with no dependents outside their component | CI and complete evidence; merges without a human review |
| `medium` | dependents within one layer | one human review of the dossier summary |
| `high` | core layer, public API, many dependents, or tests changed by the same agent | a signed approval from a listed approver |
| `critical` | CI, security, release or infrastructure paths; any evidence gap on a `high` change | a signed approval from two approvers |

The tier rules are an OpenAgentTrust policy over a `change.merge` action, with the touched
layers and paths as resources. Teams already write and review those policies, the evaluation
is deterministic, and the merge decision gets an AgentProof receipt like any other action. A
model may summarize a change for the reviewer, but never sets the tier or the gate.

### 3. Delivered where teams already work

- **GitHub first:** a GitHub Action builds the dossier on each pull request, uploads it, posts
  a check run with the tier and the gate, and a short PR comment with the summary and gaps.
- **Studio:** a "Changes" screen lists open changes by tier and shows each dossier, linked to
  the Understand, Trust and Remember screens.
- **No new project-management tool.** Issues stay in GitHub, Jira or Linear; the dossier links
  to them.

## Alternatives considered

- **A new AI-era lifecycle methodology or project-management product.** Rejected: teams won't
  replace their process and tools, and the value is in evidence and gates, not in new
  ceremonies.
- **Putting change-level data into AgentProof receipts.** Rejected: a receipt records one
  action and must stay small and stable as a protocol. A change spans many actions, people
  and tools, so it gets its own document that references receipts.
- **A model that scores risk or reviews code as the gate.** Rejected as a gate: it is not
  reproducible and can be argued with by the code it reviews. Allowed as advisory text.
- **A central evidence database.** Rejected for now: the tools already store their evidence,
  and references keep them independent. Revisit if dossier builds become slow.

## Consequences

- **Receipts must be findable per change.** Agent requests need to carry the change they
  belong to. Add a pull request reference kind (`github:pr:<owner>/<repo>#<number>`) to the
  shared references, let `oat mcp-proxy` add configured references to every request
  (`--reference`), and add `GET /v1/receipts?reference=…` to `oat serve`.
- **Repo X-Ray must diff two commits.** It needs `xray impact --base A --head B` and a stable,
  digestible JSON output.
- **BallastOS must expose request ids and cost per call** in its ledger API, which Phase 2
  already starts.
- **Tier policies become something teams maintain**, with examples per stack, and the
  defaults need to be conservative.
- **New things to secure:** the GitHub Action reads other tools with tokens and must stay
  read-only; dossiers may name internal paths, so they inherit the repository's visibility.

## Plan: Phase 3

Prerequisite: Phase 2 (memory graph, live BallastOS savings, the scripted Open-model-fabric
demo) is done. Sizes assume one developer.

| Step | Work | Repository | Size |
|---|---|---|---|
| 1 | `studio.dossier/v0` JSON Schema, canonical digest, `studio dossier build --base --head` CLI | open-engineering-studio | 1 week |
| 2 | PR reference kind; `--reference` on `oat mcp-proxy`; receipt lookup by reference in `oat serve` | open-agent-trust | 3 days |
| 3 | Commit-to-commit impact and stable output in Repo X-Ray | open-engineering-studio | 3 days |
| 4 | Risk tiers as an OpenAgentTrust policy over `change.merge`, default tier policy, receipted merge decision | both | 1 week |
| 5 | GitHub Action: build, upload, check run, PR comment | open-engineering-studio | 1 week |
| 6 | Studio "Changes" screen | open-engineering-studio | 1 week |
| 7 | Pilot with 2 or 3 teams (A2Welt consulting clients), then revise the schema to v1 | — | 4 to 6 weeks |

What the pilot measures:

- review time per change, by tier
- share of changes that merge at `low` without a human review
- defects found after merge, by tier (to check that `low` is safe)
- evidence gaps per change, and how they trend

## Open questions

- Should the Studio sign dossiers, or is the digest over signed sources enough?
- Where should dossiers live: as CI artifacts, in a `refs/notes` entry, or in an evidence store?
- How should one change that spans several repositories be represented?
- Which Jira and Linear integrations do pilot teams actually need?

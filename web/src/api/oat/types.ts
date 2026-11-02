// Typed view of the OpenAgentTrust HTTP API (`oat serve`) that the Trust screen needs.
//
// Wire bodies are snake_case JSON as documented in open-agent-trust's
// docs/gateway-api.md; the HTTP client maps them to the camelCase types below. Paths
// can be overridden with VITE_OAT_PATHS for a gateway mounted elsewhere.

export interface OatPaths {
  /** GET: actions awaiting a human decision. */
  pendingApprovals: string;
  /** POST {decision, reason?}: approve or reject; the server signs with its approver key. */
  decide: string;
  /** GET: actions the server still holds (pending, running, recently finished). */
  actions: string;
  /** GET: receipts, newest first. */
  receipts: string;
  /** GET: one receipt by digest or reference. */
  receipt: string;
  /** POST {receipt}: run the independent verification checks. */
  verify: string;
  /** GET: the receipt ledger as JSON Lines. */
  ledger: string;
}

export const DEFAULT_OAT_PATHS: OatPaths = {
  pendingApprovals: '/v1/approvals',
  decide: '/v1/approvals/{id}',
  actions: '/v1/actions',
  receipts: '/v1/receipts?limit=50',
  receipt: '/v1/receipts/{digest}',
  verify: '/v1/verify',
  ledger: '/v1/ledger',
};

export type Effect = 'allow' | 'deny' | 'require_approval';

export interface PendingApproval {
  id: string;
  requestDigest: string;
  agentName: string;
  action: string;
  resource: string;
  ruleId: string | null;
  reason: string;
  requestedAt: string;
  /** Reference URIs from request.arguments.references (shared-references.md). */
  references: string[];
  change: { linesAdded: number; linesRemoved: number; testsPassed: boolean | null } | null;
}

export type ActivityStatus =
  | 'executed'
  | 'running'
  | 'failed'
  | 'denied'
  | 'rejected'
  | 'pending'
  | 'expired'
  | 'refused';

export interface ActivityEntry {
  id: string;
  at: string;
  agentName: string;
  action: string;
  resource: string;
  /** Policy effect, or null when the request was refused before policy ran. */
  effect: Effect | null;
  status: ActivityStatus;
  /** "sha256:…" digest of the receipt, or null when none was issued. */
  receiptDigest: string | null;
  /** Whether the receipt verified; null when not checked or no receipt. */
  verified: boolean | null;
  note: string | null;
}

export interface DelegationLink {
  name: string;
  keyId: string;
  actions: string[];
  resources: string[];
  expiresAt: string;
}

export interface ReceiptSummary {
  digest: string;
  id: string;
  issuedAt: string;
  agentName: string;
  action: string;
  resource: string;
  effect: Effect;
  ruleId: string | null;
  outcome: 'succeeded' | 'failed' | 'not_executed';
  approval: { decision: 'approved' | 'rejected'; decidedAt: string } | null;
  /** Key id of the trust anchor that issued the first delegation. */
  trustAnchor: string;
  chain: DelegationLink[];
  references: string[];
  /** The full AgentProof receipt, for download and re-verification. */
  document: Record<string, unknown>;
}

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface VerificationCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface VerificationReport {
  ok: boolean;
  checks: VerificationCheck[];
}

export interface DecisionResult {
  status: ActivityStatus;
  receiptDigest: string | null;
}

export interface OatClient {
  readonly mode: 'http' | 'mock';
  pendingApprovals(): Promise<PendingApproval[]>;
  approve(id: string, reason?: string): Promise<DecisionResult>;
  reject(id: string, reason?: string): Promise<DecisionResult>;
  activity(): Promise<ActivityEntry[]>;
  receipt(digest: string): Promise<ReceiptSummary>;
  verify(receipt: Record<string, unknown>): Promise<VerificationReport>;
  ledger(): Promise<string>;
}

export class OatError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'OatError';
    this.status = status;
  }
}

/** Display names for gateway actions; unknown actions show as-is. */
export const ACTION_LABELS: Record<string, string> = {
  'repo.read': 'Read',
  'repo.edit': 'Edit',
  'tests.run': 'Run tests',
  'secrets.read': 'Read secret',
  // Tool calls through `oat mcp-proxy --server repo` (scripts/oat_demo.py).
  'mcp.repo.read_file': 'Read',
  'mcp.repo.write_file': 'Edit',
  'mcp.repo.run_tests': 'Run tests',
};

/** Display names for the checks `oat proof verify` runs (openagenttrust/verify.py). */
export const CHECK_LABELS: Record<string, string> = {
  structure: 'Structure',
  'gateway-trusted': 'Trusted gateway',
  'gateway-signature': 'Gateway signature',
  'request-digest': 'Request digest',
  'agent-signature': 'Agent signature',
  timing: 'Timing',
  'delegation-chain': 'Delegation chain',
  'delegation-scope': 'Delegation scope',
  'policy-decision': 'Policy decision',
  approval: 'Approval',
  enforcement: 'Enforcement',
};

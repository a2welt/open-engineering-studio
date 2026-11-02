// Typed view of the OpenAgentTrust HTTP API (`oat serve`) that the Trust screen needs.
//
// `oat serve` is being built in parallel, so every endpoint path is configurable
// (VITE_OAT_PATHS). Wire bodies are snake_case JSON as listed in docs/oat-api.md;
// the HTTP client maps them to the camelCase types below.

export interface OatPaths {
  /** GET: requests waiting for a human decision. */
  pendingApprovals: string;
  /** POST {reason?}: approve, sign the approval and let the gateway execute. */
  approve: string;
  /** POST {reason?}: reject; the gateway records a not-executed receipt. */
  reject: string;
  /** GET: recent decisions, newest first. */
  activity: string;
  /** GET: one receipt by digest, as the AgentProof document. */
  receipt: string;
  /** POST {receipt}: run the independent verification checks. */
  verify: string;
  /** GET: the receipt ledger as JSON Lines. */
  ledger: string;
}

export const DEFAULT_OAT_PATHS: OatPaths = {
  pendingApprovals: '/v1/approvals?status=pending',
  approve: '/v1/approvals/{id}/approve',
  reject: '/v1/approvals/{id}/reject',
  activity: '/v1/activity',
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

export type ActivityStatus = 'executed' | 'denied' | 'rejected' | 'pending' | 'refused';

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

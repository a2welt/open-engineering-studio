import {
  type ActivityEntry,
  type ActivityStatus,
  type DecisionResult,
  type DelegationLink,
  type OatClient,
  OatError,
  type OatPaths,
  type PendingApproval,
  type ReceiptSummary,
  type VerificationCheck,
  type VerificationReport,
} from './types';

type Json = Record<string, unknown>;

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const strOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const obj = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const strings = (value: unknown): string[] => list(value).filter((v): v is string => typeof v === 'string');

const REFERENCE_PREFIX = 'agentproof:';

/** `agentproof:sha256:…` → `sha256:…`; anything else unchanged. */
export const digestOf = (ref: string): string =>
  ref.startsWith(REFERENCE_PREFIX) ? ref.slice(REFERENCE_PREFIX.length) : ref;

/** Accept either a bare array or an envelope such as {"approvals": [...]}. */
function items(body: unknown, key: string): Json[] {
  const raw = Array.isArray(body) ? body : list(obj(body)[key] ?? obj(body).items);
  return raw.map(obj);
}

export function fillPath(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(values[name] ?? ''));
}

function effectOf(value: unknown): ActivityEntry['effect'] {
  return value === 'allow' || value === 'deny' || value === 'require_approval' ? value : null;
}

/** An `oat serve` action awaiting approval (older flat shapes are read too). */
export function parsePending(raw: Json): PendingApproval {
  const request = obj(raw.request);
  const decision = obj(raw.decision);
  const changeRaw = obj(request.arguments).change ?? raw.change;
  const change = changeRaw ? obj(changeRaw) : null;
  return {
    id: str(raw.id),
    requestDigest: str(raw.request_digest),
    agentName: str(raw.agent_name, str(raw.agent, 'agent')),
    action: str(raw.action),
    resource: str(raw.resource),
    ruleId: strOrNull(decision.rule_id ?? raw.rule_id),
    reason: str(decision.reason, str(raw.reason)),
    requestedAt: str(request.requested_at, str(raw.created_at, str(raw.requested_at))),
    references: strings(raw.references ?? obj(request.arguments).references),
    change: change && {
      linesAdded: Number(change.lines_added ?? 0),
      linesRemoved: Number(change.lines_removed ?? 0),
      testsPassed: typeof change.tests_passed === 'boolean' ? change.tests_passed : null,
    },
  };
}

/** What a receipt says happened, in the Trust screen's terms. */
export function receiptStatus(document: Json): ActivityStatus {
  const outcome = obj(document.outcome);
  const effect = str(obj(document.decision).effect);
  const approval = document.approval ? obj(document.approval) : null;
  switch (str(outcome.status)) {
    case 'succeeded':
      return 'executed';
    case 'failed':
      return outcome.error_type === 'OutcomeNotReported' ? 'expired' : 'failed';
    default:
      if (approval && approval.decision === 'rejected') return 'rejected';
      if (effect === 'require_approval') return 'expired';
      return 'denied';
  }
}

export function activityFromReceipt(ref: string, document: Json): ActivityEntry {
  const request = obj(document.request);
  const chain = list(document.delegation_chain).map(obj);
  const outcome = obj(document.outcome);
  return {
    id: str(document.id, ref),
    at: str(document.issued_at),
    agentName: str(chain.at(-1)?.subject_name, str(request.agent, 'agent')),
    action: str(request.action),
    resource: str(request.resource),
    effect: effectOf(obj(document.decision).effect),
    status: receiptStatus(document),
    receiptDigest: digestOf(ref),
    verified: null,
    note: strOrNull(outcome.error_type),
  };
}

/** An action the server holds that has no receipt yet (pending, or running after approval). */
export function activityFromAction(raw: Json): ActivityEntry {
  const status = str(raw.status);
  return {
    id: str(raw.id),
    at: str(raw.created_at),
    agentName: str(raw.agent_name, str(raw.agent, 'agent')),
    action: str(raw.action),
    resource: str(raw.resource),
    effect: effectOf(obj(raw.decision).effect),
    status: status === 'pending_approval' ? 'pending' : 'running',
    receiptDigest: null,
    verified: null,
    note: null,
  };
}

/** Read the parts of an AgentProof v0.1 receipt the receipt panel shows. */
export function summarizeReceipt(document: Json, digest: string): ReceiptSummary {
  const request = obj(document.request);
  const decision = obj(document.decision);
  const outcome = obj(document.outcome);
  const approval = document.approval ? obj(document.approval) : null;
  const chainDocs = list(document.delegation_chain).map(obj);
  const chain: DelegationLink[] = chainDocs.map((link) => ({
    name: str(link.subject_name, str(link.subject)),
    keyId: str(link.subject),
    actions: strings(obj(link.scope).actions),
    resources: strings(obj(link.scope).resources),
    expiresAt: str(link.expires_at),
  }));
  const effect = str(decision.effect, 'deny');
  const status = str(outcome.status, 'not_executed');
  return {
    digest,
    id: str(document.id),
    issuedAt: str(document.issued_at),
    agentName: chain.at(-1)?.name || str(request.agent),
    action: str(request.action),
    resource: str(request.resource),
    effect: effect === 'allow' || effect === 'require_approval' ? effect : 'deny',
    ruleId: strOrNull(decision.rule_id),
    outcome: status === 'succeeded' || status === 'failed' ? status : 'not_executed',
    approval: approval && {
      decision: str(approval.decision) === 'approved' ? 'approved' : 'rejected',
      decidedAt: str(approval.decided_at),
    },
    trustAnchor: str(chainDocs[0]?.issuer),
    chain,
    references: strings(obj(request.arguments).references),
    document,
  };
}

/**
 * Client for `oat serve`. The bearer token is not handled here: the Vite dev server's
 * /oat proxy adds it from OAT_API_TOKEN, so it never reaches the browser bundle.
 */
export class HttpOatClient implements OatClient {
  readonly mode = 'http' as const;
  private readonly baseUrl: string;
  private readonly paths: OatPaths;
  private readonly fetchFn: typeof fetch;

  constructor(baseUrl: string, paths: OatPaths, fetchFn: typeof fetch = (...args) => fetch(...args)) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.paths = paths;
    this.fetchFn = fetchFn;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const error = obj(body).error ?? obj(body).detail;
      throw new OatError(typeof error === 'string' ? error : response.statusText, response.status);
    }
    return response;
  }

  private async json(path: string, init?: RequestInit): Promise<unknown> {
    return (await this.request(path, { ...init, headers: { Accept: 'application/json', ...init?.headers } })).json();
  }

  private post(path: string, body: unknown): Promise<unknown> {
    return this.json(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async pendingApprovals(): Promise<PendingApproval[]> {
    return items(await this.json(this.paths.pendingApprovals), 'approvals').map(parsePending);
  }

  private async decide(id: string, decision: 'approved' | 'rejected', reason?: string): Promise<DecisionResult> {
    const action = obj(
      await this.post(fillPath(this.paths.decide, { id }), reason ? { decision, reason } : { decision }),
    );
    const ref = strOrNull(action.receipt_ref);
    return {
      status: str(action.status) === 'rejected' ? 'rejected' : 'running',
      receiptDigest: ref && digestOf(ref),
    };
  }

  approve(id: string, reason?: string): Promise<DecisionResult> {
    return this.decide(id, 'approved', reason);
  }

  reject(id: string, reason?: string): Promise<DecisionResult> {
    return this.decide(id, 'rejected', reason);
  }

  /** Receipts plus actions still waiting for a receipt, newest first. */
  async activity(): Promise<ActivityEntry[]> {
    const [receipts, actions] = await Promise.all([
      this.json(this.paths.receipts),
      this.json(this.paths.actions),
    ]);
    const done = items(receipts, 'receipts').map((entry) =>
      activityFromReceipt(str(entry.ref), obj(entry.receipt)),
    );
    const open = items(actions, 'actions')
      .filter((action) => !action.receipt)
      .map(activityFromAction);
    return [...open, ...done].sort((a, b) => b.at.localeCompare(a.at));
  }

  async receipt(digest: string): Promise<ReceiptSummary> {
    const body = obj(await this.json(fillPath(this.paths.receipt, { digest })));
    const document = body.receipt ? obj(body.receipt) : body;
    return summarizeReceipt(document, digestOf(str(body.ref, digest)));
  }

  async verify(receipt: Record<string, unknown>): Promise<VerificationReport> {
    const body = obj(await this.post(this.paths.verify, { receipt }));
    const checks = list(body.checks).map((raw): VerificationCheck => {
      const check = obj(raw);
      const status = str(check.status);
      return {
        name: str(check.name),
        status: status === 'pass' || status === 'skip' ? status : 'fail',
        detail: str(check.detail),
      };
    });
    return { ok: body.ok === true && checks.every((c) => c.status !== 'fail'), checks };
  }

  async ledger(): Promise<string> {
    return (await this.request(this.paths.ledger)).text();
  }
}

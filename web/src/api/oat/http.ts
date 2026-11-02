import {
  type ActivityEntry,
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

/** Accept either a bare array or an envelope such as {"approvals": [...]}. */
function items(body: unknown, key: string): Json[] {
  const raw = Array.isArray(body) ? body : list(obj(body)[key] ?? obj(body).items);
  return raw.map(obj);
}

export function fillPath(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(values[name] ?? ''));
}

export function parsePending(raw: Json): PendingApproval {
  const change = raw.change ? obj(raw.change) : null;
  return {
    id: str(raw.id),
    requestDigest: str(raw.request_digest),
    agentName: str(raw.agent_name, str(raw.agent, 'agent')),
    action: str(raw.action),
    resource: str(raw.resource),
    ruleId: strOrNull(raw.rule_id),
    reason: str(raw.reason),
    requestedAt: str(raw.requested_at),
    references: strings(raw.references),
    change: change && {
      linesAdded: Number(change.lines_added ?? 0),
      linesRemoved: Number(change.lines_removed ?? 0),
      testsPassed: typeof change.tests_passed === 'boolean' ? change.tests_passed : null,
    },
  };
}

export function parseActivity(raw: Json): ActivityEntry {
  const effect = str(raw.effect);
  return {
    id: str(raw.id),
    at: str(raw.at),
    agentName: str(raw.agent_name, str(raw.agent, 'agent')),
    action: str(raw.action),
    resource: str(raw.resource),
    effect: effect === 'allow' || effect === 'deny' || effect === 'require_approval' ? effect : null,
    status: (str(raw.status, 'executed') as ActivityEntry['status']),
    receiptDigest: strOrNull(raw.receipt_digest),
    verified: typeof raw.verified === 'boolean' ? raw.verified : null,
    note: strOrNull(raw.note),
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

  private async decide(template: string, id: string, reason?: string): Promise<DecisionResult> {
    const body = obj(await this.post(fillPath(template, { id }), reason ? { reason } : {}));
    return {
      status: parseActivity({ status: body.status }).status,
      receiptDigest: strOrNull(body.receipt_digest),
    };
  }

  approve(id: string, reason?: string): Promise<DecisionResult> {
    return this.decide(this.paths.approve, id, reason);
  }

  reject(id: string, reason?: string): Promise<DecisionResult> {
    return this.decide(this.paths.reject, id, reason);
  }

  async activity(): Promise<ActivityEntry[]> {
    return items(await this.json(this.paths.activity), 'entries').map(parseActivity);
  }

  async receipt(digest: string): Promise<ReceiptSummary> {
    const body = obj(await this.json(fillPath(this.paths.receipt, { digest })));
    const document = body.receipt ? obj(body.receipt) : body;
    return summarizeReceipt(document, str(body.digest, digest));
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

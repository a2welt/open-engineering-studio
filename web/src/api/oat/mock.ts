import { summarizeReceipt } from './http';
import {
  type ActivityEntry,
  type DecisionResult,
  type Effect,
  type OatClient,
  OatError,
  type PendingApproval,
  type ReceiptSummary,
  type VerificationReport,
} from './types';

// A sample session on Open-model-fabric, shaped like AgentProof v0.1 documents. Digests and
// key ids are placeholders (the mock signs nothing), and the UI labels the data as a sample.

const REPO = 'git+https://github.com/findajay/Open-model-fabric@b5680964319da1ec4a7963ab7e65ebd01d1aaec5';
const ROUTING = 'python/omf/core/services/routing.py';
const POLICY_DIGEST = fakeDigest('policy');
const ANCHOR = fakeKey('a2welt-anchor');
const PLANNER = fakeKey('planner-agent');
const CODER = fakeKey('coding-agent');

function fakeHex(seed: string, length: number): string {
  let h = 0x811c9dc5;
  let out = '';
  while (out.length < length) {
    for (const ch of seed + out.length) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out.slice(0, length);
}

function fakeDigest(seed: string): string {
  return `sha256:${fakeHex(seed, 64)}`;
}

function fakeKey(seed: string): string {
  return `ed25519:${fakeHex(seed, 43).replace(/[89]/g, 'A')}`;
}

function today(time: string): string {
  const date = new Date();
  const [h, m] = time.split(':').map(Number);
  date.setHours(h ?? 0, m ?? 0, 0, 0);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const CHAIN = [
  {
    type: 'agentproof.delegation/v0.1',
    id: 'del-planner',
    issuer: ANCHOR,
    subject: PLANNER,
    subject_name: 'planner-agent',
    scope: { actions: ['repo.*', 'tests.*'], resources: ['omf/*'] },
    may_delegate: true,
    not_before: today('08:00'),
    expires_at: today('18:00'),
    parent: null,
    signature: null,
  },
  {
    type: 'agentproof.delegation/v0.1',
    id: 'del-coder',
    issuer: PLANNER,
    subject: CODER,
    subject_name: 'coding agent',
    scope: { actions: ['repo.read', 'repo.edit', 'tests.run'], resources: ['omf/*'] },
    may_delegate: false,
    not_before: today('09:00'),
    expires_at: today('10:00'),
    parent: fakeDigest('del-planner'),
    signature: null,
  },
];

interface Seed {
  id: string;
  time: string;
  action: string;
  resource: string;
  effect: Effect | null;
  ruleId: string | null;
  status: ActivityEntry['status'];
  note?: string;
}

const SEEDS: Seed[] = [
  { id: 'req-0912-read', time: '09:12', action: 'repo.read', resource: 'core/services/**', effect: 'allow', ruleId: 'read-anything', status: 'executed' },
  { id: 'req-0912-test', time: '09:12', action: 'tests.run', resource: 'tests/unit', effect: 'allow', ruleId: 'tests-allowed', status: 'executed' },
  { id: 'req-0914-ci', time: '09:14', action: 'repo.edit', resource: '.github/workflows/ci.yml', effect: 'deny', ruleId: 'protect-ci', status: 'denied' },
  {
    id: 'req-0915-secret',
    time: '09:15',
    action: 'secrets.read',
   
    resource: 'OMF_ADMIN_TOKEN',
    effect: null,
    ruleId: null,
    status: 'refused',
    note: "Outside the agent's delegated authority, so the gateway refused it before policy ran.",
  },
];

function receiptDocument(seed: Seed, approval: 'approved' | 'rejected' | null, executed: boolean) {
  const request = {
    type: 'agentproof.request/v0.1',
    id: seed.id,
    agent: CODER,
    action: seed.action,
    resource: seed.resource,
    arguments: {
      path: seed.resource,
      references: seed.resource === ROUTING ? [`${REPO}#${ROUTING}`, 'recall:memory:adr-0003-capability-evidence'] : [],
    },
    requested_at: today(seed.time),
    nonce: fakeHex(`${seed.id}-nonce`, 24),
    signature: null,
  };
  return {
    type: 'agentproof.receipt/v0.1',
    id: `rcpt-${seed.id}`,
    issuer: fakeKey('gateway'),
    issued_at: today(seed.time),
    request,
    request_digest: fakeDigest(`${seed.id}-request`),
    delegation_chain: CHAIN,
    decision: {
      effect: seed.effect,
      policy_id: 'omf-default',
      policy_digest: POLICY_DIGEST,
      rule_id: seed.ruleId,
      approvers: seed.effect === 'require_approval' ? [fakeKey('ajay')] : [],
      reason: seed.ruleId ?? '',
    },
    approval: approval && {
      type: 'agentproof.approval/v0.1',
      id: `apr-${seed.id}`,
      approver: fakeKey('ajay'),
      request_digest: fakeDigest(`${seed.id}-request`),
      decision: approval,
      decided_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      reason: null,
      signature: null,
    },
    outcome: { status: executed ? 'succeeded' : 'not_executed', result_digest: null, error_type: null },
    model_evidence: [],
    prev: null,
    signature: null,
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockOatClient implements OatClient {
  readonly mode = 'mock' as const;
  private readonly latencyMs: number;
  private entries: ActivityEntry[];
  private pending: PendingApproval[];
  private receipts = new Map<string, Record<string, unknown>>();

  constructor(latencyMs = 250) {
    this.latencyMs = latencyMs;
    this.entries = SEEDS.map((seed) => this.record(seed)).reverse();
    this.pending = [
      {
        id: 'req-0914-routing',
        requestDigest: fakeDigest('req-0914-routing-request'),
        agentName: 'coding agent',
        action: 'repo.edit',
        resource: ROUTING,
        ruleId: 'core-services-need-review',
        reason: 'Changes to core services need a human review.',
        requestedAt: today('09:14'),
        references: [`${REPO}#${ROUTING}`, 'recall:memory:adr-0003-capability-evidence'],
        change: { linesAdded: 18, linesRemoved: 6, testsPassed: true },
      },
    ];
    this.entries.unshift({
      id: 'req-0914-routing',
      at: today('09:14'),
      agentName: 'coding agent',
      action: 'repo.edit',
      resource: ROUTING,
      effect: 'require_approval',
      status: 'pending',
      receiptDigest: null,
      verified: null,
      note: null,
    });
    this.entries.sort((a, b) => b.at.localeCompare(a.at));
  }

  private record(seed: Seed, approval: 'approved' | 'rejected' | null = null): ActivityEntry {
    let digest: string | null = null;
    if (seed.effect !== null) {
      const executed = seed.effect === 'allow' || approval === 'approved';
      digest = fakeDigest(`${seed.id}-${approval ?? 'receipt'}`);
      this.receipts.set(digest, receiptDocument(seed, approval, executed));
    }
    return {
      id: seed.id,
      at: today(seed.time),
      agentName: 'coding agent',
      action: seed.action,
      resource: seed.resource,
      effect: seed.effect,
      status: seed.status,
      receiptDigest: digest,
      verified: digest ? true : null,
      note: seed.note ?? null,
    };
  }

  async pendingApprovals(): Promise<PendingApproval[]> {
    await delay(this.latencyMs);
    return [...this.pending];
  }

  private async decide(id: string, decision: 'approved' | 'rejected'): Promise<DecisionResult> {
    await delay(this.latencyMs);
    const request = this.pending.find((p) => p.id === id);
    if (!request) throw new OatError(`no pending request ${id}`, 404);
    this.pending = this.pending.filter((p) => p.id !== id);
    const time = new Date(request.requestedAt);
    const seed: Seed = {
      id,
      time: `${time.getHours()}:${time.getMinutes()}`,
      action: request.action,
      resource: request.resource,
      effect: 'require_approval',
      ruleId: request.ruleId,
      status: decision === 'approved' ? 'executed' : 'rejected',
    };
    const entry = { ...this.record(seed, decision), at: new Date().toISOString() };
    this.entries = [entry, ...this.entries.filter((e) => e.id !== id)];
    return { status: entry.status, receiptDigest: entry.receiptDigest };
  }

  approve(id: string): Promise<DecisionResult> {
    return this.decide(id, 'approved');
  }

  reject(id: string): Promise<DecisionResult> {
    return this.decide(id, 'rejected');
  }

  async activity(): Promise<ActivityEntry[]> {
    await delay(this.latencyMs);
    return [...this.entries];
  }

  async receipt(digest: string): Promise<ReceiptSummary> {
    await delay(this.latencyMs);
    const document = this.receipts.get(digest);
    if (!document) throw new OatError(`no receipt ${digest}`, 404);
    return summarizeReceipt(document, digest);
  }

  async verify(receipt: Record<string, unknown>): Promise<VerificationReport> {
    await delay(this.latencyMs);
    const summary = summarizeReceipt(receipt, '');
    const approvalNeeded = summary.effect === 'require_approval';
    const pass = (name: string, detail: string) => ({ name, status: 'pass' as const, detail });
    return {
      ok: true,
      checks: [
        pass('structure', 'valid agentproof.receipt/v0.1'),
        pass('gateway-trusted', 'issued by a trusted gateway'),
        pass('gateway-signature', 'receipt signature valid'),
        pass('request-digest', 'request_digest matches the embedded request'),
        pass('agent-signature', 'request signed by the agent'),
        pass('timing', 'receipt issued after the request'),
        pass('delegation-chain', `${summary.chain.length}-link chain from a trust anchor to the agent`),
        pass('delegation-scope', 'every link permits the action and resource'),
        pass('policy-decision', `policy reproduces '${summary.effect}'`),
        approvalNeeded && summary.approval
          ? pass('approval', `${summary.approval.decision} by an authorised approver`)
          : { name: 'approval', status: 'skip', detail: 'no approval attached' },
        pass('enforcement', `outcome '${summary.outcome}' respects the decision`),
      ],
    };
  }

  async ledger(): Promise<string> {
    await delay(this.latencyMs);
    return [...this.receipts.values()].map((r) => JSON.stringify(r)).join('\n') + '\n';
  }
}

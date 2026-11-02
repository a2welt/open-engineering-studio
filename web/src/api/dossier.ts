// Change dossiers (studio.dossier/v0, ADR 0001): one record per pull request that references
// the evidence each tool holds. The Studio reads the fields below. Until dossiers are served,
// it shows these sample changes on Open-model-fabric, marked as samples.

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface DossierAction {
  ref: string;
  action: string | null;
  resource: string | null;
  status: string | null;
  verified: boolean | null;
}

export interface DossierGap {
  code: string;
  subject: string;
  detail: string;
}

export interface Dossier {
  type: 'studio.dossier/v0';
  /** Display title; a dossier names the change by its pull request. */
  title: string;
  change: { repository: string; head: string; pull_request: string | null; author: string | null };
  intent: string[];
  impact: { changed: string[]; dependents: number; layers: string[]; components: string[] } | null;
  actions: DossierAction[];
  model_calls: { ref: string; model?: string; cost_usd_micros?: number }[];
  verification: {
    ci: 'passed' | 'failed' | 'pending' | null;
    receipts: number;
    receipts_verified: number;
    tests_changed_by_agent: string[];
  };
  risk: { tier: RiskTier; rule: string } | null;
  approvals: { ref: string; approver: string | null; decision: 'approved' | 'rejected' | null }[];
  gaps: DossierGap[];
}

/** The evidence a dossier can hold, in lifecycle order. */
export const EVIDENCE = [
  { key: 'intent', label: 'Intent', has: (d: Dossier) => d.intent.length > 0 },
  { key: 'impact', label: 'Impact', has: (d: Dossier) => d.impact !== null },
  { key: 'actions', label: 'Agent receipts', has: (d: Dossier) => d.actions.length > 0 },
  { key: 'model', label: 'Model calls', has: (d: Dossier) => d.model_calls.length > 0 },
  {
    key: 'verify',
    label: 'Verification',
    has: (d: Dossier) =>
      d.verification.ci === 'passed' && d.verification.receipts_verified === d.verification.receipts,
  },
  { key: 'approval', label: 'Approval', has: (d: Dossier) => d.approvals.some((a) => a.decision === 'approved') },
] as const;

/** The merge gate each tier sets (ADR 0001, decision 2). */
export const GATES: Record<RiskTier, { approvals: number; label: string }> = {
  low: { approvals: 0, label: 'Merges with complete evidence' },
  medium: { approvals: 0, label: 'One review of the dossier' },
  high: { approvals: 1, label: 'One signed approval' },
  critical: { approvals: 2, label: 'Two signed approvals' },
};

/** What still blocks the merge, or null when the gate is met. */
export function blocker(dossier: Dossier): string | null {
  if (!dossier.risk) return 'Risk tier not computed yet';
  if (dossier.verification.ci === 'failed') return 'CI failed';
  if (dossier.verification.ci !== 'passed') return 'CI still running';
  const missing = GATES[dossier.risk.tier].approvals - dossier.approvals.filter((a) => a.decision === 'approved').length;
  if (missing > 0) return `Needs ${missing} signed approval${missing === 1 ? '' : 's'}`;
  if (dossier.gaps.length > 0) return `${dossier.gaps.length} evidence gap${dossier.gaps.length === 1 ? '' : 's'}`;
  return null;
}

const OMF = 'https://github.com/findajay/Open-model-fabric';
const ref = (n: number) => `agentproof:sha256:${n.toString(16).padStart(64, '0')}`;

export const SAMPLE_DOSSIERS: Dossier[] = [
  {
    type: 'studio.dossier/v0',
    title: 'Route only to providers with verified capabilities',
    change: { repository: OMF, head: 'b5680964', pull_request: 'github:pr:findajay/Open-model-fabric#42', author: 'coding agent' },
    intent: ['recall:memory:adr-0003'],
    impact: {
      changed: ['python/omf/core/services/routing.py'],
      dependents: 28,
      layers: ['core'],
      components: ['core/services'],
    },
    actions: [
      { ref: ref(1), action: 'mcp.repo.read_file', resource: 'python/omf/core/services/routing.py', status: 'succeeded', verified: true },
      { ref: ref(2), action: 'mcp.repo.run_tests', resource: 'tests/unit', status: 'succeeded', verified: true },
      { ref: ref(3), action: 'mcp.repo.write_file', resource: 'python/omf/core/services/routing.py', status: 'pending', verified: null },
    ],
    model_calls: [{ ref: 'ballast:request:7f3a', model: 'claude', cost_usd_micros: 41000 }],
    verification: { ci: 'passed', receipts: 2, receipts_verified: 2, tests_changed_by_agent: [] },
    risk: { tier: 'high', rule: 'core-layer' },
    approvals: [],
    gaps: [],
  },
  {
    type: 'studio.dossier/v0',
    title: 'Document the routing policy options',
    change: { repository: OMF, head: '9c41d2e0', pull_request: 'github:pr:findajay/Open-model-fabric#41', author: 'docs agent' },
    intent: ['recall:memory:adr-0004'],
    impact: { changed: ['docs/routing.md'], dependents: 0, layers: ['other'], components: ['docs'] },
    actions: [{ ref: ref(4), action: 'mcp.repo.write_file', resource: 'docs/routing.md', status: 'succeeded', verified: true }],
    model_calls: [{ ref: 'ballast:request:7f2c', model: 'claude', cost_usd_micros: 6000 }],
    verification: { ci: 'passed', receipts: 1, receipts_verified: 1, tests_changed_by_agent: [] },
    risk: { tier: 'low', rule: 'docs-only' },
    approvals: [],
    gaps: [],
  },
  {
    type: 'studio.dossier/v0',
    title: 'Speed up the CI cache',
    change: { repository: OMF, head: '2e7b90aa', pull_request: 'github:pr:findajay/Open-model-fabric#40', author: 'build agent' },
    intent: [],
    impact: { changed: ['.github/workflows/ci.yml'], dependents: 0, layers: ['other'], components: ['.github'] },
    actions: [],
    model_calls: [],
    verification: { ci: 'pending', receipts: 0, receipts_verified: 0, tests_changed_by_agent: [] },
    risk: { tier: 'critical', rule: 'ci-paths' },
    approvals: [],
    gaps: [
      { code: 'no-receipts', subject: 'github:pr:findajay/Open-model-fabric#40', detail: 'No agent receipts reference this change' },
      { code: 'no-intent', subject: 'github:pr:findajay/Open-model-fabric#40', detail: 'No decision explains this change' },
    ],
  },
];

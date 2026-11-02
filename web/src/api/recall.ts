// Recalled engineering decisions. The Recall API integration lands in Phase 2; until then
// this sample mirrors Open-model-fabric's ADRs so the Remember screen has real content.

export interface Decision {
  /** Reference URI, recall:memory:<id> (shared-references.md). */
  ref: string;
  key: string;
  title: string;
  decision: string;
  why: string;
  evidence: string;
  /** Code paths the decision constrains, as repository-relative paths. */
  paths: string[];
  keywords: string[];
}

export const SAMPLE_DECISIONS: Decision[] = [
  {
    ref: 'recall:memory:adr-0003-capability-evidence',
    key: 'ADR-0003',
    title: 'Capability evidence',
    decision: 'Capabilities carry evidence: verified, provider_reported or declared.',
    why: 'The UI and routing only offer what a model can really do.',
    evidence: 'docs/architecture/adr/0003-capability-evidence.md',
    paths: ['python/omf/core/services/routing.py', 'python/omf/core/domain/capabilities.py'],
    keywords: ['routing', 'capabilities'],
  },
  {
    ref: 'recall:memory:adr-0004-explicit-adapter-catalog',
    key: 'ADR-0004',
    title: 'Explicit adapter catalog, no dynamic loading',
    decision: 'Adapters are registered by name in the composition root; nothing is loaded by path.',
    why: 'Every provider the router can pick is visible in one reviewed file.',
    evidence: 'docs/architecture/adr/0004-explicit-adapter-catalog-no-dynamic-loading.md',
    paths: ['python/omf/bootstrap/container.py'],
    keywords: ['adapters', 'routing'],
  },
  {
    ref: 'recall:memory:adr-0013-tool-calling-passthrough',
    key: 'ADR-0013',
    title: 'Tool-calling passthrough',
    decision: 'Tool calls pass through to providers that support them instead of being emulated.',
    why: 'Emulated tool calls behave differently per model and hide failures.',
    evidence: 'docs/architecture/adr/0013-tool-calling-passthrough.md',
    paths: ['python/omf/core/services/inference.py'],
    keywords: ['tools', 'inference'],
  },
  {
    ref: 'recall:memory:adr-0001-modular-monolith-hexagonal',
    key: 'ADR-0001',
    title: 'Modular monolith, hexagonal',
    decision: 'One deployable with a core that depends only on ports; adapters implement them.',
    why: 'Providers and storage change often; the core should not.',
    evidence: 'docs/architecture/adr/0001-modular-monolith-hexagonal.md',
    paths: ['python/omf/core'],
    keywords: ['architecture'],
  },
];

export interface Recalled {
  decision: Decision;
  score: number;
  reasons: string[];
}

/** Rank decisions for a file: same file, then parent directory, keywords and neighbours. */
export function recallFor(path: string, neighbours: string[] = [], decisions = SAMPLE_DECISIONS): Recalled[] {
  const stem = path.split('/').pop()?.replace(/\.\w+$/, '') ?? '';
  return decisions
    .map((decision) => {
      let score = 0.3;
      const reasons: string[] = [];
      if (decision.paths.includes(path)) {
        score += 0.4;
        reasons.push('Same file');
      } else if (decision.paths.some((p) => path.startsWith(`${p}/`))) {
        score += 0.15;
        reasons.push('Same component');
      }
      if (decision.paths.some((p) => neighbours.includes(p))) {
        score += 0.2;
        reasons.push('Affected file');
      }
      if (stem && decision.keywords.includes(stem)) {
        score += 0.12;
        reasons.push(`Keyword "${stem}"`);
      }
      return { decision, score: Math.min(score, 0.99), reasons };
    })
    .filter((r) => r.reasons.length > 0)
    .sort((a, b) => b.score - a.score);
}

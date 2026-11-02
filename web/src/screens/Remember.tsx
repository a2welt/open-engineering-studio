import { useEffect, useId, useRef, useState } from 'react';

import { type Recalled, recallFor } from '../api/recall';
import { Ballast, Sage } from '../components/crew';
import { ChevronIcon, PlusIcon } from '../components/icons';

function DecisionCard({ recalled, open, onToggle }: { recalled: Recalled; open: boolean; onToggle: () => void }) {
  const bodyId = useId();
  const { decision, score, reasons } = recalled;
  const percent = Math.round(score * 100);
  return (
    <article className="decision">
      <h3>
        <button type="button" className="decision-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span className="chip purple">{decision.key}</span>{' '}
          <span>{decision.title}</span>{' '}
          <span className="score">{percent}% match</span>
          <ChevronIcon size={18} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
        </button>
      </h3>
      <div className="meter" role="img" aria-label={`${percent}% match`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      {open && (
        <div className="decision-body" id={bodyId}>
          <dl>
            <dt>Decision</dt>
            <dd>{decision.decision}</dd>
            <dt>Why</dt>
            <dd>{decision.why}</dd>
            <dt>Evidence</dt>
            <dd className="mono">{decision.evidence}</dd>
            <dt>Reference</dt>
            <dd className="mono">{decision.ref}</dd>
          </dl>
          <div className="chips">
            {reasons.map((reason) => (
              <span key={reason} className="chip outline">
                {reason}
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

const TECHNIQUES = [
  'Tool output optimization',
  'Duplicate removal',
  'History window',
  'Structured compaction',
  'Semantic pruning',
  'Prompt cache',
  'Output control',
];

interface RememberProps {
  target: string | null;
  neighbours: string[];
  focusSavings: boolean;
}

export function Remember({ target, neighbours, focusSavings }: RememberProps) {
  const recalled = target ? recallFor(target, neighbours) : [];
  const [open, setOpen] = useState<string | null>(recalled[0]?.decision.ref ?? null);
  const [noteShown, setNoteShown] = useState(false);
  const savingsRef = useRef<HTMLElement>(null);
  const fileName = target?.split('/').pop() ?? 'this code';

  useEffect(() => {
    if (focusSavings) {
      savingsRef.current?.scrollIntoView({ block: 'start' });
      savingsRef.current?.focus({ preventScroll: true });
    }
  }, [focusSavings]);

  return (
    <>
      <section aria-label="Sage" className="hero rise">
        <Sage size={72} className="float" />
        <div className="hero-text">
          <div className="eyebrow" style={{ color: 'var(--purple-text)' }}>
            Sage · Recall memory
          </div>
          <h2>
            Here's why <code style={{ fontSize: '0.85em' }}>{fileName}</code> works the way it does
          </h2>
          <p>
            {recalled.length
              ? `${recalled.length} ${recalled.length === 1 ? 'decision matches' : 'decisions match'} this file. Ranked by file, component, keywords and what it affects.`
              : 'No recorded decision mentions this file yet.'}
          </p>
        </div>
      </section>

      <div className="notice" role="status">
        Sample decisions from Open-model-fabric's ADRs. The Recall API connection arrives with the memory graph.
      </div>

      <div className="row">
        <section aria-label="Recalled decisions" className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {recalled.map((item) => (
            <DecisionCard
              key={item.decision.ref}
              recalled={item}
              open={open === item.decision.ref}
              onToggle={() => setOpen(open === item.decision.ref ? null : item.decision.ref)}
            />
          ))}
          <div>
            <button type="button" className="button tonal" onClick={() => setNoteShown(true)}>
              <PlusIcon size={18} />
              Remember a decision
            </button>
            {noteShown && (
              <p className="subtle" role="status">
                Recording decisions from the Studio comes with the Recall integration. Until then, use Recall directly.
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="graph-title" className="card side">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 id="graph-title">Memory graph</h2>
            <span className="chip blue">Preview</span>
          </div>
          <ul className="graph-edges" aria-label="Example links">
            <li>
              <span className="chip purple">ADR-0003</span>
              <span className="rel">constrains</span>
              <span className="mono">routing.py</span>
            </li>
            <li>
              <span className="chip purple">ADR-0004</span>
              <span className="rel">governs</span>
              <span className="mono">container.py</span>
            </li>
            <li>
              <span className="chip purple">ADR-0013</span>
              <span className="rel">shapes</span>
              <span className="mono">inference.py</span>
            </li>
            <li>
              <span className="chip green">Receipt</span>
              <span className="rel">changed</span>
              <span className="mono">routing.py</span>
            </li>
          </ul>
          <p className="subtle" style={{ margin: 0 }}>
            Placeholder. The graph will link decisions, code and agent receipts through shared reference URIs, so the
            next agent sees why the code is the way it is.
          </p>
        </section>
      </div>

      <section id="savings" ref={savingsRef} tabIndex={-1} aria-labelledby="savings-title" className="card">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
          <Ballast size={56} />
          <div style={{ flex: '1 1 240px' }}>
            <h2 id="savings-title">Token savings</h2>
            <p className="muted" style={{ margin: 0 }}>
              Ballast will route model calls through the BallastOS gateway.
            </p>
          </div>
          <span className="chip amber">Waiting for first measurements</span>
        </div>
        <div className="stats">
          {['Tokens saved', 'Cost saved', 'Model calls'].map((label) => (
            <div key={label} className="stat">
              <div className="label">{label}</div>
              <div className="value" aria-label={`${label}: no data yet`}>
                —
              </div>
            </div>
          ))}
        </div>
        <div className="chips" aria-label="Optimization techniques">
          {TECHNIQUES.map((t) => (
            <span key={t} className="chip outline">
              {t}
            </span>
          ))}
        </div>
        <p className="subtle" style={{ margin: 0 }}>
          Figures will come from the gateway's own savings ledger once connected. Nothing here is an estimate.
        </p>
      </section>
    </>
  );
}

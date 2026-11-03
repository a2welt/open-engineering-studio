import { useEffect, useState, type ReactNode } from 'react';

import { blocker, type Dossier, EVIDENCE, GATES, SAMPLE_DOSSIERS } from '../api/dossier';
import type { ActivityEntry, PendingApproval } from '../api/oat/types';
import { SAMPLE_DECISIONS } from '../api/recall';
import { Guard, Sage, Scout } from '../components/crew';
import { CheckIcon, GaugeIcon } from '../components/icons';
import { useServices } from '../services';
import { type Route, type XrayState } from '../state';

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

const prNumber = (ref: string | null) => (ref ? `#${ref.split('#').pop()}` : 'No PR');

interface Stage {
  step: number;
  title: string;
  question: string;
  metric: string;
  source: string;
  icon: ReactNode;
  route: Route;
  attention?: boolean;
}

function Pipeline({ stages, onNavigate }: { stages: Stage[]; onNavigate: (route: Route) => void }) {
  return (
    <ol className="pipeline" aria-label="Lifecycle of a change">
      {stages.map((stage) => (
        <li key={stage.title} className={stage.attention ? 'stage attention' : 'stage'}>
          <a
            href={`#/${stage.route}`}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(stage.route);
            }}
          >
            <span className="stage-head">
              <span className="stage-step" aria-hidden="true">
                {stage.step}
              </span>
              {stage.icon}
            </span>
            <span className="stage-title">{stage.title}</span>
            <span className="stage-question">{stage.question}</span>
            <span className="stage-metric">{stage.metric}</span>
            <span className="subtle">{stage.source}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

function EvidenceMeter({ dossier }: { dossier: Dossier }) {
  const present = EVIDENCE.filter((e) => e.has(dossier)).length;
  return (
    <span className="evidence" role="img" aria-label={`Evidence: ${present} of ${EVIDENCE.length}`}>
      {EVIDENCE.map((e) => (
        <span key={e.key} className={e.has(dossier) ? 'seg on' : 'seg'} title={`${e.label}: ${e.has(dossier) ? 'yes' : 'missing'}`} />
      ))}
    </span>
  );
}

function ChangeRow({ dossier }: { dossier: Dossier }) {
  const tier = dossier.risk?.tier;
  const blocked = blocker(dossier);
  return (
    <li className="change">
      <span className="change-main">
        <span className="change-title">
          <span className="mono subtle">{prNumber(dossier.change.pull_request)}</span> {dossier.title}
        </span>
        <span className="subtle">
          {dossier.change.author} · {dossier.impact ? plural(dossier.impact.changed.length, 'file') : 'impact unknown'}
          {dossier.impact && dossier.impact.dependents > 0 ? `, ${dossier.impact.dependents} dependents` : ''}
        </span>
      </span>
      <span className={`chip tier ${tier ?? 'none'}`}>{tier ? `${tier[0]!.toUpperCase()}${tier.slice(1)} risk` : 'No tier'}</span>
      <EvidenceMeter dossier={dossier} />
      <span className={blocked ? 'gate blocked' : 'gate ok'}>
        {blocked ? (
          blocked
        ) : (
          <>
            <CheckIcon size={16} /> Ready to merge
          </>
        )}
      </span>
    </li>
  );
}

interface LifecycleProps {
  xray: XrayState;
  onNavigate: (route: Route) => void;
}

export function Lifecycle({ xray, onNavigate }: LifecycleProps) {
  const { oat } = useServices();
  const [pending, setPending] = useState<PendingApproval[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([oat.pendingApprovals(), oat.activity()]).then(
      ([approvals, entries]) => {
        if (cancelled) return;
        setPending(approvals);
        setActivity(entries);
      },
      () => !cancelled && setPending([]),
    );
    return () => {
      cancelled = true;
    };
  }, [oat]);

  const dossiers = SAMPLE_DOSSIERS;
  const receipted = activity.filter((e) => e.receiptDigest).length;
  const layers = xray.layers?.layers.filter((l) => l.components.length > 0) ?? [];
  const files = layers.reduce((n, l) => n + l.files, 0);
  const passing = dossiers.filter((d) => d.verification.ci === 'passed').length;
  const ready = dossiers.filter((d) => !blocker(d)).length;
  const gaps = dossiers.flatMap((d) => d.gaps.map((g) => ({ ...g, change: d })));

  const stages: Stage[] = [
    { step: 1, title: 'Intent', question: 'Why change it?', metric: plural(SAMPLE_DECISIONS.length, 'decision'), source: 'Recall', icon: <Sage size={30} />, route: 'remember' },
    { step: 2, title: 'Impact', question: 'What does it touch?', metric: xray.layers ? `${plural(layers.length, 'layer')} · ${files} files` : 'Mapping…', source: 'Repo X-Ray', icon: <Scout size={30} />, route: 'understand' },
    { step: 3, title: 'Agent work', question: 'What did agents do?', metric: plural(receipted, 'signed receipt'), source: 'OpenAgentTrust', icon: <Guard size={30} />, route: 'trust' },
    { step: 4, title: 'Verify', question: 'Does the evidence hold?', metric: `${passing} of ${dossiers.length} changes pass CI`, source: 'CI + receipt checks', icon: <CheckIcon size={26} />, route: 'trust' },
    { step: 5, title: 'Review', question: 'Who must approve?', metric: pending ? `${plural(pending.length, 'approval')} waiting` : 'Checking…', source: 'Risk-tiered gate', icon: <GaugeIcon size={26} />, route: 'trust', attention: Boolean(pending?.length) },
    { step: 6, title: 'Remember', question: 'What should the next change know?', metric: `${dossiers.filter((d) => d.intent.length).length} changes linked`, source: 'Recall', icon: <Sage size={30} />, route: 'remember' },
  ];

  return (
    <>
      <section className="lifecycle-intro rise" aria-labelledby="lifecycle-title">
        <div>
          <div className="eyebrow">AI engineering lifecycle</div>
          <h2 id="lifecycle-title">Agents write the code. You keep the evidence.</h2>
          <p>
            Every change carries its why, what it touches, what agents did, how it was checked and who approved it. Review
            effort follows risk, so low-risk work flows and people focus where it matters.
          </p>
        </div>
        <div className="intro-actions">
          {pending && pending.length > 0 && (
            <a
              className="button filled"
              href="#/trust"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('trust');
              }}
            >
              Review {plural(pending.length, 'approval')}
            </a>
          )}
          <a
            className="button outlined"
            href="#/understand"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('understand');
            }}
          >
            Map a change
          </a>
        </div>
      </section>

      <Pipeline stages={stages} onNavigate={onNavigate} />

      <div className="row">
        <section className="card grow rise r2" aria-labelledby="changes-title">
          <div className="card-head">
            <h2 id="changes-title">Changes in flight</h2>
            <span className="muted">
              {ready} of {plural(dossiers.length, 'change')} ready to merge
            </span>
            <span className="chip outline" style={{ marginLeft: 'auto' }}>
              Sample changes
            </span>
          </div>
          <ul className="changes">
            {dossiers.map((d) => (
              <ChangeRow key={d.change.pull_request ?? d.title} dossier={d} />
            ))}
          </ul>
          <p className="subtle" style={{ margin: 0 }}>
            Each bar is a change dossier: {EVIDENCE.map((e) => e.label.toLowerCase()).join(', ')}. Tiers set the gate:{' '}
            {(['low', 'high', 'critical'] as const).map((t) => `${t}, ${GATES[t].label.toLowerCase()}`).join('; ')}.
          </p>
        </section>

        <aside className="card side rise r3" aria-labelledby="needs-title">
          <h2 id="needs-title">Needs you</h2>
          {pending === null && <p className="muted">Checking…</p>}
          {pending?.length === 0 && gaps.length === 0 && <p className="muted">Nothing right now.</p>}
          <ul className="needs">
            {pending?.map((p) => (
              <li key={p.id}>
                <a
                  href="#/trust"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate('trust');
                  }}
                >
                  <span className="chip amber">Approve</span>
                  <span>
                    <strong>{p.agentName}</strong> wants to change <code>{p.resource.split('/').pop()}</code>
                    <span className="subtle"> · {p.reason}</span>
                  </span>
                </a>
              </li>
            ))}
            {gaps.map((g) => (
              <li key={`${g.change.title}-${g.code}`}>
                <span className="chip red">Gap</span>
                <span>
                  <strong>{prNumber(g.change.change.pull_request)}</strong> {g.detail}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}

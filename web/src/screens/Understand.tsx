import { useId, useState, type FormEvent } from 'react';

import type { ImpactReport } from '../api/xray/types';
import { recallFor } from '../api/recall';
import { ArchitectureMap } from '../components/ArchitectureMap';
import { Sage, Scout } from '../components/crew';
import { SparkIcon } from '../components/icons';
import { type Route, type XrayState, repoName } from '../state';
import { useReducedMotion } from '../theme';

const ARCHITECTURE_LAYERS = ['presentation', 'core', 'adapters', 'composition'];

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function ImpactAnswer({ impact }: { impact: ImpactReport }) {
  const groups = new Map<number, string[]>();
  for (const item of impact.affected) {
    if (item.layer === 'tests') continue;
    groups.set(item.depth, [...(groups.get(item.depth) ?? []), item.path]);
  }
  const { summary } = impact;
  return (
    <div className="card" aria-live="polite">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Scout size={32} />
        <strong>Scout</strong>
        <span className="subtle">
          {summary.total === 0
            ? 'found nothing that imports this'
            : `found ${plural(summary.direct, 'directly affected file')}`}
        </span>
      </div>
      {summary.total > 0 && (
        <>
          {[...groups.entries()].map(([depth, paths]) => (
            <section key={depth} className="depth-group" aria-label={`Depth ${depth}`}>
              <h3>{depth === 1 ? 'Imports it directly' : `${depth} hops away`}</h3>
              <ul className="file-list">
                {paths.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            </section>
          ))}
          <p className="subtle" style={{ margin: 0 }}>
            {plural(summary.total, 'file')} in total across {plural(summary.components.length, 'component')}
            {summary.tests ? `, including ${plural(summary.tests, 'test file')} to rerun` : ''}.
          </p>
        </>
      )}
      {impact.target.ref && (
        <p className="subtle mono" style={{ margin: 0, overflowWrap: 'anywhere' }}>
          {impact.target.ref}
        </p>
      )}
    </div>
  );
}

interface UnderstandProps {
  xray: XrayState;
  onNavigate: (route: Route) => void;
}

export function Understand({ xray, onNavigate }: UnderstandProps) {
  const { layers, impact } = xray;
  const [question, setQuestion] = useState('');
  const [depth, setDepth] = useState('');
  const inputId = useId();
  const reducedMotion = useReducedMotion();
  const listId = useId();
  const repo = repoName(layers?.root);
  const shown = layers?.layers.filter((l) => ARCHITECTURE_LAYERS.includes(l.name)) ?? [];
  const extra = layers?.layers.filter((l) => !ARCHITECTURE_LAYERS.includes(l.name)) ?? [];
  const decisions = impact?.target.path
    ? recallFor(impact.target.path, impact.affected.map((a) => a.path))
    : [];
  const topDecision = decisions[0]?.decision;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (question.trim()) void xray.ask(question, depth ? Number(depth) : undefined);
  };

  const files = layers?.layers.flatMap((l) => l.components.map((c) => c.id)) ?? [];

  return (
    <>
      <section className="page-head rise" aria-labelledby="understand-title">
        <div>
          <div className="eyebrow">Step 2 · Impact</div>
          <h2 id="understand-title">
            Understand {repo}
            {layers?.repository?.commit && <span className="mono subtle"> · {layers.repository.commit.slice(0, 7)}</span>}
          </h2>
          <p className="muted">
            {layers
              ? `${plural(shown.length, 'layer')}, ${plural(
                  shown.reduce((n, l) => n + l.components.length, 0),
                  'component',
                )} and ${plural(layers.violations.length, 'layer violation')}. Ask what breaks before an agent changes a file.`
              : 'Scout is reading the repository…'}
          </p>
        </div>
        {xray.source === 'sample' && (
          <span className="chip amber" title={`Start it with: xray serve --root <repo>${xray.fallbackReason ? ` (${xray.fallbackReason})` : ''}`}>
            Sample analysis · X-Ray offline
          </span>
        )}
      </section>

      {xray.error && (
        <div className="notice error" role="alert">
          Repo X-Ray is unavailable: {xray.error}
        </div>
      )}

      <div className="row">
        <section aria-labelledby="architecture-title" className="card grow rise r2">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
            <h2 id="architecture-title">Architecture</h2>
            <span className="muted" style={{ fontSize: 14 }}>
              {layers ? `${layers.layers.reduce((n, l) => n + l.files, 0)} files analysed` : 'Loading…'}
            </span>
            <span className="chips" style={{ marginLeft: 'auto' }}>
              <span className="chip changed">Changed</span>
              <span className="chip affected">Affected</span>
            </span>
          </div>
          {layers && <ArchitectureMap report={layers} layers={shown} impact={impact} reducedMotion={reducedMotion} />}
          {extra.length > 0 && (
            <p className="subtle" style={{ margin: 0 }}>
              Also analysed: {extra.map((l) => `${plural(l.files, 'file')} in ${l.label.toLowerCase()}`).join(', ')}.
            </p>
          )}
          {layers && layers.violations.length > 0 && (
            <div className="notice error">
              {plural(layers.violations.length, 'import')} cross a layer boundary, for example{' '}
              <code>{layers.violations[0]!.from}</code> → <code>{layers.violations[0]!.to}</code>.
            </div>
          )}
        </section>

        <aside aria-label="Ask what breaks" className="side rise r3" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <form className="card ask-form" onSubmit={submit} style={{ padding: 18 }}>
            <label className="field grow" htmlFor={inputId}>
              What breaks if I change…
              <input
                id={inputId}
                list={listId}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="a file or folder, e.g. services/routing.py"
                autoComplete="off"
              />
              <datalist id={listId}>
                {files.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
            <label className="field">
              Depth
              <select value={depth} onChange={(e) => setDepth(e.target.value)}>
                <option value="">All</option>
                <option value="1">1 hop</option>
                <option value="2">2 hops</option>
                <option value="3">3 hops</option>
              </select>
            </label>
            <button type="submit" className="button filled" disabled={!layers || xray.asking}>
              {xray.asking ? 'Asking…' : 'Ask'}
            </button>
          </form>

          {impact && <div className="bubble-user">What breaks if I change {impact.target.path ?? impact.target.query}?</div>}
          {xray.impactError && (
            <div className="notice error" role="alert">
              {xray.impactError}
            </div>
          )}
          {impact && <ImpactAnswer impact={impact} />}

          {topDecision && (
            <a
              className="memory-link"
              href="#/remember"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('remember');
              }}
            >
              <Sage size={32} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="eyebrow">Sage remembers · {topDecision.key}</span>
                <strong>{topDecision.title}</strong>
                <span className="muted" style={{ fontSize: 14 }}>
                  {topDecision.decision}
                </span>
              </span>
            </a>
          )}

          <a
            className="button filled"
            href="#/trust"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('trust');
            }}
          >
            <SparkIcon size={18} />
            Ask an agent to make the change
          </a>
          <p className="subtle" style={{ margin: 0, textAlign: 'center' }}>
            Guard checks every change against policy before it touches a file.
          </p>
        </aside>
      </div>
    </>
  );
}

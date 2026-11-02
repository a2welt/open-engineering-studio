import { useId, useState, type FormEvent } from 'react';

import type { ImpactReport, Layer } from '../api/xray/types';
import { recallFor } from '../api/recall';
import { Ballast, Guard, Sage, Scout } from '../components/crew';
import { SparkIcon } from '../components/icons';
import { type Route, type XrayState, repoName } from '../state';

const ARCHITECTURE_LAYERS = ['presentation', 'core', 'adapters', 'composition'];
const FLOW_NOTES: Record<string, string> = {
  presentation: 'calls application services',
  core: 'adapters implement ports; the core never imports adapters',
};

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function LayerBlock({ layer, impact }: { layer: Layer; impact: ImpactReport | null }) {
  const changed = new Set(impact ? [impact.target.component] : []);
  const affected = new Map((impact?.summary.components ?? []).map((c) => [c.id, c.files]));
  return (
    <>
      <h3 className="layer-title" id={`layer-${layer.name}`}>
        {layer.label}
      </h3>
      <ul className="components" aria-labelledby={`layer-${layer.name}`}>
        {layer.components.map((component) => {
          const isChanged = changed.has(component.id);
          const affectedFiles = affected.get(component.id);
          const state = isChanged ? 'changed' : affectedFiles ? 'affected' : '';
          const targetFile = impact?.target.path?.split('/').pop();
          return (
            <li key={component.id} className={`component ${state}`} title={component.id}>
              <div className="title">{component.name.split('/').pop()}</div>
              <div className="meta">
                {isChanged && targetFile
                  ? `${targetFile} · changed`
                  : affectedFiles
                    ? `${plural(affectedFiles, 'file')} affected`
                    : plural(component.files, 'file')}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
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
  pendingApprovals: number | null;
  onNavigate: (route: Route) => void;
}

export function Understand({ xray, pendingApprovals, onNavigate }: UnderstandProps) {
  const { layers, impact } = xray;
  const [question, setQuestion] = useState('');
  const [depth, setDepth] = useState('');
  const inputId = useId();
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
      <section aria-label="Your crew" className="hero rise">
        <div className="hero-text">
          <div className="eyebrow">{greeting()}</div>
          <h2>Your crew mapped {repo}</h2>
          <p>
            {layers
              ? `${plural(shown.length, 'layer')}, ${plural(
                  shown.reduce((n, l) => n + l.components.length, 0),
                  'component',
                )} and ${plural(layers.violations.length, 'layer violation')}. Ask what breaks before you change a file.`
              : 'Scout is reading the repository…'}
          </p>
        </div>
        <ul className="crew">
          <li>
            <Scout className="float" />
            <span className="name">Scout</span>
            <span className="role">Repo X-Ray</span>
            <span className="chip blue">{layers ? `Mapped ${plural(shown.length, 'layer')}` : 'Mapping…'}</span>
          </li>
          <li>
            <Sage className="float d1" />
            <span className="name">Sage</span>
            <span className="role">Recall memory</span>
            <span className="chip purple">{plural(decisions.length, 'decision')} here</span>
          </li>
          <li>
            <Guard className="float d2" />
            <span className="name">Guard</span>
            <span className="role">OpenAgentTrust</span>
            <span className="chip green">
              {pendingApprovals === null
                ? 'Checking…'
                : pendingApprovals === 0
                  ? 'Nothing waiting'
                  : `${plural(pendingApprovals, 'approval')} waiting`}
            </span>
          </li>
          <li>
            <Ballast className="float d3" />
            <span className="name">Ballast</span>
            <span className="role">BallastOS</span>
            <span className="chip amber">Not connected yet</span>
          </li>
        </ul>
      </section>

      {xray.source === 'sample' && (
        <div className="notice" role="status">
          <span>
            Showing a bundled sample analysis of Open-model-fabric because the X-Ray server did not answer
            {xray.fallbackReason ? ` (${xray.fallbackReason})` : ''}. Start it with
          </span>
          <code>xray serve --root &lt;repo&gt;</code>
        </div>
      )}
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
          {shown.map((layer, index) => (
            <div key={layer.name}>
              <LayerBlock layer={layer} impact={impact} />
              {index < shown.length - 1 && FLOW_NOTES[layer.name] && (
                <div className="flow-note" style={{ marginTop: 10 }}>
                  <span className="flow-line" aria-hidden="true" />
                  {FLOW_NOTES[layer.name]}
                </div>
              )}
            </div>
          ))}
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

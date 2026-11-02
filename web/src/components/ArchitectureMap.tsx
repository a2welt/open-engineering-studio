import {
  Activity,
  Boxes,
  Brain,
  Cable,
  Check,
  Copy,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  Globe,
  HardDrive,
  KeyRound,
  Monitor,
  Package,
  Plug,
  Rocket,
  Settings2,
  Shapes,
  ShieldAlert,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import type { ImpactReport, Layer, LayersReport } from '../api/xray/types';

// Icons are picked from the component's name, so any repository gets a readable map.
const COMPONENT_ICONS: [RegExp, LucideIcon][] = [
  [/web|ui|frontend|console|app$/i, Monitor],
  [/api|server|http|rest|gateway/i, Globe],
  [/sdk|client|package|lib/i, Package],
  [/service/i, Settings2],
  [/domain|model|entity|schema/i, Shapes],
  [/port|interface|contract/i, Plug],
  [/secur|auth|secret|key|token/i, KeyRound],
  [/infer|llm|ai$|ml$/i, Brain],
  [/core|kernel|engine|compute|worker|runtime|exec/i, Cpu],
  [/meta|registry|catalog|index/i, Database],
  [/stor|db|repo|persist|cache/i, HardDrive],
  [/telemetry|metric|log|trace|observ/i, Activity],
  [/adapter|integration|provider|connector/i, Cable],
  [/bootstrap|composition|main|wiring|container|config/i, Rocket],
  [/test|spec|fixture/i, FlaskConical],
  [/doc|readme|guide/i, FileText],
  [/pipeline|flow|orchestr|routing|router/i, Workflow],
];
const LAYER_ICONS: Record<string, LucideIcon> = {
  presentation: Monitor,
  core: Cpu,
  adapters: Cable,
  composition: Rocket,
  tests: FlaskConical,
  other: Boxes,
};
const LAYER_NOTES: Record<string, string> = {
  presentation: 'Entry points for users and clients',
  core: 'Business rules; depends on nothing below',
  adapters: 'Implement the ports the core defines',
  composition: 'Wires adapters into the core',
};
const LANGUAGE_LABEL: Record<string, string> = { python: 'Python', typescript: 'TypeScript' };

export function iconFor(name: string): LucideIcon {
  const short = name.split('/').pop() ?? name;
  return COMPONENT_ICONS.find(([re]) => re.test(short))?.[1] ?? Boxes;
}

/** Mermaid for the shown layers, components and layer dependencies, for docs and wikis. */
export function toMermaid(report: LayersReport, layers: Layer[]): string {
  const id = (s: string) => s.replace(/[^A-Za-z0-9]/g, '_');
  const lines = ['flowchart TB'];
  for (const layer of layers) {
    lines.push(`  subgraph ${id(layer.name)}["${layer.label}"]`);
    for (const c of layer.components) lines.push(`    ${id(c.id)}["${c.name.split('/').pop()}<br/>${c.files} files"]`);
    lines.push('  end');
  }
  const shown = new Set(layers.map((l) => l.name));
  for (const d of report.dependencies) {
    if (shown.has(d.from) && shown.has(d.to) && d.from !== d.to) {
      lines.push(`  ${id(d.from)} -- "${d.imports} imports" --> ${id(d.to)}`);
    }
  }
  return lines.join('\n');
}

interface Edge {
  id: string;
  d: string;
  kind: 'impact' | 'flow';
  depth: number;
  label?: { x: number; y: number; text: string };
}

/** Width reserved on the right of the lanes for the layer-dependency connectors. */
const GUTTER = 56;
const R = 10;

/** Half the gap between component columns: the channel a route runs in. */
const CHANNEL = 5;

/**
 * An orthogonal route with rounded corners that never crosses a component. Every lane lays
 * its components on the same grid, so the gaps between columns line up from lane to lane:
 * the route leaves the source sideways into the column gap on its left, runs vertically in
 * it to the gap above (or below) the target's lane, crosses there to the target's column
 * gap, and enters the target from the left.
 */
function route(from: DOMRect, to: DOMRect, crossY: number, o: DOMRect): string {
  const sx = from.left - o.left;
  const sy = from.top + from.height / 2 - o.top;
  const c1 = sx - CHANNEL;
  const tx = to.left - o.left;
  const ty = to.top + to.height / 2 - o.top;
  const c2 = tx - CHANNEL;
  const v = (y1: number, y2: number) => Math.sign(y2 - y1) || 1;
  const parts = [`M ${sx} ${sy}`, `H ${c1 + 4}`, `Q ${c1} ${sy} ${c1} ${sy + v(sy, crossY) * 4}`];
  if (Math.abs(c2 - c1) < 1) {
    parts.push(`V ${ty - v(sy, ty) * 4}`, `Q ${c1} ${ty} ${c1 + 4} ${ty}`, `H ${tx}`);
    return parts.join(' ');
  }
  const h = Math.sign(c2 - c1);
  parts.push(
    `V ${crossY - v(sy, crossY) * R}`,
    `Q ${c1} ${crossY} ${c1 + h * R} ${crossY}`,
    `H ${c2 - h * R}`,
    `Q ${c2} ${crossY} ${c2} ${crossY + v(crossY, ty) * R}`,
    `V ${ty - v(crossY, ty) * 4}`,
    `Q ${c2} ${ty} ${c2 + 4} ${ty}`,
    `H ${tx}`,
  );
  return parts.join(' ');
}

interface ArchitectureMapProps {
  report: LayersReport;
  layers: Layer[];
  impact: ImpactReport | null;
  reducedMotion: boolean;
}

export function ArchitectureMap({ report, layers, impact, reducedMotion }: ArchitectureMapProps) {
  const canvas = useRef<HTMLDivElement>(null);
  const tiles = useRef(new Map<string, HTMLElement>());
  const lanes = useRef(new Map<string, HTMLElement>());
  const [edges, setEdges] = useState<Edge[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [copied, setCopied] = useState(false);

  const changed = impact?.target.component ?? null;
  const affected = new Map((impact?.summary.components ?? []).map((c) => [c.id, c.files]));
  const depthOf = new Map<string, number>();
  for (const file of impact?.affected ?? []) {
    depthOf.set(file.component, Math.min(depthOf.get(file.component) ?? Infinity, file.depth));
  }

  const laneIndex = new Map(layers.map((l, i) => [l.name, i]));
  const componentLane = new Map(layers.flatMap((l, i) => l.components.map((c) => [c.id, i] as const)));
  const flows = report.dependencies.filter((d) => d.from !== d.to && laneIndex.has(d.from) && laneIndex.has(d.to));
  const targets = changed ? [...affected.keys()].filter((id) => id !== changed && componentLane.has(id)) : [];
  const geometryKey = `${changed}|${targets.join(',')}|${flows.length}|${layers.length}`;

  useLayoutEffect(() => {
    const root = canvas.current;
    if (!root) return;
    const measure = () => {
      const o = root.getBoundingClientRect();
      const laneRects = layers.map((l) => lanes.current.get(l.name)?.getBoundingClientRect() ?? o);
      // y of the gap below lane i, in container coordinates.
      const gaps = laneRects.slice(0, -1).map((r, i) => (r.bottom + laneRects[i + 1]!.top) / 2 - o.top);
      const edgeX = root.clientWidth - GUTTER;
      const next: Edge[] = [];

      // Layer dependencies: one bracket per edge in the gutter, labelled with the import count.
      flows.forEach((flow, lane) => {
        const a = laneRects[laneIndex.get(flow.from)!]!;
        const b = laneRects[laneIndex.get(flow.to)!]!;
        const x = edgeX + 12 + lane * 8;
        const y1 = a.top + Math.min(26, a.height / 2) + lane * 3 - o.top;
        const y2 = b.top + Math.min(26, b.height / 2) + lane * 3 - o.top;
        next.push({
          id: `flow:${flow.from}>${flow.to}`,
          d: `M ${edgeX} ${y1} H ${x - R} Q ${x} ${y1} ${x} ${y1 + Math.sign(y2 - y1) * R} V ${y2 - Math.sign(y2 - y1) * R} Q ${x} ${y2} ${x - R} ${y2} H ${edgeX + 3}`,
          kind: 'flow',
          depth: 0,
        });
      });

      // Impact: from the changed component to every affected component in another lane.
      const src = changed ? tiles.current.get(changed)?.getBoundingClientRect() : undefined;
      const srcLane = changed ? componentLane.get(changed) : undefined;
      if (src && srcLane !== undefined) {
        for (const id of targets) {
          const dst = tiles.current.get(id)?.getBoundingClientRect();
          const dstLane = componentLane.get(id);
          if (!dst || dstLane === undefined || dstLane === srcLane) continue;
          // Cross over in the gap next to the target's lane, on the side the route comes from.
          const crossY = gaps[dstLane > srcLane ? dstLane - 1 : dstLane]!;
          next.push({ id: `imp:${id}`, d: route(src, dst, crossY, o), kind: 'impact', depth: depthOf.get(id) ?? 1 });
        }
      }
      setEdges(next);
      setSize({ width: root.clientWidth, height: root.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryKey]);

  const totalFiles = report.layers.reduce((n, l) => n + l.files, 0);
  const languages = new Map<string, number>();
  for (const l of report.layers) {
    for (const c of l.components) {
      for (const [lang, n] of Object.entries(c.languages)) languages.set(lang, (languages.get(lang) ?? 0) + n);
    }
  }
  const components = layers.reduce((n, l) => n + l.components.length, 0);
  const shownFiles = layers.reduce((n, l) => n + l.files, 0);

  const copyMermaid = async () => {
    try {
      await navigator.clipboard.writeText(toMermaid(report, layers));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: the button simply stays as it was.
    }
  };

  let order = 0;
  return (
    <div className="archmap">
      <header className="archmap-head">
        <div className="archmap-title">
          <h2 id="architecture-title">Architecture</h2>
          <span className="archmap-facts">
            <b>{layers.length}</b> layers · <b>{components}</b> components · <b>{totalFiles}</b> files
          </span>
        </div>
        <div className="archmap-tools">
          <span
            className="langbar"
            role="img"
            aria-label={[...languages].map(([l, n]) => `${LANGUAGE_LABEL[l] ?? l} ${n} files`).join(', ')}
          >
            {[...languages].map(([lang, n]) => (
              <span key={lang} className={`lang ${lang}`} style={{ flex: n }} title={`${LANGUAGE_LABEL[lang] ?? lang}: ${n} files`} />
            ))}
          </span>
          <span className={`chip ${report.violations.length ? 'red' : 'green'}`}>
            {report.violations.length ? <ShieldAlert size={14} aria-hidden="true" /> : <ShieldCheck size={14} aria-hidden="true" />}
            {report.violations.length ? `${report.violations.length} layer violations` : 'Layer rules hold'}
          </span>
          <button type="button" className="button text small" onClick={() => void copyMermaid()}>
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy as Mermaid'}
          </button>
        </div>
      </header>

      {impact && (
        <p className="impact-ribbon" role="status">
          <Workflow size={16} aria-hidden="true" />
          <span>
            Changing <code>{impact.target.path?.split('/').pop() ?? impact.target.query}</code> reaches{' '}
            <b>{impact.summary.components.length}</b> components and <b>{impact.summary.total}</b> files in{' '}
            <b>{Object.keys(impact.summary.by_layer).length}</b> layers
            {impact.summary.tests ? (
              <>
                , including <b>{impact.summary.tests}</b> tests to rerun
              </>
            ) : null}
            .
          </span>
        </p>
      )}

      <div className="archmap-canvas" ref={canvas} style={{ paddingRight: GUTTER }}>
        <svg className="archmap-edges" width={size.width} height={size.height} aria-hidden="true">
          <defs>
            <marker id="arrow-impact" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--impact)" />
            </marker>
            <marker id="arrow-flow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text3)" />
            </marker>
          </defs>
          {edges.map((edge) => (
            <g key={`${edge.id}:${geometryKey}`} className={`edge ${edge.kind} d${Math.min(edge.depth, 3)}`}>
              <path d={edge.d} markerEnd={`url(#arrow-${edge.kind})`} />
              {edge.kind === 'impact' && !reducedMotion && (
                <circle r="3" className="spark">
                  <animateMotion dur={`${1.8 + edge.depth * 0.4}s`} repeatCount="indefinite" path={edge.d} />
                </circle>
              )}
            </g>
          ))}
        </svg>

        <ol className="lanes">
          {layers.map((layer) => {
            const LayerIcon = LAYER_ICONS[layer.name] ?? Boxes;
            const share = shownFiles ? Math.round((layer.files / shownFiles) * 100) : 0;
            const out = flows.filter((f) => f.from === layer.name);
            return (
              <li
                key={layer.name}
                className="lane"
                ref={(el) => {
                  if (el) lanes.current.set(layer.name, el);
                  else lanes.current.delete(layer.name);
                }}
              >
                <div className="lane-label">
                  <span className="lane-icon">
                    <LayerIcon size={16} aria-hidden="true" />
                  </span>
                  <h3 id={`layer-${layer.name}`}>{layer.label}</h3>
                  {LAYER_NOTES[layer.name] && <span className="lane-note">{LAYER_NOTES[layer.name]}</span>}
                  {out.length > 0 && (
                    <span className="lane-deps">
                      {out.map((f) => (
                        <span key={f.to}>
                          → {layers[laneIndex.get(f.to)!]!.label.toLowerCase()} <b>{f.imports}</b>
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="lane-foot">
                    <span className="lane-share">
                      <span style={{ width: `${share}%` }} />
                    </span>
                    <span className="lane-files">
                      {layer.files} files · {share}%
                    </span>
                  </span>
                </div>
                <ul className="nodes" aria-labelledby={`layer-${layer.name}`}>
                  {layer.components.map((component) => {
                    const Icon = iconFor(component.name);
                    const isChanged = component.id === changed;
                    const files = affected.get(component.id);
                    const state = isChanged ? 'changed' : files ? 'affected' : '';
                    const index = order++;
                    const langs = Object.entries(component.languages).sort((a, b) => b[1] - a[1]);
                    return (
                      <li
                        key={component.id}
                        ref={(el) => {
                          if (el) tiles.current.set(component.id, el);
                          else tiles.current.delete(component.id);
                        }}
                        className={`node ${state}`}
                        style={{ animationDelay: `${index * 40}ms` }}
                        title={component.id}
                      >
                        <span className="node-head">
                          <span className="node-icon">
                            <Icon size={17} aria-hidden="true" />
                          </span>
                          <span className="node-name">{component.name.split('/').pop()}</span>
                          {isChanged && <span className="node-tag">Changed</span>}
                          {files && !isChanged ? <span className="node-tag">Hop {depthOf.get(component.id) ?? 1}</span> : null}
                        </span>
                        <span className="node-meta">
                          <span className="node-langs" aria-hidden="true">
                            {langs.map(([lang]) => (
                              <span key={lang} className={`lang ${lang}`} />
                            ))}
                          </span>
                          {isChanged
                            ? (impact?.target.path?.split('/').pop() ?? 'target')
                            : files
                              ? `${files} of ${component.files} files affected`
                              : `${component.files} ${component.files === 1 ? 'file' : 'files'}`}
                        </span>
                        {files && !isChanged ? (
                          <span className="node-share" aria-hidden="true">
                            <span style={{ width: `${Math.min(100, Math.round((files / component.files) * 100))}%` }} />
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>

      <p className="archmap-legend">
        <span className="key flow" /> depends on
        <span className="key impact" /> would break
        <span className="key node-changed" /> changed
        <span className="key lang python" /> Python
        <span className="key lang typescript" /> TypeScript
      </p>
    </div>
  );
}

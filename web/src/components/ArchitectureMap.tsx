import {
  Activity,
  ArrowRight,
  Boxes,
  Brain,
  Cable,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  Monitor,
  Package,
  Plug,
  Rocket,
  Settings2,
  Shapes,
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
  [/core|kernel|engine/i, Cpu],
  [/compute|worker|runtime|exec/i, Cpu],
  [/meta|registry|catalog|index/i, Database],
  [/stor|db|repo|persist|cache/i, HardDrive],
  [/infer|llm|model|ai|ml/i, Brain],
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
  presentation: 'what users and clients touch',
  core: 'the rules; never imports adapters',
  adapters: 'implement the core’s ports',
  composition: 'wires everything together',
};

export function iconFor(name: string): LucideIcon {
  const short = name.split('/').pop() ?? name;
  return COMPONENT_ICONS.find(([re]) => re.test(short))?.[1] ?? Boxes;
}

interface Path {
  id: string;
  d: string;
  kind: 'impact';
  depth: number;
}

/**
 * A path from `from` to `to` in container coordinates. Neighbouring rows get a direct curve;
 * longer links leave through the left margin so they never cross the tiles in between.
 */
function curve(from: DOMRect, to: DOMRect, origin: DOMRect): string {
  const fx = from.left + from.width / 2 - origin.left;
  const tx = to.left + to.width / 2 - origin.left;
  const fTop = from.top - origin.top;
  const fBottom = from.bottom - origin.top;
  const tTop = to.top - origin.top;
  const tBottom = to.bottom - origin.top;
  const down = tTop > fBottom;
  const gap = down ? tTop - fBottom : fTop - tBottom;
  if (gap < 120) {
    const sy = down ? fBottom : fTop;
    const ey = down ? tTop : tBottom;
    const bend = Math.max(30, Math.abs(ey - sy) / 2) * (down ? 1 : -1);
    return `M ${fx} ${sy} C ${fx} ${sy + bend}, ${tx} ${ey - bend}, ${tx} ${ey}`;
  }
  // Out of the left side of the source, along the margin, into the left side of the target.
  const gutter = -14;
  const sx = from.left - origin.left;
  const sy = fTop + from.height / 2;
  const ex = to.left - origin.left;
  const ey = tTop + to.height / 2;
  const r = 14;
  const dir = ey > sy ? 1 : -1;
  return [
    `M ${sx} ${sy}`,
    `L ${gutter + r} ${sy}`,
    `Q ${gutter} ${sy} ${gutter} ${sy + r * dir}`,
    `L ${gutter} ${ey - r * dir}`,
    `Q ${gutter} ${ey} ${gutter + r} ${ey}`,
    `L ${ex} ${ey}`,
  ].join(' ');
}

interface ArchitectureMapProps {
  report: LayersReport;
  layers: Layer[];
  impact: ImpactReport | null;
  reducedMotion: boolean;
}

export function ArchitectureMap({ report, layers, impact, reducedMotion }: ArchitectureMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const tiles = useRef(new Map<string, HTMLElement>());
  const [paths, setPaths] = useState<Path[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const changed = impact?.target.component ?? null;
  const affected = new Map((impact?.summary.components ?? []).map((c) => [c.id, c.files]));
  const depthOf = new Map<string, number>();
  for (const file of impact?.affected ?? []) {
    depthOf.set(file.component, Math.min(depthOf.get(file.component) ?? Infinity, file.depth));
  }

  // X-Ray reports imports between layers; each band lists the layers it depends on.
  const shownIds = new Set(layers.flatMap((l) => l.components.map((c) => c.id)));
  const labelOf = new Map(layers.map((l) => [l.name, l.label]));
  const importsOf = (layer: string) =>
    report.dependencies.filter((e) => e.from === layer && e.to !== layer && labelOf.has(e.to));
  const impactEdges = changed
    ? [...affected.keys()].filter((id) => id !== changed && shownIds.has(id)).map((id) => ({ from: changed, to: id }))
    : [];
  const edgeKey = impactEdges.map((e) => `${e.from}>${e.to}`).join('|');

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const measure = () => {
      const origin = root.getBoundingClientRect();
      const rect = (id: string) => tiles.current.get(id)?.getBoundingClientRect();
      const next: Path[] = [];
      for (const edge of impactEdges) {
        // Impact flows against the import direction: the changed component's importers break.
        const from = rect(edge.from);
        const to = rect(edge.to);
        if (from && to)
          next.push({ id: `imp:${edge.from}>${edge.to}`, d: curve(from, to, origin), kind: 'impact', depth: depthOf.get(edge.to) ?? 1 });
      }
      setPaths(next);
      setSize({ width: root.clientWidth, height: root.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeKey, layers.length]);

  // Keying the edges by the impact re-mounts them, which restarts the draw-on animation.
  const run = `${changed ?? ''}|${impactEdges.length}`;

  let order = 0;
  return (
    <div className="archmap" ref={container}>
      <svg className="archmap-edges" width={size.width} height={size.height} aria-hidden="true">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {paths.map((path) => (
          <g key={`${path.id}:${run}`} className={`edge ${path.kind} d${Math.min(path.depth, 3)}`}>
            <path d={path.d} markerEnd={path.kind === 'impact' ? 'url(#arrow)' : undefined} />
            {path.kind === 'impact' && !reducedMotion && (
              <circle r="3.5" className="spark">
                <animateMotion dur={`${1.4 + path.depth * 0.3}s`} repeatCount="indefinite" path={path.d} />
              </circle>
            )}
          </g>
        ))}
      </svg>

      {layers.map((layer) => {
        const LayerIcon = LAYER_ICONS[layer.name] ?? Boxes;
        return (
          <section key={layer.name} className="band" aria-labelledby={`layer-${layer.name}`}>
            <header className="band-head">
              <LayerIcon size={16} aria-hidden="true" />
              <h3 id={`layer-${layer.name}`}>{layer.label}</h3>
              {LAYER_NOTES[layer.name] && <span className="subtle">{LAYER_NOTES[layer.name]}</span>}
              <span className="band-deps">
                {importsOf(layer.name).map((e) => (
                  <span key={e.to} className="dep-chip" title={`${e.imports} imports from ${layer.label} into ${labelOf.get(e.to)}`}>
                    <ArrowRight size={12} aria-hidden="true" />
                    {labelOf.get(e.to)} · {e.imports}
                  </span>
                ))}
              </span>
              <span className="subtle band-files">{layer.files} files</span>
            </header>
            <ul className="tiles">
              {layer.components.map((component) => {
                const Icon = iconFor(component.name);
                const isChanged = component.id === changed;
                const files = affected.get(component.id);
                const state = isChanged ? 'changed' : files ? 'affected' : '';
                const index = order++;
                return (
                  <li
                    key={component.id}
                    ref={(el) => {
                      if (el) tiles.current.set(component.id, el);
                      else tiles.current.delete(component.id);
                    }}
                    className={`tile-c ${state}`}
                    style={{ animationDelay: `${index * 45}ms` }}
                    title={component.id}
                  >
                    <span className="tile-icon">
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span className="tile-text">
                      <span className="tile-name">{component.name.split('/').pop()}</span>
                      <span className="tile-meta">
                        {isChanged
                          ? `${impact?.target.path?.split('/').pop() ?? 'target'} · changed`
                          : files
                            ? `${files} of ${component.files} affected`
                            : `${component.files} file${component.files === 1 ? '' : 's'}`}
                      </span>
                    </span>
                    {files && !isChanged && (
                      <span className="tile-share" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, Math.round((files / component.files) * 100))}%` }} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <p className="archmap-legend subtle">
        <ArrowRight size={14} aria-hidden="true" /> imports between layers
        <span className="swatch impact" /> would break
        <ShieldCheck size={14} aria-hidden="true" /> {report.violations.length === 0 ? 'no layer violations' : `${report.violations.length} layer violations`}
        <Layers size={14} aria-hidden="true" /> {layers.length} layers
      </p>
    </div>
  );
}

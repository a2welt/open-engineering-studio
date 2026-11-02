import graphSample from './sample/omf-graph.json';
import layersSample from './sample/omf-layers.json';
import {
  type AffectedFile,
  type DataSource,
  type GraphReport,
  type ImpactReport,
  type LayersReport,
  type XrayClient,
  XrayError,
} from './types';

export class HttpXrayClient implements XrayClient {
  readonly source: DataSource = 'live';
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(baseUrl: string, fetchFn: typeof fetch = (...args) => fetch(...args)) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchFn = fetchFn;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      headers: { Accept: 'application/json' },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body ? String(body.error) : response.statusText;
      throw new XrayError(message, response.status);
    }
    return body as T;
  }

  health(): Promise<{ ok: boolean; root: string }> {
    return this.get('/health');
  }

  layers(): Promise<LayersReport> {
    return this.get('/layers');
  }

  graph(): Promise<GraphReport> {
    return this.get('/graph');
  }

  impact(path: string, maxDepth?: number): Promise<ImpactReport> {
    const query = new URLSearchParams({ path });
    if (maxDepth) query.set('max_depth', String(maxDepth));
    return this.get(`/impact?${query}`);
  }
}

/** Same reverse-dependency walk as repo_xray.impact, over a graph report. */
export function computeImpact(
  graph: GraphReport,
  query: string,
  maxDepth?: number,
): ImpactReport {
  const byPath = new Map(graph.files.map((f) => [f.path, f]));
  const rel = query.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
  let changed: string[];
  if (byPath.has(rel)) {
    changed = [rel];
  } else {
    const under = graph.files.filter((f) => f.path.startsWith(`${rel}/`)).map((f) => f.path);
    const suffix = graph.files.filter((f) => f.path.endsWith(`/${rel}`)).map((f) => f.path);
    if (under.length) changed = under.sort();
    else if (suffix.length === 1) changed = suffix;
    else if (suffix.length > 1) throw new XrayError(`'${query}' is ambiguous: ${suffix.slice(0, 10).join(', ')}`, 404);
    else throw new XrayError(`'${query}' does not match any analysed file`, 404);
  }

  const reverse = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!reverse.has(edge.to)) reverse.set(edge.to, new Set());
    reverse.get(edge.to)!.add(edge.from);
  }
  const depth = new Map(changed.map((p) => [p, 0]));
  const parent = new Map<string, string>();
  const queue = [...changed].sort();
  const found: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    const d = depth.get(current)!;
    if (maxDepth && d >= maxDepth) continue;
    for (const importer of [...(reverse.get(current) ?? [])].sort()) {
      if (depth.has(importer)) continue;
      depth.set(importer, d + 1);
      parent.set(importer, current);
      found.push(importer);
      queue.push(importer);
    }
  }

  const affected: AffectedFile[] = found
    .map((path) => {
      const chain = [path];
      while (parent.has(chain[chain.length - 1]!)) chain.push(parent.get(chain[chain.length - 1]!)!);
      return { ...byPath.get(path)!, depth: depth.get(path)!, via: parent.get(path)!, chain };
    })
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));

  const count = (values: string[]) =>
    values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
  const byLayer = count(affected.map((a) => a.layer));
  const components = Object.entries(count(affected.map((a) => a.component)))
    .sort((a, b) => b[1] - a[1])
    .map(([id, files]) => ({ id, files, layer: affected.find((a) => a.component === id)!.layer }));
  const target = byPath.get(changed[0]!)!;
  const single = changed.length === 1;
  const repo = graph.repository;
  return {
    schema: graph.schema,
    root: graph.root,
    repository: repo,
    target: {
      query,
      path: single ? changed[0]! : null,
      files: changed,
      layer: target.layer,
      component: target.component,
      ref: single && repo?.url ? `git+${repo.url}@${repo.commit}#${changed[0]}` : null,
    },
    max_depth: maxDepth ?? null,
    summary: {
      direct: affected.filter((a) => a.depth === 1).length,
      total: affected.length,
      max_depth_reached: Math.max(0, ...affected.map((a) => a.depth)),
      tests: byLayer.tests ?? 0,
      by_layer: byLayer,
      components,
    },
    direct: affected.filter((a) => a.depth === 1).map((a) => a.path),
    affected,
  };
}

/** Answers from a bundled analysis of Open-model-fabric, so the screen works offline. */
export class SampleXrayClient implements XrayClient {
  readonly source: DataSource = 'sample';
  private readonly graphReport = graphSample as unknown as GraphReport;
  private readonly layersReport = layersSample as unknown as LayersReport;

  async layers(): Promise<LayersReport> {
    return this.layersReport;
  }

  async graph(): Promise<GraphReport> {
    return this.graphReport;
  }

  async impact(path: string, maxDepth?: number): Promise<ImpactReport> {
    return computeImpact(this.graphReport, path, maxDepth);
  }
}

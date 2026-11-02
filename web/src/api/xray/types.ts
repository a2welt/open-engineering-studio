// Shapes of Repo X-Ray's JSON (schema "xray/v0"). See xray/src/repo_xray/analysis.py.

export interface RepositoryInfo {
  url: string | null;
  commit: string;
  path: string | null;
}

interface Header {
  schema: string;
  root: string;
  repository: RepositoryInfo | null;
}

export interface FileEntry {
  path: string;
  language: 'python' | 'typescript';
  layer: string;
  component: string;
}

export interface GraphReport extends Header {
  stats: { files: number; edges: number; languages: Record<string, number> };
  files: FileEntry[];
  edges: { from: string; to: string }[];
  external: Record<string, number>;
}

export interface Component {
  id: string;
  name: string;
  layer: string;
  files: number;
  languages: Record<string, number>;
}

export interface Layer {
  name: string;
  label: string;
  files: number;
  components: Component[];
}

export interface Violation {
  from: string;
  to: string;
  from_layer: string;
  to_layer: string;
}

export interface LayersReport extends Header {
  layers: Layer[];
  dependencies: { from: string; to: string; imports: number }[];
  rules: Record<string, string[]>;
  violations: Violation[];
}

export interface AffectedFile extends FileEntry {
  depth: number;
  via: string;
  chain: string[];
}

export interface ImpactReport extends Header {
  target: {
    query: string;
    path: string | null;
    files: string[];
    layer: string;
    component: string;
    ref: string | null;
  };
  max_depth: number | null;
  summary: {
    direct: number;
    total: number;
    max_depth_reached: number;
    tests: number;
    by_layer: Record<string, number>;
    components: { id: string; layer: string; files: number }[];
  };
  direct: string[];
  affected: AffectedFile[];
}

export type DataSource = 'live' | 'sample';

export interface XrayClient {
  readonly source: DataSource;
  layers(): Promise<LayersReport>;
  graph(): Promise<GraphReport>;
  impact(path: string, maxDepth?: number): Promise<ImpactReport>;
}

export class XrayError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'XrayError';
    this.status = status;
  }
}

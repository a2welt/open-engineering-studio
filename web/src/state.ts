import { useCallback, useEffect, useState } from 'react';

import type { DataSource, ImpactReport, LayersReport, XrayClient } from './api/xray/types';
import { useServices } from './services';

export type Route = 'understand' | 'trust' | 'remember' | 'optimize';
const ROUTES: Route[] = ['understand', 'trust', 'remember', 'optimize'];

function parseHash(hash: string): Route {
  const name = hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(name) ? name : 'understand';
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const update = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const navigate = useCallback((next: Route) => {
    window.location.hash = `/${next}`;
    setRoute(next);
  }, []);
  return [route, navigate];
}

export interface XrayState {
  layers: LayersReport | null;
  source: DataSource | null;
  /** Why the live analysis is not shown, when the sample stands in for it. */
  fallbackReason: string | null;
  error: string | null;
  impact: ImpactReport | null;
  impactError: string | null;
  asking: boolean;
  ask: (path: string, maxDepth?: number) => Promise<void>;
  /** Impact of a path without changing the shown answer; null when unknown. */
  lookup: (path: string) => Promise<ImpactReport | null>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const DEFAULT_QUESTION = 'python/omf/core/services/routing.py';

/** Load layers from the first X-Ray client that answers, then ask impact questions of it. */
export function useXray(): XrayState {
  const { xray } = useServices();
  const [client, setClient] = useState<XrayClient | null>(null);
  const [layers, setLayers] = useState<LayersReport | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<ImpactReport | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const ask = useCallback(
    async (path: string, maxDepth?: number, using: XrayClient | null = client) => {
      if (!using) return;
      setAsking(true);
      setImpactError(null);
      try {
        setImpact(await using.impact(path.trim(), maxDepth));
      } catch (err) {
        setImpactError(message(err));
      } finally {
        setAsking(false);
      }
    },
    [client],
  );

  const lookup = useCallback(
    async (path: string) => (client ? client.impact(path).catch(() => null) : null),
    [client],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let lastError: string | null = null;
      for (const candidate of xray) {
        try {
          const report = await candidate.layers();
          if (cancelled) return;
          setClient(candidate);
          setLayers(report);
          setFallbackReason(candidate.source === 'sample' ? lastError : null);
          // Open on the question from the design: the routing service, when the repo has one.
          const first = await candidate.impact(DEFAULT_QUESTION).catch(() => null);
          if (!cancelled && first) setImpact(first);
          return;
        } catch (err) {
          lastError = message(err);
        }
      }
      if (!cancelled) setError(lastError ?? 'No X-Ray client configured');
    })();
    return () => {
      cancelled = true;
    };
  }, [xray]);

  return {
    layers,
    source: client?.source ?? null,
    fallbackReason,
    error,
    impact,
    impactError,
    asking,
    ask: (path, maxDepth) => ask(path, maxDepth),
    lookup,
  };
}

export function repoName(root: string | undefined): string {
  if (!root) return 'repository';
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}

import { describe, expect, it, vi } from 'vitest';

import { computeImpact, HttpXrayClient, SampleXrayClient } from '../api/xray/client';
import { XrayError } from '../api/xray/types';

describe('sample X-Ray client', () => {
  it('finds the real dependents of the routing service', async () => {
    const report = await new SampleXrayClient().impact('python/omf/core/services/routing.py');
    expect(report.direct).toEqual([
      'python/omf/bootstrap/container.py',
      'python/omf/core/services/inference.py',
    ]);
    const app = report.affected.find((a) => a.path === 'apps/api/omf_api/app.py');
    expect(app?.layer).toBe('presentation');
    expect(app?.chain.at(-1)).toBe('python/omf/core/services/routing.py');
    expect(report.target.ref).toMatch(
      /^git\+https:\/\/github\.com\/.+@[0-9a-f]{40}#python\/omf\/core\/services\/routing\.py$/,
    );
  });

  it('limits depth and resolves unique suffixes', async () => {
    const report = await new SampleXrayClient().impact('services/routing.py', 1);
    expect(report.target.path).toBe('python/omf/core/services/routing.py');
    expect(report.affected.every((a) => a.depth === 1)).toBe(true);
  });

  it('rejects unknown and ambiguous targets', async () => {
    const graph = await new SampleXrayClient().graph();
    expect(() => computeImpact(graph, 'nope.py')).toThrow(XrayError);
    expect(() => computeImpact(graph, '__init__.py')).toThrow(/ambiguous/);
  });
});

describe('HTTP X-Ray client', () => {
  it('builds impact queries and surfaces server errors', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "'x' does not match any analysed file" }), { status: 404 }),
    );
    const client = new HttpXrayClient('/xray/', fetchFn);
    await expect(client.impact('x', 2)).rejects.toThrow('does not match');
    expect(fetchFn).toHaveBeenCalledWith('/xray/impact?path=x&max_depth=2', expect.anything());
  });
});

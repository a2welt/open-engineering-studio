import { describe, expect, it, vi } from 'vitest';

import { fillPath, HttpOatClient, parseActivity, parsePending, summarizeReceipt } from '../api/oat/http';
import { MockOatClient } from '../api/oat/mock';
import { DEFAULT_OAT_PATHS } from '../api/oat/types';
import { readConfig } from '../config';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('OAT configuration', () => {
  it('merges endpoint path overrides and ignores unknown keys', () => {
    const config = readConfig({
      VITE_OAT_MODE: 'http',
      VITE_OAT_PATHS: '{"activity": "/api/activity", "bogus": "/x", "verify": 3}',
    });
    expect(config.oat.mode).toBe('http');
    expect(config.oat.paths.activity).toBe('/api/activity');
    expect(config.oat.paths.verify).toBe(DEFAULT_OAT_PATHS.verify);
    expect(config.oat.paths).not.toHaveProperty('bogus');
  });

  it('defaults to the mock and the auto X-Ray mode', () => {
    const config = readConfig({});
    expect(config.oat.mode).toBe('mock');
    expect(config.xray.mode).toBe('auto');
    expect(config.oat.baseUrl).toBe('/oat');
  });

  it('fills path templates with encoded values', () => {
    expect(fillPath('/v1/receipts/{digest}', { digest: 'sha256:ab/c' })).toBe(
      '/v1/receipts/sha256%3Aab%2Fc',
    );
  });
});

describe('wire parsing', () => {
  it('reads snake_case approvals and activity', () => {
    const pending = parsePending({
      id: 'r1',
      request_digest: 'sha256:1',
      agent_name: 'coder',
      action: 'repo.edit',
      resource: 'a.py',
      rule_id: null,
      reason: 'review',
      requested_at: '2026-11-02T09:14:00Z',
      references: ['recall:memory:x', 7],
      change: { lines_added: 3, lines_removed: 1, tests_passed: true },
    });
    expect(pending.references).toEqual(['recall:memory:x']);
    expect(pending.change).toEqual({ linesAdded: 3, linesRemoved: 1, testsPassed: true });

    const entry = parseActivity({ id: 'r2', effect: 'nonsense', status: 'denied', receipt_digest: null });
    expect(entry.effect).toBeNull();
    expect(entry.status).toBe('denied');
  });

  it('summarizes an AgentProof receipt', () => {
    const summary = summarizeReceipt(
      {
        id: 'rcpt-1',
        issued_at: '2026-11-02T09:12:00Z',
        request: {
          agent: 'ed25519:agent',
          action: 'repo.read',
          resource: 'x',
          arguments: { references: ['a'] },
        },
        delegation_chain: [
          {
            issuer: 'ed25519:anchor',
            subject: 'ed25519:p',
            subject_name: 'planner',
            scope: { actions: ['repo.*'], resources: ['*'] },
          },
        ],
        decision: { effect: 'allow', rule_id: 'r' },
        approval: null,
        outcome: { status: 'succeeded' },
      },
      'sha256:abc',
    );
    expect(summary).toMatchObject({
      digest: 'sha256:abc',
      agentName: 'planner',
      trustAnchor: 'ed25519:anchor',
      effect: 'allow',
      outcome: 'succeeded',
      references: ['a'],
    });
  });
});

describe('HTTP OAT client', () => {
  it('calls the configured endpoints', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path === '/oat/custom/pending') return json({ approvals: [{ id: 'r1', action: 'repo.edit' }] });
      if (path === '/oat/custom/r1/yes' && init?.method === 'POST')
        return json({ status: 'executed', receipt_digest: 'sha256:9' });
      if (path === '/oat/v1/verify')
        return json({ ok: true, checks: [{ name: 'structure', status: 'pass', detail: '' }] });
      return json({ error: 'not found' }, 404);
    });
    const client = new HttpOatClient(
      '/oat',
      { ...DEFAULT_OAT_PATHS, pendingApprovals: '/custom/pending', approve: '/custom/{id}/yes' },
      fetchFn,
    );
    expect((await client.pendingApprovals())[0]?.id).toBe('r1');
    expect(await client.approve('r1')).toEqual({ status: 'executed', receiptDigest: 'sha256:9' });
    expect((await client.verify({})).ok).toBe(true);
    await expect(client.activity()).rejects.toThrow('not found');
  });
});

describe('mock OAT client', () => {
  it('approving moves the request into the activity with a verifiable receipt', async () => {
    const client = new MockOatClient(0);
    const [request] = await client.pendingApprovals();
    expect(request?.resource).toBe('python/omf/core/services/routing.py');

    const result = await client.approve(request!.id);
    expect(result.status).toBe('executed');
    expect(await client.pendingApprovals()).toEqual([]);

    const receipt = await client.receipt(result.receiptDigest!);
    expect(receipt.approval?.decision).toBe('approved');
    const report = await client.verify(receipt.document);
    expect(report.checks.find((c) => c.name === 'approval')?.status).toBe('pass');
    expect(report.checks).toHaveLength(11);
    await expect(client.approve(request!.id)).rejects.toThrow('no pending request');
  });

  it('a request refused before policy has no receipt', async () => {
    const entries = await new MockOatClient(0).activity();
    const refused = entries.find((e) => e.status === 'refused');
    expect(refused?.receiptDigest).toBeNull();
  });
});

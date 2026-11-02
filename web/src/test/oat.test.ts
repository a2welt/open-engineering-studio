import { describe, expect, it, vi } from 'vitest';

import {
  activityFromAction,
  activityFromReceipt,
  digestOf,
  fillPath,
  HttpOatClient,
  parsePending,
  receiptStatus,
  summarizeReceipt,
} from '../api/oat/http';
import { MockOatClient } from '../api/oat/mock';
import { DEFAULT_OAT_PATHS } from '../api/oat/types';
import { readConfig } from '../config';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('OAT configuration', () => {
  it('merges endpoint path overrides and ignores unknown keys', () => {
    const config = readConfig({
      VITE_OAT_MODE: 'http',
      VITE_OAT_PATHS: '{"actions": "/api/actions", "bogus": "/x", "verify": 3}',
    });
    expect(config.oat.mode).toBe('http');
    expect(config.oat.paths.actions).toBe('/api/actions');
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

    const action = parsePending({
      id: 'act_1',
      status: 'pending_approval',
      agent: 'ed25519:a',
      agent_name: 'coding agent',
      action: 'mcp.fs.write_file',
      resource: 'src/app.py',
      references: ['recall:memory:y'],
      request: { requested_at: '2026-11-02T10:00:00Z', arguments: { path: 'src/app.py' } },
      decision: { effect: 'require_approval', rule_id: 'writes', reason: 'Writes need review' },
      created_at: '2026-11-02T10:00:01Z',
    });
    expect(action).toMatchObject({
      agentName: 'coding agent',
      ruleId: 'writes',
      reason: 'Writes need review',
      requestedAt: '2026-11-02T10:00:00Z',
      references: ['recall:memory:y'],
      change: null,
    });

    const running = activityFromAction({ id: 'act_2', status: 'allowed', decision: { effect: 'allow' } });
    expect(running).toMatchObject({ status: 'running', effect: 'allow', receiptDigest: null });
  });

  it('maps receipts to activity statuses', () => {
    const receipt = (outcome: object, effect: string, approval: object | null = null) => ({
      outcome,
      decision: { effect },
      approval,
    });
    expect(receiptStatus(receipt({ status: 'succeeded' }, 'allow'))).toBe('executed');
    expect(receiptStatus(receipt({ status: 'failed', error_type: 'ToolError' }, 'allow'))).toBe('failed');
    expect(receiptStatus(receipt({ status: 'failed', error_type: 'OutcomeNotReported' }, 'allow'))).toBe(
      'expired',
    );
    expect(receiptStatus(receipt({ status: 'not_executed' }, 'deny'))).toBe('denied');
    expect(receiptStatus(receipt({ status: 'not_executed' }, 'require_approval'))).toBe('expired');
    expect(
      receiptStatus(receipt({ status: 'not_executed' }, 'require_approval', { decision: 'rejected' })),
    ).toBe('rejected');
    const entry = activityFromReceipt('agentproof:sha256:1', {
      id: 'rcp_1',
      issued_at: '2026-11-02T10:00:00Z',
      request: { action: 'mcp.fs.read_file', resource: 'a' },
      delegation_chain: [{ subject_name: 'coder' }],
      decision: { effect: 'allow' },
      outcome: { status: 'succeeded' },
    });
    expect(entry).toMatchObject({ agentName: 'coder', receiptDigest: 'sha256:1', status: 'executed' });
    expect(digestOf('sha256:2')).toBe('sha256:2');
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
  it('speaks the oat serve API', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path === '/oat/v1/approvals')
        return json({ approvals: [{ id: 'act_1', action: 'mcp.fs.write_file', status: 'pending_approval' }] });
      if (path === '/oat/v1/approvals/act_1' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ decision: 'rejected', reason: 'no' });
        return json({ id: 'act_1', status: 'rejected', receipt_ref: 'agentproof:sha256:9' });
      }
      if (path === '/oat/v1/receipts?limit=50')
        return json({
          total: 1,
          receipts: [
            {
              ref: 'agentproof:sha256:9',
              receipt: {
                id: 'rcp_9',
                issued_at: '2026-11-02T10:00:00Z',
                request: { action: 'mcp.fs.write_file', resource: 'a' },
                decision: { effect: 'require_approval' },
                approval: { decision: 'rejected' },
                outcome: { status: 'not_executed' },
              },
            },
          ],
        });
      if (path === '/oat/v1/actions')
        return json({
          actions: [
            { id: 'act_2', status: 'allowed', created_at: '2026-11-02T11:00:00Z', receipt: null },
            { id: 'act_1', status: 'rejected', created_at: '2026-11-02T10:00:00Z', receipt: {} },
          ],
        });
      if (path === '/oat/v1/receipts/sha256%3A9')
        return json({ ref: 'agentproof:sha256:9', receipt: { id: 'rcp_9' } });
      if (path === '/oat/v1/verify')
        return json({ ok: true, checks: [{ name: 'structure', status: 'pass', detail: '' }] });
      if (path === '/oat/v1/ledger') return new Response('{"id":"rcp_9"}\n');
      return json({ error: 'not found' }, 404);
    });
    const client = new HttpOatClient('/oat', DEFAULT_OAT_PATHS, fetchFn);
    expect((await client.pendingApprovals())[0]?.id).toBe('act_1');
    expect(await client.reject('act_1', 'no')).toEqual({ status: 'rejected', receiptDigest: 'sha256:9' });
    const activity = await client.activity();
    expect(activity.map((e) => [e.id, e.status])).toEqual([
      ['act_2', 'running'],
      ['rcp_9', 'rejected'],
    ]);
    expect((await client.receipt('sha256:9')).digest).toBe('sha256:9');
    expect((await client.verify({})).ok).toBe(true);
    expect(await client.ledger()).toContain('rcp_9');
    await expect(
      new HttpOatClient('/oat', { ...DEFAULT_OAT_PATHS, actions: '/missing' }, fetchFn).activity(),
    ).rejects.toThrow('not found');
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

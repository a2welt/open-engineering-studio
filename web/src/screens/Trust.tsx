import { useCallback, useEffect, useId, useState } from 'react';

import {
  ACTION_LABELS,
  type ActivityEntry,
  CHECK_LABELS,
  type PendingApproval,
  type ReceiptSummary,
  type VerificationReport,
} from '../api/oat/types';
import { Guard } from '../components/crew';
import { CheckIcon, DownloadIcon } from '../components/icons';
import { useServices } from '../services';
import type { Route } from '../state';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function clock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

const STATUS: Record<ActivityEntry['status'], { label: string; tone: string }> = {
  executed: { label: 'Allowed', tone: 'green' },
  running: { label: 'Running', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  pending: { label: 'Needs approval', tone: 'amber' },
  denied: { label: 'Denied', tone: 'red' },
  rejected: { label: 'Rejected', tone: 'red' },
  expired: { label: 'Expired', tone: 'outline' },
  refused: { label: 'Out of scope', tone: 'outline' },
};

function receiptLabel(entry: ActivityEntry): string {
  if (entry.status === 'pending') return 'Waiting for you';
  if (entry.status === 'running') return 'Receipt when done';
  if (!entry.receiptDigest) return 'No receipt';
  if (entry.verified === false) return 'Failed verification';
  return entry.verified ? 'Verified' : 'Receipt';
}

interface ApprovalCardProps {
  request: PendingApproval;
  affectedFiles: number | null;
  busy: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onNavigate: (route: Route) => void;
}

function ApprovalCard({ request, affectedFiles, busy, onApprove, onReject, onNavigate }: ApprovalCardProps) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const reasonId = useId();
  const headingId = useId();
  const decisions = request.references.filter((r) => r.startsWith('recall:memory:'));
  const verb = (ACTION_LABELS[request.action] ?? request.action).toLowerCase();
  return (
    <section className="approval" aria-labelledby={headingId}>
      <Guard size={72} className="float" />
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div className="eyebrow">
          Guard needs your decision{request.ruleId ? ` · rule ${request.ruleId}` : ''}
        </div>
        <h2 id={headingId}>
          The {request.agentName} wants to {verb} <code style={{ fontSize: '0.9em' }}>{fileName(request.resource)}</code>
        </h2>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          {request.reason} <span className="mono">{request.resource}</span>
        </p>
        <div className="chips">
          {request.change && (
            <span className="chip">
              +{request.change.linesAdded} −{request.change.linesRemoved} lines
            </span>
          )}
          {affectedFiles !== null && <span className="chip affected">{affectedFiles} affected files</span>}
          {request.change?.testsPassed === true && <span className="chip green">Tests passed</span>}
          {request.change?.testsPassed === false && <span className="chip red">Tests failed</span>}
          {decisions.map((ref) => (
            <span key={ref} className="chip purple" title={ref}>
              Linked decision
            </span>
          ))}
        </div>
        {rejecting ? (
          <form
            className="actions"
            onSubmit={(e) => {
              e.preventDefault();
              onReject(reason.trim());
            }}
          >
            <label className="field" htmlFor={reasonId} style={{ flex: '1 1 100%' }}>
              Why are you rejecting it? (optional, recorded in the receipt)
              <textarea id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <button type="submit" className="button filled" disabled={busy}>
              Reject request
            </button>
            <button type="button" className="button outlined" onClick={() => setRejecting(false)} disabled={busy}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="actions">
            <button type="button" className="button success" onClick={onApprove} disabled={busy}>
              <CheckIcon size={18} />
              Approve and sign
            </button>
            <button type="button" className="button outlined" onClick={() => setRejecting(true)} disabled={busy}>
              Reject
            </button>
            <a
              className="button text"
              href="#/understand"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('understand');
              }}
            >
              View impact
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

function ReceiptPanel({
  receipt,
  report,
  error,
  onDownloadLedger,
}: {
  receipt: ReceiptSummary | null;
  report: VerificationReport | null;
  error: string | null;
  onDownloadLedger: () => void;
}) {
  if (error) {
    return (
      <aside aria-label="Receipt" className="card side receipt">
        <div className="notice error" role="alert">
          {error}
        </div>
      </aside>
    );
  }
  if (!receipt) {
    return (
      <aside aria-label="Receipt" className="card side receipt">
        <h2>Receipt</h2>
        <p className="muted" style={{ margin: 0 }}>
          Pick an action with a receipt to see who allowed it and check it.
        </p>
      </aside>
    );
  }
  const count = (status: string) => report?.checks.filter((c) => c.status === status).length ?? 0;
  const [passed, skipped, failed] = [count('pass'), count('skip'), count('fail')];
  const checkSummary = !report
    ? 'Checking…'
    : failed
      ? `${report.checks.length} independent checks: ${failed} failed`
      : skipped
        ? `${report.checks.length} independent checks: ${passed} passed, ${skipped} not needed`
        : `${report.checks.length} independent checks, all passed`;
  return (
    <aside aria-label="Receipt" className="card side receipt">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2>Receipt · {clock(receipt.issuedAt)}</h2>
        {report && (
          <span className={`chip ${report.ok ? 'green' : 'red'}`} style={{ marginLeft: 'auto' }}>
            {report.ok ? <CheckIcon size={14} /> : null}
            {report.ok ? 'Verified' : 'Verification failed'}
          </span>
        )}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {ACTION_LABELS[receipt.action] ?? receipt.action} <span className="mono">{receipt.resource}</span> ·
        decision <strong>{receipt.effect.replace('_', ' ')}</strong>, outcome {receipt.outcome.replace('_', ' ')}
      </p>

      <div className="section-label">Who allowed it</div>
      <ol className="chain">
        <li>
          <span className="step">1</span>
          <span>
            <strong>Trust anchor</strong>{' '}
            <span className="subtle mono" title={receipt.trustAnchor}>
              {receipt.trustAnchor.slice(0, 20)}…
            </span>
          </span>
        </li>
        {receipt.chain.map((link, index) => (
          <li key={link.keyId + index}>
            <span className="step">{index + 2}</span>
            <span>
              <strong>{link.name}</strong> <span className="subtle">{link.actions.join(', ')}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="section-label">
        {checkSummary}
      </div>
      {report && (
        <ul className="checks">
          {report.checks.map((check) => (
            <li key={check.name} title={check.detail}>
              <span className={`check-mark ${check.status}`} aria-hidden="true">
                {check.status === 'pass' ? '✓' : check.status === 'skip' ? '–' : '✕'}
              </span>
              <span>
                {CHECK_LABELS[check.name] ?? check.name}
                {check.status === 'skip' && <span className="visually-hidden"> (skipped)</span>}
                {check.status === 'fail' && <span className="visually-hidden"> (failed: {check.detail})</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {receipt.references.length > 0 && (
        <>
          <div className="section-label">References</div>
          <ul className="file-list">
            {receipt.references.map((ref) => (
              <li key={ref}>{ref}</li>
            ))}
          </ul>
        </>
      )}
      <div className="chips">
        <button
          type="button"
          className="button tonal"
          onClick={() =>
            download(`${receipt.id}.json`, JSON.stringify(receipt.document, null, 2), 'application/json')
          }
        >
          <DownloadIcon size={18} />
          Download receipt
        </button>
        <button type="button" className="button outlined" onClick={onDownloadLedger}>
          Export ledger
        </button>
      </div>
      <p className="subtle" style={{ margin: 0 }}>
        Anyone can re-run these checks offline with <code>oat proof verify</code>.
      </p>
    </aside>
  );
}

interface TrustProps {
  onPendingChange: (count: number) => void;
  affectedFilesFor: (path: string) => Promise<number | null>;
  onNavigate: (route: Route) => void;
}

export function Trust({ onPendingChange, affectedFilesFor, onNavigate }: TrustProps) {
  const { oat } = useServices();
  const [pending, setPending] = useState<PendingApproval[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [affected, setAffected] = useState<Record<string, number | null>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptSummary | null>(null);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const select = useCallback((digest: string) => {
    setSelected(digest);
    setReport(null);
    setReceiptError(null);
  }, []);

  const apply = useCallback(
    ([nextPending, nextActivity]: [PendingApproval[], ActivityEntry[]]) => {
      setPending(nextPending);
      setActivity(nextActivity);
      onPendingChange(nextPending.length);
      setError(null);
    },
    [onPendingChange],
  );

  const refresh = async () => {
    try {
      apply(await Promise.all([oat.pendingApprovals(), oat.activity()]));
    } catch (err) {
      setError(message(err));
    }
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([oat.pendingApprovals(), oat.activity()]).then(
      (data) => {
        if (cancelled) return;
        apply(data);
        const first = data[1].find((e) => e.receiptDigest);
        if (first?.receiptDigest) select(first.receiptDigest);
      },
      (err: unknown) => {
        if (!cancelled) setError(message(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [oat, apply, select]);

  useEffect(() => {
    for (const request of pending ?? []) {
      if (request.resource in affected) continue;
      void affectedFilesFor(request.resource).then((count) =>
        setAffected((prev) => ({ ...prev, [request.resource]: count })),
      );
    }
  }, [pending, affected, affectedFilesFor]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      try {
        const summary = await oat.receipt(selected);
        if (cancelled) return;
        setReceipt(summary);
        const verification = await oat.verify(summary.document);
        if (!cancelled) setReport(verification);
      } catch (err) {
        if (!cancelled) setReceiptError(message(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [oat, selected]);

  const decide = async (request: PendingApproval, approve: boolean, reason?: string) => {
    setBusy(true);
    try {
      const result = approve ? await oat.approve(request.id, reason) : await oat.reject(request.id, reason);
      setAnnouncement(
        approve
          ? `Approved and signed. The ${request.agentName} may ${(ACTION_LABELS[request.action] ?? request.action).toLowerCase()} ${request.resource}.`
          : `Rejected. The ${request.agentName} will not ${(ACTION_LABELS[request.action] ?? request.action).toLowerCase()} ${request.resource}.`,
      );
      await refresh();
      if (result.receiptDigest) select(result.receiptDigest);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const exportLedger = async () => {
    try {
      download('ledger.jsonl', await oat.ledger(), 'application/x-ndjson');
    } catch (err) {
      setError(message(err));
    }
  };

  return (
    <>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      {oat.mode === 'mock' && (
        <div className="notice" role="status">
          Sample session: OpenAgentTrust is not connected, so this screen uses the built-in mock. Set{' '}
          <code>VITE_OAT_MODE=http</code> and run <code>oat serve</code> to use the real gateway.
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          OpenAgentTrust: {error}
        </div>
      )}
      <div className="row">
        <section className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {pending === null && !error && <p className="muted">Loading approvals…</p>}
          {pending?.map((request) => (
            <ApprovalCard
              key={request.id}
              request={request}
              affectedFiles={affected[request.resource] ?? null}
              busy={busy}
              onApprove={() => void decide(request, true)}
              onReject={(reason) => void decide(request, false, reason || undefined)}
              onNavigate={onNavigate}
            />
          ))}
          {pending?.length === 0 && (
            <div className="card" style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Guard size={48} />
              <div>
                <h2>Nothing waiting for you</h2>
                <p className="muted" style={{ margin: 0 }}>
                  Guard will ask here when an agent wants to do something your policy reserves for a human.
                </p>
              </div>
            </div>
          )}

          <section className="card" aria-labelledby="activity-title">
            <h2 id="activity-title">Today's agent activity</h2>
            <ul className="activity">
              {activity.map((entry) => {
                const status = STATUS[entry.status];
                const label = ACTION_LABELS[entry.action] ?? entry.action;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-pressed={selected !== null && entry.receiptDigest === selected}
                      disabled={!entry.receiptDigest}
                      onClick={() => entry.receiptDigest && select(entry.receiptDigest)}
                      title={entry.note ?? undefined}
                    >
                      <span className="time">{clock(entry.at)}</span>{' '}
                      <span className="what">
                        <strong>{label}</strong> <span className="mono">{entry.resource}</span>
                      </span>{' '}
                      <span className={`chip ${status.tone}`}>{status.label}</span>{' '}
                      <span className="subtle">{receiptLabel(entry)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="subtle" style={{ margin: 0 }}>
              Requests outside the agent's delegated authority are refused before policy runs, so they have no receipt.
            </p>
          </section>
        </section>
        <ReceiptPanel receipt={receipt} report={report} error={receiptError} onDownloadLedger={() => void exportLedger()} />
      </div>
    </>
  );
}

import { useState } from 'react';
import { Check, Clock, ShieldAlert, X } from 'lucide-react';
import { formatMoney, formatRelativeTime, type AuthorizationView } from '../api';

interface ApprovalsQueueProps {
  approvals: AuthorizationView[];
  onApprove: (authId: string) => Promise<void>;
  onReject: (authId: string) => Promise<void>;
}

export function ApprovalsQueue({ approvals, onApprove, onReject }: ApprovalsQueueProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleAction = async (authId: string, fn: (id: string) => Promise<void>) => {
    setBusyId(authId);
    try {
      await fn(authId);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-xl border border-amber-500/30 bg-slate-900/75 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <ShieldAlert className="h-5 w-5 text-amber-400" />
          <div>
            <h2 className="text-base font-semibold text-white">
              Pending High-Value Approvals
            </h2>
            <p className="text-xs text-slate-400">
              Authorizations exceeding autonomous threshold waiting for operator sign-off
            </p>
          </div>
        </div>
        <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-mono text-xs font-semibold text-amber-300">
          {approvals.length} pending
        </span>
      </div>

      {approvals.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-5 text-center text-xs text-slate-400">
          All high-value requests are cleared. No pending escalations.
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((item) => (
            <div
              key={item.id}
              className="flex flex-col justify-between gap-3 rounded-xl border border-amber-500/25 bg-slate-950/80 p-4 sm:flex-row sm:items-center"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-white">
                    {formatMoney(item.amountCents, item.currency)}
                  </span>
                  <span className="text-slate-400">at</span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-sky-300">
                    {item.vendorDomain}
                  </span>
                  <span className="rounded bg-slate-800/80 px-2 py-0.5 text-[11px] text-slate-300">
                    {item.agentName ?? item.agentId}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                    <Clock className="h-3 w-3" /> {formatRelativeTime(item.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-slate-300">{item.purpose}</p>
                <p className="font-mono text-[11px] text-slate-500">
                  {item.id} · category: {item.category}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  disabled={busyId === item.id}
                  onClick={() => handleAction(item.id, onReject)}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" /> Reject
                </button>
                <button
                  disabled={busyId === item.id}
                  onClick={() => handleAction(item.id, onApprove)}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" /> Approve &amp; Mint Card
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

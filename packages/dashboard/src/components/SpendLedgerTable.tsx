import { Fragment, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Download,
  FileSearch,
  Receipt
} from 'lucide-react';
import {
  formatMoney,
  formatRelativeTime,
  type AgentWalletWithMetrics,
  type AuthorizationView
} from '../api';

interface SpendLedgerTableProps {
  authorizations: AuthorizationView[];
  agents: AgentWalletWithMetrics[];
  onAuditMissing: () => Promise<void>;
}

const AUTH_STATUS_STYLES: Record<string, string> = {
  approved: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  pending_approval: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  settled: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  reconciled: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  voided: 'bg-slate-700/40 text-slate-400 border-slate-700',
  expired: 'bg-slate-700/40 text-slate-400 border-slate-700'
};

const RECEIPT_STATUS_STYLES: Record<string, string> = {
  matched: 'bg-emerald-500/15 text-emerald-300',
  mismatch: 'bg-amber-500/20 text-amber-300',
  missing_flagged: 'bg-rose-500/20 text-rose-300',
  pending: 'bg-slate-800 text-slate-300',
  not_applicable: 'bg-slate-900 text-slate-500'
};

export function SpendLedgerTable({
  authorizations,
  agents,
  onAuditMissing
}: SpendLedgerTableProps) {
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [receiptFilter, setReceiptFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [auditing, setAuditing] = useState(false);

  const filtered = useMemo(() => {
    return authorizations.filter((item) => {
      if (agentFilter !== 'all' && item.agentId !== agentFilter) return false;
      if (receiptFilter !== 'all' && item.receiptStatus !== receiptFilter) return false;
      return true;
    });
  }, [authorizations, agentFilter, receiptFilter]);

  const handleAudit = async () => {
    setAuditing(true);
    try {
      await onAuditMissing();
    } finally {
      setAuditing(false);
    }
  };

  const exportUrl = (format: 'csv' | 'json') => {
    const params = new URLSearchParams({ format });
    if (agentFilter !== 'all') params.set('agentId', agentFilter);
    return `/api/ledger/export?${params.toString()}`;
  };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Receipt className="h-5 w-5 text-sky-400" />
          <div>
            <h2 className="text-base font-semibold text-white">
              Spend Authorizations &amp; Receipt Ledger
            </h2>
            <p className="text-xs text-slate-400">
              Pre-purchase policy decisions, virtual cards, and reconciled receipt line items
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            <option value="all">All Agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <select
            value={receiptFilter}
            onChange={(e) => setReceiptFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            <option value="all">All Receipt States</option>
            <option value="matched">Matched</option>
            <option value="mismatch">Mismatch</option>
            <option value="missing_flagged">Missing Flagged</option>
            <option value="pending">Pending Receipt</option>
          </select>

          <button
            onClick={handleAudit}
            disabled={auditing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-50"
          >
            <FileSearch className="h-3.5 w-3.5" />
            {auditing ? 'Auditing...' : 'Audit Missing Receipts'}
          </button>

          <a
            href={exportUrl('csv')}
            download="agent-spend-ledger.csv"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </a>

          <a
            href={exportUrl('json')}
            download="agent-spend-ledger.json"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" /> Export JSON
          </a>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/90 text-[11px] uppercase tracking-wider text-slate-400">
              <th className="w-8 px-3 py-3"></th>
              <th className="px-3 py-3">Agent &amp; Vendor</th>
              <th className="px-3 py-3">Authorized</th>
              <th className="px-3 py-3">Card</th>
              <th className="px-3 py-3">Decision</th>
              <th className="px-3 py-3">Receipt Match</th>
              <th className="px-3 py-3 text-right">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 bg-slate-950/40">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No ledger entries match the selected filters.
                </td>
              </tr>
            ) : (
              filtered.map((item) => {
                const isExpanded = expandedId === item.id;
                const discrepancy = item.receipt?.discrepancyCents ?? 0;

                return (
                  <Fragment key={item.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="cursor-pointer transition hover:bg-slate-900/80"
                    >
                      <td className="px-3 py-3 text-slate-500">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-slate-100">{item.vendorDomain}</div>
                        <div className="text-[11px] text-slate-400">
                          {item.agentName ?? item.agentId} · {item.category}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono">
                        <div className="font-semibold text-white">
                          {formatMoney(item.amountCents, item.currency)}
                        </div>
                        {item.settledAmountCents !== null &&
                          item.settledAmountCents !== item.amountCents && (
                            <div className="text-[11px] text-amber-300">
                              Settled: {formatMoney(item.settledAmountCents, item.currency)}
                            </div>
                          )}
                      </td>
                      <td className="px-3 py-3 font-mono text-slate-300">
                        {item.card ? (
                          <span className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-0.5 text-[11px]">
                            <CreditCard className="h-3 w-3 text-slate-400" />
                            •••• {item.card.last4}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                            AUTH_STATUS_STYLES[item.status] ?? 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {item.status}
                        </span>
                        <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                          {item.decisionCode}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              RECEIPT_STATUS_STYLES[item.receiptStatus] ??
                              'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {item.receiptStatus}
                          </span>
                          {item.receiptStatus === 'mismatch' && discrepancy !== 0 && (
                            <span className="inline-flex items-center gap-0.5 font-mono text-[11px] text-amber-300">
                              <AlertTriangle className="h-3 w-3" />
                              {discrepancy > 0 ? '+' : ''}
                              {formatMoney(discrepancy, item.currency)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-[11px] text-slate-400">
                        {formatRelativeTime(item.createdAt)}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-slate-900/90">
                        <td colSpan={7} className="px-6 py-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                Authorization Metadata
                              </div>
                              <p className="text-xs text-slate-200">
                                <span className="text-slate-400">Purpose:</span> {item.purpose}
                              </p>
                              <p className="text-xs text-slate-300">
                                <span className="text-slate-400">Decision Reason:</span>{' '}
                                {item.decisionReason}
                              </p>
                              <p className="font-mono text-[11px] text-slate-400">
                                ID: {item.id} · Decided by: {item.decidedBy}
                              </p>
                              {item.card && (
                                <p className="font-mono text-[11px] text-slate-400">
                                  Card: {item.card.maskedPan} ({item.card.status}) · Token:{' '}
                                  {item.card.paymentToken}
                                </p>
                              )}
                            </div>

                            <div className="space-y-2">
                              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                Reconciled Receipt
                              </div>
                              {item.receipt ? (
                                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-medium text-white">
                                      {item.receipt.merchant} ({item.receipt.rawFormat.toUpperCase()})
                                    </span>
                                    <span className="font-mono text-emerald-300">
                                      Total: {formatMoney(item.receipt.totalCents, item.receipt.currency)}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[11px] text-slate-400">
                                    {item.receipt.reconciliationNotes}
                                  </p>
                                  {item.receipt.lineItems.length > 0 && (
                                    <ul className="mt-2 space-y-1 border-t border-slate-800 pt-2 text-[11px] text-slate-300">
                                      {item.receipt.lineItems.map((li, idx) => (
                                        <li key={idx} className="flex justify-between gap-2">
                                          <span>
                                            {li.quantity}× {li.description}
                                          </span>
                                          <span className="font-mono">
                                            {formatMoney(li.totalCents, item.receipt!.currency)}
                                          </span>
                                        </li>
                                      ))}
                                      <li className="flex justify-between gap-2 border-t border-slate-800/70 pt-1 text-slate-400">
                                        <span>Tax</span>
                                        <span className="font-mono">
                                          {formatMoney(item.receipt.taxCents, item.receipt.currency)}
                                        </span>
                                      </li>
                                    </ul>
                                  )}
                                </div>
                              ) : (
                                <div className="rounded-lg border border-dashed border-slate-800 p-3 text-xs text-slate-500">
                                  No receipt uploaded for this authorization yet.
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  CheckCircle2,
  FlaskConical,
  RefreshCw,
  Shield,
  Sparkles,
  Wallet
} from 'lucide-react';
import {
  dashboardApi,
  formatMoney,
  formatRelativeTime,
  type CreateAgentInput,
  type DashboardOverview,
  type UpdateAgentInput
} from './api';
import { AgentWalletsPanel } from './components/AgentWalletsPanel';
import { ApprovalsQueue } from './components/ApprovalsQueue';
import { ReceiptWorkbench } from './components/ReceiptWorkbench';
import { SpendLedgerTable } from './components/SpendLedgerTable';
import { SpendPlaygroundModal } from './components/SpendPlaygroundModal';

export default function App() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [autoPoll, setAutoPoll] = useState(true);
  const [playgroundOpen, setPlaygroundOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const loadOverview = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const data = await dashboardApi.getOverview();
      setOverview(data);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to load dashboard overview');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (!autoPoll) return;
    const timer = setInterval(() => {
      void loadOverview(true);
    }, 3500);
    return () => clearInterval(timer);
  }, [autoPoll, loadOverview]);

  const handleRunSimulation = async () => {
    setSimulating(true);
    setBanner(null);
    try {
      await dashboardApi.runSimulation();
      await loadOverview();
      setBanner('3-agent simulation completed and persisted to SQLite ledger.');
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setSimulating(false);
    }
  };

  const summary = overview?.summary;
  const openForReceipts =
    overview?.authorizations.filter(
      (a) =>
        (a.status === 'approved' || a.status === 'settled') &&
        (a.receiptStatus === 'pending' || a.receiptStatus === 'missing_flagged')
    ) ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">agent-spend-kit</h1>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                  v0.1 · Local Virtual Card Simulator
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Autonomous AI Agent Budget Controller, Policy Engine &amp; Receipt Ledger
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setAutoPoll((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                autoPoll
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-700 bg-slate-900 text-slate-400'
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              {autoPoll ? 'Live Polling ON' : 'Live Polling OFF'}
            </button>

            <button
              onClick={() => void loadOverview()}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            <button
              onClick={() => setPlaygroundOpen(true)}
              disabled={!overview || overview.agents.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/25 disabled:opacity-40"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Test Spend Request
            </button>

            <button
              onClick={handleRunSimulation}
              disabled={simulating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {simulating ? 'Running Simulation...' : 'Run 3-Agent Simulation'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {banner && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-200">
            <span>{banner}</span>
            <button onClick={() => setBanner(null)} className="text-slate-400 hover:text-white">
              Dismiss
            </button>
          </div>
        )}

        {loading && !overview ? (
          <div className="py-16 text-center text-sm text-slate-400">
            Loading control plane state...
          </div>
        ) : (
          <>
            {/* Top KPI Cards */}
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Committed / Envelope</span>
                  <Wallet className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="mt-2 font-mono text-2xl font-bold text-white">
                  {formatMoney(summary?.totalCommittedCents ?? 0)}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  of {formatMoney(summary?.totalEnvelopeCents ?? 0)} allocated · Settled:{' '}
                  {formatMoney(summary?.totalSettledCents ?? 0)}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>24h Burn Rate &amp; Wallets</span>
                  <Activity className="h-4 w-4 text-sky-400" />
                </div>
                <div className="mt-2 font-mono text-2xl font-bold text-white">
                  {formatMoney(summary?.spend24hCents ?? 0)}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {summary?.activeAgents ?? 0} active ·{' '}
                  <span className={(summary?.frozenAgents ?? 0) > 0 ? 'text-rose-400' : ''}>
                    {summary?.frozenAgents ?? 0} frozen
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Pending High-Value Approvals</span>
                  <AlertOctagon className="h-4 w-4 text-amber-400" />
                </div>
                <div className="mt-2 font-mono text-2xl font-bold text-amber-300">
                  {summary?.pendingApprovalCount ?? 0}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Escalated authorizations awaiting sign-off
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Receipt Reconciliation</span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="mt-2 font-mono text-2xl font-bold text-white">
                  {summary?.receiptMatchedCount ?? 0} matched
                </div>
                <div className="mt-1 flex gap-2 text-xs">
                  <span className="text-amber-300">
                    {summary?.receiptMismatchCount ?? 0} mismatch
                  </span>
                  <span className="text-rose-400">
                    {summary?.receiptMissingCount ?? 0} missing
                  </span>
                  <span className="text-slate-400">
                    {summary?.receiptPendingCount ?? 0} open
                  </span>
                </div>
              </div>
            </section>

            {/* Agent Wallets */}
            <AgentWalletsPanel
              agents={overview?.agents ?? []}
              onFreeze={async (id) => {
                await dashboardApi.freezeAgent(id, 'Frozen from operator dashboard');
                await loadOverview();
              }}
              onUnfreeze={async (id) => {
                await dashboardApi.unfreezeAgent(id);
                await loadOverview();
              }}
              onCreateAgent={async (input: CreateAgentInput) => {
                await dashboardApi.createAgent(input);
                await loadOverview();
              }}
              onUpdateAgent={async (id: string, input: UpdateAgentInput) => {
                await dashboardApi.updateAgent(id, input);
                await loadOverview();
              }}
            />

            {/* Pending Approvals */}
            <ApprovalsQueue
              approvals={overview?.pendingApprovals ?? []}
              onApprove={async (authId) => {
                await dashboardApi.approveAuthorization(authId, 'Approved via dashboard');
                await loadOverview();
              }}
              onReject={async (authId) => {
                await dashboardApi.rejectAuthorization(authId, 'Rejected via dashboard');
                await loadOverview();
              }}
            />

            {/* Ledger Table */}
            <SpendLedgerTable
              authorizations={overview?.authorizations ?? []}
              agents={overview?.agents ?? []}
              onAuditMissing={async () => {
                const res = await dashboardApi.auditMissingReceipts();
                await loadOverview();
                setBanner(
                  `Missing-receipt audit complete: ${res.flaggedCount} settled spend(s) flagged.`
                );
              }}
            />

            {/* Receipt Workbench + Anomaly Feed */}
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <ReceiptWorkbench
                  openAuthorizations={openForReceipts}
                  onIngestReceipt={async (payload) => {
                    const res = await dashboardApi.ingestReceipt(payload);
                    await loadOverview();
                    return res;
                  }}
                />
              </div>

              <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <AlertOctagon className="h-5 w-5 text-rose-400" />
                  <div>
                    <h2 className="text-base font-semibold text-white">Anomaly &amp; Audit Feed</h2>
                    <p className="text-xs text-slate-400">
                      Auto-freezes, mismatches, and missing-receipt alerts
                    </p>
                  </div>
                </div>

                <div className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
                  {(overview?.anomalies ?? []).length === 0 ? (
                    <div className="rounded-lg border border-slate-800 p-4 text-center text-xs text-slate-500">
                      No anomaly events recorded.
                    </div>
                  ) : (
                    overview!.anomalies.map((ev) => (
                      <div
                        key={ev.id}
                        className={`rounded-lg border p-3 text-xs ${
                          ev.severity === 'critical'
                            ? 'border-rose-500/40 bg-rose-950/20'
                            : 'border-amber-500/30 bg-amber-950/15'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`font-mono text-[11px] font-semibold ${
                              ev.severity === 'critical' ? 'text-rose-300' : 'text-amber-300'
                            }`}
                          >
                            {ev.type}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {formatRelativeTime(ev.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-slate-300">{ev.description}</p>
                        <div className="mt-1 font-mono text-[10px] text-slate-500">
                          Agent: {ev.agentId}
                          {ev.autoFrozeWallet ? ' · WALLET AUTO-FROZEN' : ''}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </main>

      {playgroundOpen && overview && (
        <SpendPlaygroundModal
          agents={overview.agents}
          onClose={() => setPlaygroundOpen(false)}
          onRequestSpend={async (payload) => {
            const res = await dashboardApi.requestSpend(payload);
            await loadOverview(true);
            return res;
          }}
          onSimulateCharge={async (payload) => {
            await dashboardApi.simulateCharge(payload);
            await loadOverview(true);
          }}
        />
      )}
    </div>
  );
}

import { useState } from 'react';
import {
  AlertOctagon,
  Edit3,
  Lock,
  Plus,
  ShieldCheck,
  Snowflake,
  Unlock,
  Wallet
} from 'lucide-react';
import {
  formatMoney,
  type AgentWalletWithMetrics,
  type CreateAgentInput,
  type UpdateAgentInput
} from '../api';

interface AgentWalletsPanelProps {
  agents: AgentWalletWithMetrics[];
  onFreeze: (agentId: string) => Promise<void>;
  onUnfreeze: (agentId: string) => Promise<void>;
  onCreateAgent: (input: CreateAgentInput) => Promise<void>;
  onUpdateAgent: (agentId: string, input: UpdateAgentInput) => Promise<void>;
}

interface WalletFormState {
  id: string;
  name: string;
  owner: string;
  totalBudgetDollars: string;
  maxPerTxDollars: string;
  approvalThresholdDollars: string;
  dailyLimitDollars: string;
  monthlyLimitDollars: string;
  maxTxPerHour: string;
  policyMode: 'allowlist' | 'blocklist' | 'open';
  allowedVendors: string;
  blockedVendors: string;
  allowedCategories: string;
  blockedCategories: string;
  autoFreezeOnAnomaly: boolean;
}

function toList(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function ProgressBar({
  value,
  max,
  tone = 'emerald'
}: {
  value: number;
  max: number;
  tone?: 'emerald' | 'sky' | 'amber';
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const barColor =
    pct >= 90
      ? 'bg-rose-500'
      : pct >= 70
        ? 'bg-amber-400'
        : tone === 'sky'
          ? 'bg-sky-400'
          : tone === 'amber'
            ? 'bg-amber-400'
            : 'bg-emerald-400';

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full transition-all duration-300 ${barColor}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function AgentWalletsPanel({
  agents,
  onFreeze,
  onUnfreeze,
  onCreateAgent,
  onUpdateAgent
}: AgentWalletsPanelProps) {
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<WalletFormState>({
    id: '',
    name: '',
    owner: 'platform-team',
    totalBudgetDollars: '500',
    maxPerTxDollars: '100',
    approvalThresholdDollars: '50',
    dailyLimitDollars: '150',
    monthlyLimitDollars: '400',
    maxTxPerHour: '15',
    policyMode: 'allowlist',
    allowedVendors: 'api.openai.com, anthropic.com',
    blockedVendors: '',
    allowedCategories: 'llm_api, infrastructure',
    blockedCategories: 'gambling, crypto',
    autoFreezeOnAnomaly: true
  });

  const openCreate = () => {
    setEditingId(null);
    setError(null);
    setForm({
      id: '',
      name: '',
      owner: 'ai-engineering',
      totalBudgetDollars: '500',
      maxPerTxDollars: '100',
      approvalThresholdDollars: '50',
      dailyLimitDollars: '150',
      monthlyLimitDollars: '400',
      maxTxPerHour: '15',
      policyMode: 'allowlist',
      allowedVendors: 'api.openai.com, anthropic.com',
      blockedVendors: 'casino.example',
      allowedCategories: 'llm_api, search_api',
      blockedCategories: 'gambling, crypto',
      autoFreezeOnAnomaly: true
    });
    setModalMode('create');
  };

  const openEdit = (agent: AgentWalletWithMetrics) => {
    setEditingId(agent.id);
    setError(null);
    setForm({
      id: agent.id,
      name: agent.name,
      owner: agent.owner,
      totalBudgetDollars: (agent.totalBudgetCents / 100).toFixed(2),
      maxPerTxDollars: (agent.maxPerTransactionCents / 100).toFixed(2),
      approvalThresholdDollars: (agent.approvalThresholdCents / 100).toFixed(2),
      dailyLimitDollars: (agent.dailyLimitCents / 100).toFixed(2),
      monthlyLimitDollars: (agent.monthlyLimitCents / 100).toFixed(2),
      maxTxPerHour: String(agent.maxTxPerHour),
      policyMode: agent.policyMode,
      allowedVendors: agent.allowedVendors.join(', '),
      blockedVendors: agent.blockedVendors.join(', '),
      allowedCategories: agent.allowedCategories.join(', '),
      blockedCategories: agent.blockedCategories.join(', '),
      autoFreezeOnAnomaly: agent.autoFreezeOnAnomaly
    });
    setModalMode('edit');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        owner: form.owner.trim() || 'platform-team',
        totalBudgetCents: Math.round(Number(form.totalBudgetDollars) * 100),
        maxPerTransactionCents: Math.round(Number(form.maxPerTxDollars) * 100),
        approvalThresholdCents: Math.round(Number(form.approvalThresholdDollars) * 100),
        dailyLimitCents: Math.round(Number(form.dailyLimitDollars) * 100),
        monthlyLimitCents: Math.round(Number(form.monthlyLimitDollars) * 100),
        maxTxPerHour: Number(form.maxTxPerHour) || 20,
        policyMode: form.policyMode,
        allowedVendors: toList(form.allowedVendors),
        blockedVendors: toList(form.blockedVendors),
        allowedCategories: toList(form.allowedCategories),
        blockedCategories: toList(form.blockedCategories),
        autoFreezeOnAnomaly: form.autoFreezeOnAnomaly
      };

      if (modalMode === 'create') {
        await onCreateAgent({
          ...(form.id.trim() ? { id: form.id.trim() } : {}),
          ...payload
        });
      } else if (modalMode === 'edit' && editingId) {
        await onUpdateAgent(editingId, payload);
      }
      setModalMode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent wallet');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Wallet className="h-5 w-5 text-emerald-400" />
          <div>
            <h2 className="text-base font-semibold text-white">
              Agent Wallets &amp; Spend Envelopes
            </h2>
            <p className="text-xs text-slate-400">
              Real-time burn rate, velocity caps, merchant allowlists/blocklists, and anomaly freezes
            </p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
        >
          <Plus className="h-3.5 w-3.5" />
          New Agent Wallet
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
          No agent wallets configured yet. Click <span className="text-slate-200">New Agent Wallet</span> or{' '}
          <span className="text-emerald-400">Run 3-Agent Simulation</span> above to populate sample traffic.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => {
            const isFrozen = agent.status === 'frozen';
            return (
              <div
                key={agent.id}
                className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                  isFrozen
                    ? 'border-rose-500/50 bg-rose-950/15'
                    : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-white">{agent.name}</h3>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            isFrozen
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-emerald-500/15 text-emerald-300'
                          }`}
                        >
                          {isFrozen ? (
                            <>
                              <Snowflake className="h-3 w-3" /> Frozen
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="h-3 w-3" /> Active
                            </>
                          )}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                        {agent.id} · owner: {agent.owner}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(agent)}
                        title="Edit spend rules"
                        className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      {isFrozen ? (
                        <button
                          onClick={() => onUnfreeze(agent.id)}
                          title="Unfreeze wallet"
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/25"
                        >
                          <Unlock className="h-3 w-3" /> Unfreeze
                        </button>
                      ) : (
                        <button
                          onClick={() => onFreeze(agent.id)}
                          title="Freeze wallet"
                          className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-500/25"
                        >
                          <Lock className="h-3 w-3" /> Freeze
                        </button>
                      )}
                    </div>
                  </div>

                  {isFrozen && agent.freezeReason && (
                    <div className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-rose-500/30 bg-rose-950/40 px-2.5 py-2 text-xs text-rose-200">
                      <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                      <span>{agent.freezeReason}</span>
                    </div>
                  )}

                  <div className="mt-4 space-y-2.5">
                    <div>
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="text-slate-400">Envelope Committed</span>
                        <span className="font-mono text-slate-200">
                          {formatMoney(agent.metrics.committedTotalCents)} /{' '}
                          {formatMoney(agent.totalBudgetCents)}
                        </span>
                      </div>
                      <ProgressBar
                        value={agent.metrics.committedTotalCents}
                        max={agent.totalBudgetCents}
                        tone="emerald"
                      />
                    </div>

                    <div>
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="text-slate-400">24h Burn Rate</span>
                        <span className="font-mono text-slate-200">
                          {formatMoney(agent.metrics.spend24hCents)} /{' '}
                          {formatMoney(agent.dailyLimitCents)}
                        </span>
                      </div>
                      <ProgressBar
                        value={agent.metrics.spend24hCents}
                        max={agent.dailyLimitCents}
                        tone="sky"
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-900/90 p-2.5 text-[11px]">
                    <div>
                      <span className="block text-slate-500">Per-Tx Cap</span>
                      <span className="font-mono font-medium text-slate-200">
                        {formatMoney(agent.maxPerTransactionCents)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-slate-500">Approval &gt;</span>
                      <span className="font-mono font-medium text-amber-300">
                        {formatMoney(agent.approvalThresholdCents)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-slate-500">1h Velocity</span>
                      <span className="font-mono font-medium text-slate-200">
                        {agent.metrics.txCountLastHour}/{agent.maxTxPerHour} tx
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 border-t border-slate-800/80 pt-3 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 font-medium uppercase tracking-wide text-slate-300">
                      {agent.policyMode}
                    </span>
                    {agent.allowedVendors.slice(0, 3).map((v) => (
                      <span
                        key={`allow-${v}`}
                        className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-emerald-300"
                      >
                        +{v}
                      </span>
                    ))}
                    {agent.allowedVendors.length > 3 && (
                      <span className="text-slate-500">
                        +{agent.allowedVendors.length - 3} more
                      </span>
                    )}
                    {agent.blockedVendors.slice(0, 2).map((v) => (
                      <span
                        key={`block-${v}`}
                        className="rounded bg-rose-500/10 px-1.5 py-0.5 font-mono text-rose-300"
                      >
                        -{v}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSubmit}
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
          >
            <h3 className="text-lg font-semibold text-white">
              {modalMode === 'create' ? 'Create Agent Wallet' : `Update Policy: ${editingId}`}
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Configure spend envelopes, escalation threshold, and merchant controls.
            </p>

            {error && (
              <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">
                {error}
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {modalMode === 'create' && (
                <div>
                  <label className="mb-1 block text-xs text-slate-300">
                    Agent ID (optional)
                  </label>
                  <input
                    value={form.id}
                    onChange={(e) => setForm({ ...form, id: e.target.value })}
                    placeholder="agt_custom_bot"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs text-slate-300">Agent Name *</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Code Review Agent"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">Owner</label>
                <input
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">Total Budget (USD)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={form.totalBudgetDollars}
                  onChange={(e) => setForm({ ...form, totalBudgetDollars: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">Max Per Tx (USD)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={form.maxPerTxDollars}
                  onChange={(e) => setForm({ ...form, maxPerTxDollars: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Human Approval Threshold (USD)
                </label>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={form.approvalThresholdDollars}
                  onChange={(e) => setForm({ ...form, approvalThresholdDollars: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">Daily Limit (USD)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={form.dailyLimitDollars}
                  onChange={(e) => setForm({ ...form, dailyLimitDollars: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">Monthly Limit (USD)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={form.monthlyLimitDollars}
                  onChange={(e) => setForm({ ...form, monthlyLimitDollars: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">Max Tx / Hour</label>
                <input
                  required
                  type="number"
                  value={form.maxTxPerHour}
                  onChange={(e) => setForm({ ...form, maxTxPerHour: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">Policy Mode</label>
                <select
                  value={form.policyMode}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      policyMode: e.target.value as 'allowlist' | 'blocklist' | 'open'
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="allowlist">Allowlist (strict)</option>
                  <option value="blocklist">Blocklist</option>
                  <option value="open">Open (caps only)</option>
                </select>
              </div>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Allowed Vendors (comma-separated domains/wildcards)
                </label>
                <input
                  value={form.allowedVendors}
                  onChange={(e) => setForm({ ...form, allowedVendors: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Blocked Vendors (comma-separated)
                </label>
                <input
                  value={form.blockedVendors}
                  onChange={(e) => setForm({ ...form, blockedVendors: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-300">
                    Allowed Categories (blank = any)
                  </label>
                  <input
                    value={form.allowedCategories}
                    onChange={(e) => setForm({ ...form, allowedCategories: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-300">Blocked Categories</label>
                  <input
                    value={form.blockedCategories}
                    onChange={(e) => setForm({ ...form, blockedCategories: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 pt-1 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={form.autoFreezeOnAnomaly}
                  onChange={(e) => setForm({ ...form, autoFreezeOnAnomaly: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500"
                />
                Auto-freeze wallet on repeated blocks or spend spike anomaly
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {submitting ? 'Saving...' : modalMode === 'create' ? 'Create Wallet' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

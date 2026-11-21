import { useState } from 'react';
import { CreditCard, Play, X } from 'lucide-react';
import {
  formatMoney,
  type AgentWalletWithMetrics,
  type RequestSpendResponse
} from '../api';

interface SpendPlaygroundModalProps {
  agents: AgentWalletWithMetrics[];
  onClose: () => void;
  onRequestSpend: (payload: {
    agentId: string;
    vendor: string;
    amountCents: number;
    purpose: string;
    category: string;
  }) => Promise<RequestSpendResponse>;
  onSimulateCharge: (payload: {
    paymentToken: string;
    merchantVendor: string;
    amountCents: number;
  }) => Promise<void>;
}

export function SpendPlaygroundModal({
  agents,
  onClose,
  onRequestSpend,
  onSimulateCharge
}: SpendPlaygroundModalProps) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [vendor, setVendor] = useState('https://api.openai.com/v1');
  const [amountDollars, setAmountDollars] = useState('18.50');
  const [category, setCategory] = useState('llm_api');
  const [purpose, setPurpose] = useState('Run synthesis evaluation batch');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<RequestSpendResponse | null>(null);
  const [charged, setCharged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setCharged(false);
    try {
      const res = await onRequestSpend({
        agentId,
        vendor,
        amountCents: Math.round(Number(amountDollars) * 100),
        purpose,
        category
      });
      setResponse(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCharge = async () => {
    if (!response?.card) return;
    setLoading(true);
    setError(null);
    try {
      await onSimulateCharge({
        paymentToken: response.card.paymentToken,
        merchantVendor: response.authorization.vendorDomain,
        amountCents: response.authorization.amountCents
      });
      setCharged(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Charge simulation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Pre-Purchase Spend Playground</h3>
            <p className="text-xs text-slate-400">
              Test <code className="font-mono text-emerald-300">requestSpend()</code> policy
              evaluation and single-use virtual card issuance
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-slate-300">Agent Wallet</label>
            <select
              required
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.id}) — {a.status}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-300">Vendor / URL</label>
              <input
                required
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-300">Amount (USD)</label>
              <input
                required
                type="number"
                step="0.01"
                value={amountDollars}
                onChange={(e) => setAmountDollars(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-300">Category</label>
            <input
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-300">Purpose</label>
            <input
              required
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !agentId}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {loading ? 'Evaluating Policy...' : 'Execute requestSpend()'}
          </button>
        </form>

        {error && (
          <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-950/50 p-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        {response && (
          <div className="mt-4 space-y-3 rounded-xl border border-slate-700 bg-slate-950 p-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-mono font-semibold text-white">
                {response.decisionCode}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${
                  response.approved
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : response.escalated
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-rose-500/20 text-rose-300'
                }`}
              >
                {response.status}
              </span>
            </div>
            <p className="text-slate-300">{response.reason}</p>

            {response.card && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3 font-mono text-[11px]">
                <div className="mb-1 flex items-center justify-between text-emerald-300">
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <CreditCard className="h-3.5 w-3.5" /> Ephemeral Single-Use Visa
                  </span>
                  <span>Limit: {formatMoney(response.card.spendingLimitCents)}</span>
                </div>
                <div className="text-white">
                  PAN: {response.card.pan} · CVC: {response.card.cvc} · Exp:{' '}
                  {String(response.card.expMonth).padStart(2, '0')}/{response.card.expYear}
                </div>
                <div className="mt-1 text-slate-400">Token: {response.card.paymentToken}</div>

                {!charged ? (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleCharge}
                    className="mt-2.5 rounded-md bg-sky-500 px-3 py-1.5 text-[11px] font-semibold text-slate-950 hover:bg-sky-400"
                  >
                    Simulate Merchant Charge ({formatMoney(response.authorization.amountCents)})
                  </button>
                ) : (
                  <div className="mt-2 font-sans font-medium text-emerald-300">
                    Merchant charge settled. Upload a receipt in the Workbench to reconcile!
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

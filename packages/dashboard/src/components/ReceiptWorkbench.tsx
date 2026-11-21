import { useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { formatMoney, type AuthorizationView, type ReceiptRecord } from '../api';

interface ReceiptWorkbenchProps {
  openAuthorizations: AuthorizationView[];
  onIngestReceipt: (payload: {
    content: string;
    contentType?: 'text' | 'html' | 'json';
    authorizationId?: string;
  }) => Promise<{ receipt: ReceiptRecord; authorization: AuthorizationView | null }>;
}

const SAMPLE_TEXT = `Merchant: OpenAI
Domain: api.openai.com
2 x Batch Token Credits @ $14.00  $28.00
Subtotal: $28.00
Tax: $0.50
Total: $28.50`;

const SAMPLE_HTML = `<!doctype html>
<html>
  <body>
    <h1 data-merchant="Cloudflare">Cloudflare Billing Receipt</h1>
    <p>Website: <a href="https://cloudflare.com">cloudflare.com</a></p>
    <table>
      <tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr>
      <tr><td>Workers & R2 Usage</td><td>1</td><td>$75.00</td><td>$75.00</td></tr>
      <tr><td>Subtotal</td><td>$75.00</td></tr>
      <tr><td>Tax</td><td>$0.00</td></tr>
      <tr><td>Total</td><td>$75.00</td></tr>
    </table>
  </body>
</html>`;

const SAMPLE_JSON = JSON.stringify(
  {
    merchant: 'Neon Inc',
    merchantDomain: 'neon.tech',
    currency: 'USD',
    lineItems: [{ description: 'Neon Scale Compute', quantity: 1, total: '49.00' }],
    subtotal: '49.00',
    tax: '0.00',
    total: '49.00'
  },
  null,
  2
);

export function ReceiptWorkbench({
  openAuthorizations,
  onIngestReceipt
}: ReceiptWorkbenchProps) {
  const [contentType, setContentType] = useState<'text' | 'html' | 'json'>('text');
  const [authorizationId, setAuthorizationId] = useState<string>('');
  const [content, setContent] = useState<string>(SAMPLE_TEXT);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ReceiptRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSample = (fmt: 'text' | 'html' | 'json') => {
    setContentType(fmt);
    setResult(null);
    setError(null);
    if (fmt === 'text') setContent(SAMPLE_TEXT);
    else if (fmt === 'html') setContent(SAMPLE_HTML);
    else setContent(SAMPLE_JSON);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await onIngestReceipt({
        content,
        contentType,
        ...(authorizationId ? { authorizationId } : {})
      });
      setResult(res.receipt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse receipt');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <FileText className="h-5 w-5 text-emerald-400" />
          <div>
            <h2 className="text-base font-semibold text-white">Receipt Ingestion &amp; Parser</h2>
            <p className="text-xs text-slate-400">
              Ingest plain-text, HTML, or JSON receipts to extract line items &amp; reconcile
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          {(['text', 'html', 'json'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => loadSample(fmt)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium uppercase transition ${
                contentType === fmt
                  ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {fmt} sample
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Format</label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value as 'text' | 'html' | 'json')}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="text">Plain Text</option>
              <option value="html">HTML Receipt</option>
              <option value="json">Structured JSON</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">
              Target Authorization (optional — auto-matches otherwise)
            </label>
            <select
              value={authorizationId}
              onChange={(e) => setAuthorizationId(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Auto-match by auth ID / last4 / merchant</option>
              {openAuthorizations.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.vendorDomain} ({formatMoney(a.amountCents)}) — {a.id}
                </option>
              ))}
            </select>
          </div>
        </div>

        <textarea
          rows={7}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
          placeholder="Paste plain-text, HTML, or JSON receipt payload..."
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">
            Extracts merchant, line items, subtotal, tax, total, and detects amount discrepancies.
          </span>
          <button
            type="submit"
            disabled={submitting || !content.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            {submitting ? 'Reconciling...' : 'Ingest & Reconcile'}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-950/50 p-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950 p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-white">
              Parsed {result.merchant} ({result.merchantDomain})
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${
                result.matchStatus === 'matched'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : result.matchStatus === 'mismatch'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-slate-800 text-slate-300'
              }`}
            >
              {result.matchStatus}
            </span>
          </div>
          <p className="mt-1 text-slate-400">{result.reconciliationNotes}</p>
          <div className="mt-2 flex flex-wrap gap-4 font-mono text-[11px] text-slate-300">
            <span>Subtotal: {formatMoney(result.subtotalCents)}</span>
            <span>Tax: {formatMoney(result.taxCents)}</span>
            <span>Total: {formatMoney(result.totalCents)}</span>
            <span>Line Items: {result.lineItems.length}</span>
          </div>
        </div>
      )}
    </section>
  );
}

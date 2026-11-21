# agent-spend-kit

A self-hosted budget controller, virtual-card policy engine, and receipt reconciliation ledger for autonomous AI agents that spend money.

`agent-spend-kit` gives AI agents a clean `requestSpend()` pre-purchase authorization flow while giving operators hard financial guardrails: integer-cent spend envelopes, rolling velocity caps, URL/domain allowlists and blocklists, human-in-the-loop escalation queues, anomaly auto-freezes, single-use virtual cards, and automated multi-format receipt reconciliation.

It ships with a deterministic **Local Virtual Card & Payment Simulator** (zero external API keys required) alongside a clean `CardProvider` interface and a ready-to-use **Stripe Issuing adapter**.

---

## Key Capabilities

- **Agent Wallets & Spend Envelopes**
  - Integer-cent accounting in SQLite (`better-sqlite3` + Drizzle ORM) with `BEGIN IMMEDIATE` write locks to prevent double-spends and race conditions.
  - Per-transaction hard cap, human approval threshold, rolling 24-hour daily limit, rolling 30-day monthly limit, and hourly transaction velocity caps.
  - Merchant `allowlist`, `blocklist`, or `open` modes with URL normalization, parent-domain matching, and wildcard subdomain matching (`*.cloudflare.com`).
  - Automatic wallet freeze on repeated consecutive policy blocks or sudden spend-spike anomalies.
- **Pre-Purchase Authorization API & TypeScript SDK**
  - `requestSpend({ agentId, vendor, amountCents, purpose })` evaluates policy rules atomically and either:
    1. Approves immediately and mints an ephemeral single-use virtual card (`pan`, `cvc`, `expMonth`, `expYear`, `paymentToken`),
    2. Escalates to the operator approval queue (`pending_approval`) while reserving budget, or
    3. Rejects with a structured `decisionCode` and explanation.
  - Supports idempotency keys (`idempotencyKey`) and one-time card credential claiming (`claimApprovedCard`) after operator approval.
- **Receipt Ingestion & Reconciliation**
  - Parses **plain-text**, **HTML** (`<table>` / headings / links), and **JSON** receipts into structured merchant, line items, subtotal, tax, and total cents.
  - Automatically matches receipts to open authorizations via `authorizationId`, `paymentToken`, card `last4`, or merchant + closest amount.
  - Flags amount discrepancies (`mismatch`) and runs missing-receipt audits (`missing_flagged`).
- **Operator Control Plane Dashboard**
  - React + Vite + Tailwind CSS dashboard displaying real-time agent burn rates, envelope utilization, active spend rules, pending high-value approvals, receipt match status, anomaly feed, interactive spend playground, receipt workbench, and CSV/JSON ledger export (with strict PAN/CVC redaction).

---

## Architecture

```text
packages/
├── sdk/         # @agent-spend-kit/sdk — zero-dependency TypeScript client SDK
├── server/      # @agent-spend-kit/server — Hono REST API, SQLite/Drizzle, PolicyEngine, CardProviders, ReceiptReconciler
└── dashboard/   # @agent-spend-kit/dashboard — React + Vite + Tailwind operator dashboard
scripts/
├── dev.ts       # Concurrent API server + Vite dev server
└── simulate.ts  # 3-agent end-to-end simulation (`npm run simulate`)
tests/           # Vitest integration & unit test suites
```

---

## Quickstart

### 1. Install dependencies & build

```bash
npm install
npm run build
```

### 2. Run the 3-agent simulation

```bash
npm run simulate
```

This boots a local Hono + SQLite server backed by `./data/agent-spend.db` and drives three autonomous agents (`agt_researcher`, `agt_cloud_ops`, `agt_growth_bot`) through valid card purchases, blocked unauthorized vendors, over-threshold human approvals, daily cap rejections, consecutive-block auto-freeze, and text/HTML/JSON receipt reconciliation (including a tax discrepancy and a missing-receipt audit).

### 3. Launch the API & Operator Dashboard

```bash
# Development mode (API on :4310 + Vite HMR on :5173)
npm run dev

# Or production mode (single server serving API + compiled dashboard on :4310)
npm run start
```

Open `http://127.0.0.1:5173` (dev) or `http://127.0.0.1:4310` (built).

---

## Agent SDK Usage

```ts
import { AgentSpendClient } from '@agent-spend-kit/sdk';

const spendKit = new AgentSpendClient({
  baseUrl: 'http://127.0.0.1:4310'
});

const decision = await spendKit.requestSpend({
  agentId: 'agt_researcher',
  vendor: 'https://api.openai.com/v1/batches',
  amountCents: 2850,
  category: 'llm_api',
  purpose: 'Batch embeddings for RFC corpus',
  idempotencyKey: 'batch-2026-11-21-01'
});

if (decision.approved && decision.card) {
  console.log('Issued single-use card ending in', decision.card.last4);
  // Use decision.card.pan / cvc / expMonth / expYear or simulate charge:
  await spendKit.simulateCharge({
    paymentToken: decision.card.paymentToken,
    merchantVendor: 'api.openai.com',
    amountCents: 2850
  });

  await spendKit.submitReceipt({
    contentType: 'text',
    content: [
      'Merchant: OpenAI',
      'Domain: api.openai.com',
      `Auth ID: ${decision.authorization.id}`,
      'Subtotal: $26.00',
      'Tax: $2.50',
      'Total: $28.50'
    ].join('\n')
  });
} else if (decision.escalated) {
  const { card } = await spendKit.waitForApproval(decision.authorization.id);
  console.log('Operator approved card:', card?.maskedPan);
} else {
  console.warn('Blocked:', decision.decisionCode, decision.reason);
}
```

---

## Stripe Issuing Adapter Configuration

By default `CARD_PROVIDER=simulator` uses `SimulatorCardProvider`, which deterministically derives Luhn-valid Visa test PANs (`424242...`) and CVCs from `HMAC-SHA256(SIMULATOR_SECRET, authorizationId)`.

To issue live virtual cards through Stripe Issuing instead, copy `.env.example` to `.env` and configure:

```env
CARD_PROVIDER=stripe_issuing
STRIPE_SECRET_KEY=sk_live_or_test_...
STRIPE_ISSUING_CARDHOLDER_ID=ich_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Point Stripe Issuing webhooks to `POST /api/webhooks/stripe-issuing`. The adapter validates the `Stripe-Signature` HMAC header and reconciles `issuing_transaction.created` events onto the authorization ledger.

---

## REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service health & active card provider |
| `GET` | `/api/dashboard/overview` | Summary KPIs, agent metrics, pending approvals, ledger & anomalies |
| `GET` / `POST` | `/api/agents` | List or create agent wallets and spend policies |
| `GET` / `PATCH` | `/api/agents/:id` | Inspect or update an agent's spend rules |
| `POST` | `/api/agents/:id/freeze` & `/unfreeze` | Manually freeze or unfreeze a wallet |
| `POST` | `/api/spend/request` | Evaluate policy & issue single-use card (or escalate/reject) |
| `GET` | `/api/authorizations` | Query authorization ledger (`agentId`, `status`, `receiptStatus`) |
| `POST` | `/api/authorizations/:id/approve` & `/reject` | Operator approval / rejection for escalated spends |
| `POST` | `/api/authorizations/:id/claim-card` | One-time retrieval of ephemeral PAN/CVC after operator approval |
| `POST` | `/api/authorizations/:id/void` | Void an unused authorization & release reserved budget |
| `POST` | `/api/simulator/charge` | Simulate merchant capture against a single-use virtual card token |
| `POST` | `/api/webhooks/stripe-issuing` | Verified Stripe Issuing webhook handler |
| `POST` | `/api/receipts/ingest` | Parse & reconcile a plain-text, HTML, or JSON receipt |
| `POST` | `/api/receipts/audit-missing` | Flag overdue or settled spends missing a reconciled receipt |
| `GET` | `/api/ledger/export?format=csv\|json` | Export redacted ledger (`last4` / `maskedPan` only) |
| `POST` | `/api/simulate` | Reset & run the built-in 3-agent simulation |

---

## Verification & Testing

```bash
npm run typecheck
npm test
npm run build
npm run simulate
```

All tests run against in-memory SQLite (`:memory:`) with no external network dependencies.

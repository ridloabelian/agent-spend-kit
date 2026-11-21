import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { createDatabase, type DatabaseConnection } from './db/client.js';
import { exportLedgerCsv, exportLedgerJson } from './domain/ledger-export.js';
import { DomainError, PolicyEngine } from './domain/policy-engine.js';
import { SimulatorCardProvider } from './providers/simulator-provider.js';
import { StripeIssuingCardProvider } from './providers/stripe-issuing-provider.js';
import type { CardProvider } from './providers/types.js';
import { ReceiptReconciler } from './receipts/reconciler.js';
import { createInProcessClient, runThreeAgentSimulation } from './simulation/scenario.js';

export interface CreateAppOptions {
  databasePath?: string;
  cardProvider?: CardProvider;
  now?: () => Date;
  dashboardDistDir?: string;
}

export interface AppInstance {
  app: Hono;
  dbConn: DatabaseConnection;
  policyEngine: PolicyEngine;
  reconciler: ReceiptReconciler;
  cardProvider: CardProvider;
  close: () => void;
}

const createAgentSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(120),
  owner: z.string().min(1).max(120).optional(),
  currency: z.string().length(3).optional(),
  totalBudgetCents: z.number().int().positive(),
  maxPerTransactionCents: z.number().int().positive(),
  approvalThresholdCents: z.number().int().nonnegative().optional(),
  dailyLimitCents: z.number().int().positive(),
  monthlyLimitCents: z.number().int().positive(),
  maxTxPerHour: z.number().int().positive().optional(),
  policyMode: z.enum(['allowlist', 'blocklist', 'open']).optional(),
  allowedVendors: z.array(z.string()).optional(),
  blockedVendors: z.array(z.string()).optional(),
  allowedCategories: z.array(z.string()).optional(),
  blockedCategories: z.array(z.string()).optional(),
  autoFreezeOnAnomaly: z.boolean().optional(),
  anomalyMaxConsecutiveBlocks: z.number().int().min(1).max(20).optional(),
  anomalySpikeMultiplier: z.number().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const updateAgentSchema = createAgentSchema.partial().omit({ id: true, currency: true });

const requestSpendSchema = z.object({
  agentId: z.string().min(1),
  vendor: z.string().min(1),
  amountCents: z.number().int().positive(),
  purpose: z.string().min(1).max(500),
  category: z.string().min(1).max(80).optional(),
  currency: z.string().length(3).optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const simulateChargeSchema = z.object({
  paymentToken: z.string().min(1),
  merchantVendor: z.string().min(1),
  amountCents: z.number().int().positive(),
  description: z.string().max(300).optional()
});

const ingestReceiptSchema = z.object({
  content: z.union([z.string().min(1), z.record(z.string(), z.unknown())]),
  contentType: z.enum(['text', 'html', 'json']).optional(),
  authorizationId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  paymentToken: z.string().min(1).optional()
});

const auditMissingSchema = z.object({
  olderThanMinutes: z.number().int().nonnegative().optional(),
  includeAllSettled: z.boolean().optional()
});

function resolveDefaultCardProvider(now: () => Date): CardProvider {
  const mode = (process.env.CARD_PROVIDER ?? 'simulator').toLowerCase();
  if (mode === 'stripe_issuing') {
    const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
    const cardholderId = process.env.STRIPE_ISSUING_CARDHOLDER_ID ?? '';
    return new StripeIssuingCardProvider({
      secretKey,
      cardholderId,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || undefined
    });
  }
  return new SimulatorCardProvider({
    secret: process.env.SIMULATOR_SECRET,
    now
  });
}

function resolveDefaultDashboardDistDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), '../../dashboard/dist');
}

export function createApp(options?: CreateAppOptions): AppInstance {
  const now = options?.now ?? (() => new Date());
  const dbPath = options?.databasePath ?? process.env.DATABASE_PATH ?? './data/agent-spend.db';
  const dbConn = createDatabase(dbPath);
  const cardProvider = options?.cardProvider ?? resolveDefaultCardProvider(now);
  const policyEngine = new PolicyEngine(dbConn.sqlite, dbConn.db, cardProvider, now);
  const reconciler = new ReceiptReconciler(dbConn.sqlite, dbConn.db, now);

  const app = new Hono();

  app.use('/api/*', cors());

  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json({ error: err.message, code: err.code }, err.statusCode as 400);
    }
    if (err instanceof z.ZodError) {
      return c.json(
        {
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          issues: err.issues
        },
        400
      );
    }
    console.error('[agent-spend-kit] unhandled error:', err);
    return c.json(
      {
        error: err instanceof Error ? err.message : 'Internal server error',
        code: 'INTERNAL_ERROR'
      },
      500
    );
  });

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      service: 'agent-spend-kit',
      provider: cardProvider.name,
      timestamp: now().toISOString()
    })
  );

  app.get('/api/dashboard/overview', (c) => {
    return c.json(policyEngine.getDashboardOverview());
  });

  // Agent Wallets & Spend Envelopes
  app.get('/api/agents', (c) => {
    return c.json({ agents: policyEngine.listAgents() });
  });

  app.post('/api/agents', async (c) => {
    const body = createAgentSchema.parse(await c.req.json());
    const agent = policyEngine.createAgent(body);
    return c.json({ agent }, 201);
  });

  app.get('/api/agents/:id', (c) => {
    const agent = policyEngine.getAgent(c.req.param('id'));
    return c.json({ agent });
  });

  app.patch('/api/agents/:id', async (c) => {
    const body = updateAgentSchema.parse(await c.req.json());
    const agent = policyEngine.updateAgent(c.req.param('id'), body);
    return c.json({ agent });
  });

  app.post('/api/agents/:id/freeze', async (c) => {
    let reason = 'Manual operator freeze';
    try {
      const parsed = (await c.req.json()) as { reason?: string };
      if (parsed?.reason) reason = parsed.reason;
    } catch {
      // Optional body
    }
    const agent = policyEngine.freezeAgent(c.req.param('id'), reason);
    return c.json({ agent });
  });

  app.post('/api/agents/:id/unfreeze', (c) => {
    const agent = policyEngine.unfreezeAgent(c.req.param('id'));
    return c.json({ agent });
  });

  // Pre-Purchase Spend Authorizations
  const handleSpendRequest = async (c: Context) => {
    const body = requestSpendSchema.parse(await c.req.json());
    const decision = await policyEngine.requestSpend(body);
    return c.json(decision, decision.approved ? 200 : decision.escalated ? 202 : 200);
  };

  app.post('/api/spend/request', handleSpendRequest);
  app.post('/api/authorizations/request', handleSpendRequest);

  app.get('/api/authorizations', (c) => {
    const agentId = c.req.query('agentId');
    const status = c.req.query('status');
    const receiptStatus = c.req.query('receiptStatus');
    const authorizations = policyEngine.listAuthorizations({ agentId, status, receiptStatus });
    return c.json({ authorizations });
  });

  app.get('/api/authorizations/:id', (c) => {
    const authorization = policyEngine.getAuthorizationView(c.req.param('id'));
    return c.json({ authorization });
  });

  app.post('/api/authorizations/:id/approve', async (c) => {
    let operatorName = 'operator';
    let note: string | undefined;
    try {
      const parsed = (await c.req.json()) as { operatorName?: string; note?: string };
      if (parsed?.operatorName) operatorName = parsed.operatorName;
      if (parsed?.note) note = parsed.note;
    } catch {
      // Optional body
    }
    const authorization = await policyEngine.approveAuthorization(
      c.req.param('id'),
      operatorName,
      note
    );
    return c.json({ authorization });
  });

  app.post('/api/authorizations/:id/reject', async (c) => {
    let operatorName = 'operator';
    let reason = 'Rejected by operator';
    try {
      const parsed = (await c.req.json()) as { operatorName?: string; reason?: string };
      if (parsed?.operatorName) operatorName = parsed.operatorName;
      if (parsed?.reason) reason = parsed.reason;
    } catch {
      // Optional body
    }
    const authorization = policyEngine.rejectAuthorization(
      c.req.param('id'),
      operatorName,
      reason
    );
    return c.json({ authorization });
  });

  app.post('/api/authorizations/:id/void', async (c) => {
    let reason = 'Voided by caller';
    try {
      const parsed = (await c.req.json()) as { reason?: string };
      if (parsed?.reason) reason = parsed.reason;
    } catch {
      // Optional body
    }
    const authorization = await policyEngine.voidAuthorization(c.req.param('id'), reason);
    return c.json({ authorization });
  });

  app.post('/api/authorizations/:id/claim-card', (c) => {
    const claimed = policyEngine.claimApprovedCard(c.req.param('id'));
    return c.json(claimed);
  });

  // Virtual Card Simulator Charge & Stripe Webhook Adapter
  app.post('/api/simulator/charge', async (c) => {
    const body = simulateChargeSchema.parse(await c.req.json());
    const result = policyEngine.simulateCharge(body);
    return c.json(result);
  });

  app.post('/api/webhooks/stripe-issuing', async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header('stripe-signature');
    if (!cardProvider.parseWebhook) {
      return c.json(
        { error: `Active provider "${cardProvider.name}" does not support webhooks`, code: 'UNSUPPORTED_WEBHOOK' },
        400
      );
    }

    const parsed = cardProvider.parseWebhook(rawBody, signature);
    let authorization = null;
    if (parsed.settled) {
      authorization = policyEngine.recordProviderSettlement({
        authorizationId: parsed.authorizationId,
        providerCardId: parsed.providerCardId,
        amountCents: parsed.amountCents
      });
    }
    return c.json({ received: true, eventType: parsed.eventType, authorization });
  });

  // Receipts & Reconciliation
  app.post('/api/receipts/ingest', async (c) => {
    const body = ingestReceiptSchema.parse(await c.req.json());
    const result = reconciler.ingestReceipt(body);
    const authorization = result.matchedAuthorizationId
      ? policyEngine.getAuthorizationView(result.matchedAuthorizationId)
      : null;
    return c.json({ receipt: result.receipt, authorization }, 201);
  });

  app.get('/api/receipts', (c) => {
    const matchStatus = c.req.query('matchStatus');
    const agentId = c.req.query('agentId');
    const receipts = reconciler.listReceipts({ matchStatus, agentId });
    return c.json({ receipts });
  });

  app.post('/api/receipts/audit-missing', async (c) => {
    let optionsBody: z.infer<typeof auditMissingSchema> = {};
    try {
      optionsBody = auditMissingSchema.parse(await c.req.json());
    } catch {
      // Optional body
    }
    const result = reconciler.auditMissingReceipts(optionsBody);
    return c.json(result);
  });

  // Ledger Export (CSV / JSON)
  app.get('/api/ledger/export', (c) => {
    const format = (c.req.query('format') ?? 'json').toLowerCase();
    const agentId = c.req.query('agentId');
    const items = policyEngine.listAuthorizations({ agentId });

    if (format === 'csv') {
      const csv = exportLedgerCsv(items);
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header('Content-Disposition', 'attachment; filename="agent-spend-ledger.csv"');
      return c.body(csv);
    }

    const json = exportLedgerJson(items);
    c.header('Content-Type', 'application/json; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="agent-spend-ledger.json"');
    return c.body(json);
  });

  // Built-in 3-Agent Simulation Endpoint (handy from Operator UI)
  app.post('/api/simulate', async (c) => {
    let reset = true;
    try {
      const body = (await c.req.json()) as { reset?: boolean };
      if (typeof body?.reset === 'boolean') reset = body.reset;
    } catch {
      // Optional body
    }
    const client = createInProcessClient(policyEngine, reconciler);
    const summary = await runThreeAgentSimulation(client, {
      sqlite: dbConn.sqlite,
      reset
    });
    return c.json(summary);
  });

  // Serve built React/Vite dashboard if available
  const distDir = options?.dashboardDistDir ?? resolveDefaultDashboardDistDir();
  if (fs.existsSync(distDir)) {
    const relativeRoot = path.relative(process.cwd(), distDir) || '.';
    app.use('/*', serveStatic({ root: relativeRoot }));
    app.get('*', (c) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        return c.html(fs.readFileSync(indexFile, 'utf8'));
      }
      return c.text('Dashboard not built', 404);
    });
  }

  return {
    app,
    dbConn,
    policyEngine,
    reconciler,
    cardProvider,
    close: () => dbConn.close()
  };
}

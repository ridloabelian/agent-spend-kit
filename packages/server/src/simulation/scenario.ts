import type Database from 'better-sqlite3';
import type { PolicyEngine } from '../domain/policy-engine.js';
import type { ReceiptReconciler } from '../receipts/reconciler.js';

export interface SimulationStepResult {
  agentId: string;
  action: string;
  outcome: string;
  authorizationId?: string;
  amountCents?: number;
  details: string;
}

export interface SimulationSummary {
  seededAgents: number;
  steps: SimulationStepResult[];
  overviewSummary: ReturnType<PolicyEngine['getDashboardOverview']>['summary'];
}

export interface SpendClientLike {
  createAgent(input: {
    id?: string;
    name: string;
    owner?: string;
    totalBudgetCents: number;
    maxPerTransactionCents: number;
    approvalThresholdCents?: number;
    dailyLimitCents: number;
    monthlyLimitCents: number;
    maxTxPerHour?: number;
    policyMode?: 'allowlist' | 'blocklist' | 'open';
    allowedVendors?: string[];
    blockedVendors?: string[];
    allowedCategories?: string[];
    blockedCategories?: string[];
    autoFreezeOnAnomaly?: boolean;
    anomalyMaxConsecutiveBlocks?: number;
  }): Promise<unknown>;
  requestSpend(input: {
    agentId: string;
    vendor: string;
    amountCents: number;
    purpose: string;
    category?: string;
    idempotencyKey?: string;
  }): Promise<{
    approved: boolean;
    escalated: boolean;
    status: string;
    decisionCode: string;
    reason: string;
    walletFrozen: boolean;
    authorization: { id: string; amountCents: number };
    card?: { paymentToken: string; last4: string; maskedPan: string };
  }>;
  simulateCharge(input: {
    paymentToken: string;
    merchantVendor: string;
    amountCents: number;
    description?: string;
  }): Promise<unknown>;
  approveAuthorization(authId: string, operatorName?: string, note?: string): Promise<unknown>;
  claimApprovedCard(authId: string): Promise<{
    card: { paymentToken: string; last4: string; maskedPan: string };
  }>;
  submitReceipt(input: {
    content: string | Record<string, unknown>;
    contentType?: 'text' | 'html' | 'json';
    authorizationId?: string;
    agentId?: string;
    paymentToken?: string;
  }): Promise<{
    receipt: { id: string; matchStatus: string; discrepancyCents: number };
  }>;
  auditMissingReceipts(options?: {
    olderThanMinutes?: number;
    includeAllSettled?: boolean;
  }): Promise<{ flaggedCount: number; flaggedAuthorizationIds: string[] }>;
  getDashboardOverview(): Promise<{
    summary: ReturnType<PolicyEngine['getDashboardOverview']>['summary'];
  }>;
}

export function resetDatabaseTables(sqlite: Database.Database): void {
  sqlite
    .transaction(() => {
      sqlite.exec('DELETE FROM receipts');
      sqlite.exec('DELETE FROM anomaly_events');
      sqlite.exec('DELETE FROM virtual_cards');
      sqlite.exec('DELETE FROM authorizations');
      sqlite.exec('DELETE FROM agents');
    })
    .immediate();
}

export async function runThreeAgentSimulation(
  client: SpendClientLike,
  options?: { sqlite?: Database.Database; reset?: boolean }
): Promise<SimulationSummary> {
  if (options?.reset && options.sqlite) {
    resetDatabaseTables(options.sqlite);
  }

  const steps: SimulationStepResult[] = [];

  // 1. Create 3 specialized autonomous agent wallets
  await client.createAgent({
    id: 'agt_researcher',
    name: 'Deep Research Agent',
    owner: 'ai-lab',
    totalBudgetCents: 100_000, // $1,000.00
    maxPerTransactionCents: 15_000, // $150.00
    approvalThresholdCents: 5_000, // $50.00 requires human approval above this
    dailyLimitCents: 25_000, // $250.00 / 24h
    monthlyLimitCents: 80_000, // $800.00 / 30d
    maxTxPerHour: 12,
    policyMode: 'allowlist',
    allowedVendors: ['api.openai.com', 'anthropic.com', 'arxiv.org', 'serper.dev'],
    blockedVendors: ['casino.example', 'crypto-mixer.io'],
    allowedCategories: ['llm_api', 'research', 'search_api'],
    blockedCategories: ['gambling', 'gift_cards'],
    autoFreezeOnAnomaly: true,
    anomalyMaxConsecutiveBlocks: 3
  });

  await client.createAgent({
    id: 'agt_cloud_ops',
    name: 'Cloud Infra Ops Agent',
    owner: 'platform-sre',
    totalBudgetCents: 250_000, // $2,500.00
    maxPerTransactionCents: 60_000, // $600.00
    approvalThresholdCents: 12_000, // $120.00
    dailyLimitCents: 80_000, // $800.00 / 24h
    monthlyLimitCents: 200_000, // $2,000.00 / 30d
    maxTxPerHour: 10,
    policyMode: 'allowlist',
    allowedVendors: ['aws.amazon.com', '*.cloudflare.com', 'vercel.com', 'neon.tech'],
    blockedVendors: ['unknown-vps.ru'],
    allowedCategories: ['cloud_compute', 'infrastructure', 'database'],
    blockedCategories: ['entertainment'],
    autoFreezeOnAnomaly: true,
    anomalyMaxConsecutiveBlocks: 3
  });

  await client.createAgent({
    id: 'agt_growth_bot',
    name: 'Growth Automation Bot',
    owner: 'growth-ops',
    totalBudgetCents: 50_000, // $500.00
    maxPerTransactionCents: 10_000, // $100.00
    approvalThresholdCents: 5_000, // $50.00
    dailyLimitCents: 12_000, // $120.00 / 24h
    monthlyLimitCents: 40_000, // $400.00 / 30d
    maxTxPerHour: 6,
    policyMode: 'blocklist',
    blockedVendors: ['casino-ads.net', 'steam.com', 'luxury-watch.shop'],
    blockedCategories: ['gambling', 'crypto', 'gaming'],
    autoFreezeOnAnomaly: true,
    anomalyMaxConsecutiveBlocks: 3
  });

  // 2. Researcher valid purchase #1 -> approved -> charge -> plain-text receipt -> matched
  const r1 = await client.requestSpend({
    agentId: 'agt_researcher',
    vendor: 'https://api.openai.com/v1/batches',
    amountCents: 2_850,
    category: 'llm_api',
    purpose: 'Batch embeddings for 4,200 engineering RFC documents',
    idempotencyKey: 'sim-res-openai-1'
  });
  steps.push({
    agentId: 'agt_researcher',
    action: 'requestSpend(api.openai.com, $28.50)',
    outcome: r1.status,
    authorizationId: r1.authorization.id,
    amountCents: 2_850,
    details: `${r1.decisionCode} — issued card *${r1.card?.last4}`
  });

  if (r1.card) {
    await client.simulateCharge({
      paymentToken: r1.card.paymentToken,
      merchantVendor: 'api.openai.com',
      amountCents: 2_850,
      description: 'OpenAI API Batch Usage'
    });
    const textReceipt = [
      'OpenAI Billing Receipt',
      'Merchant: OpenAI',
      'Domain: api.openai.com',
      `Auth ID: ${r1.authorization.id}`,
      `Card: **** ${r1.card.last4}`,
      '2 x Batch Embeddings 1M Tokens @ $12.50  $25.00',
      '1 x Priority Processing Fee  $1.00',
      'Subtotal: $26.00',
      'Tax: $2.50',
      'Total: $28.50'
    ].join('\n');
    const rcpt1 = await client.submitReceipt({
      content: textReceipt,
      contentType: 'text',
      agentId: 'agt_researcher'
    });
    steps.push({
      agentId: 'agt_researcher',
      action: 'submitReceipt(text)',
      outcome: rcpt1.receipt.matchStatus,
      authorizationId: r1.authorization.id,
      amountCents: 2_850,
      details: `Receipt ${rcpt1.receipt.id} reconciled cleanly`
    });
  }

  // 3. Researcher blocked unauthorized vendor attempt
  const r2 = await client.requestSpend({
    agentId: 'agt_researcher',
    vendor: 'https://rogue-proxy.biz/buy',
    amountCents: 1_900,
    category: 'llm_api',
    purpose: 'Attempted unapproved third-party proxy top-up'
  });
  steps.push({
    agentId: 'agt_researcher',
    action: 'requestSpend(rogue-proxy.biz, $19.00)',
    outcome: r2.status,
    authorizationId: r2.authorization.id,
    amountCents: 1_900,
    details: `${r2.decisionCode}: ${r2.reason}`
  });

  // 4. Researcher high-value purchase -> escalated -> approved by operator -> HTML receipt with $3.60 tax discrepancy!
  const r3 = await client.requestSpend({
    agentId: 'agt_researcher',
    vendor: 'anthropic.com',
    amountCents: 9_500,
    category: 'llm_api',
    purpose: 'Reserve Claude API tier credits for deep evaluation suite'
  });
  steps.push({
    agentId: 'agt_researcher',
    action: 'requestSpend(anthropic.com, $95.00)',
    outcome: r3.status,
    authorizationId: r3.authorization.id,
    amountCents: 9_500,
    details: `${r3.decisionCode}: escalated for human approval`
  });

  await client.approveAuthorization(
    r3.authorization.id,
    'ridlo.ops',
    'Approved quarterly Claude eval budget'
  );
  const claimed3 = await client.claimApprovedCard(r3.authorization.id);
  await client.simulateCharge({
    paymentToken: claimed3.card.paymentToken,
    merchantVendor: 'anthropic.com',
    amountCents: 9_500,
    description: 'Anthropic Console Credits'
  });

  const htmlReceipt = `<!doctype html>
<html>
  <body>
    <h1 data-merchant="Anthropic PBC">Anthropic PBC Receipt</h1>
    <p>Website: <a href="https://anthropic.com/billing">anthropic.com</a></p>
    <p>Reference: ${r3.authorization.id} | Card ending in ${claimed3.card.last4}</p>
    <table>
      <tr><th>Item</th><th>Qty</th><th>Unit</th><th>Amount</th></tr>
      <tr><td>Claude API Credit Bundle</td><td>1</td><td>$95.00</td><td>$95.00</td></tr>
      <tr><td>Subtotal</td><td>$95.00</td></tr>
      <tr><td>Tax</td><td>$3.60</td></tr>
      <tr><td>Grand Total</td><td>$98.60</td></tr>
    </table>
  </body>
</html>`;
  const rcpt3 = await client.submitReceipt({
    content: htmlReceipt,
    contentType: 'html'
  });
  steps.push({
    agentId: 'agt_researcher',
    action: 'approve + submitReceipt(html, +$3.60 discrepancy)',
    outcome: rcpt3.receipt.matchStatus,
    authorizationId: r3.authorization.id,
    amountCents: 9_860,
    details: `Flagged discrepancy of +$${(rcpt3.receipt.discrepancyCents / 100).toFixed(2)}`
  });

  // 5. Cloud Ops valid purchase -> JSON receipt -> exact match
  const c1 = await client.requestSpend({
    agentId: 'agt_cloud_ops',
    vendor: 'https://workers.cloudflare.com/billing',
    amountCents: 7_500,
    category: 'infrastructure',
    purpose: 'Cloudflare Workers Paid + R2 storage egress'
  });
  steps.push({
    agentId: 'agt_cloud_ops',
    action: 'requestSpend(workers.cloudflare.com, $75.00)',
    outcome: c1.status,
    authorizationId: c1.authorization.id,
    amountCents: 7_500,
    details: `${c1.decisionCode} — issued card *${c1.card?.last4}`
  });

  if (c1.card) {
    await client.simulateCharge({
      paymentToken: c1.card.paymentToken,
      merchantVendor: 'workers.cloudflare.com',
      amountCents: 7_500,
      description: 'Cloudflare Workers & R2'
    });
    const rcptC1 = await client.submitReceipt({
      contentType: 'json',
      content: {
        merchant: 'Cloudflare',
        merchantDomain: 'cloudflare.com',
        authorizationId: c1.authorization.id,
        cardLast4: c1.card.last4,
        currency: 'USD',
        lineItems: [
          { description: 'Workers Paid Plan', quantity: 1, unitPriceCents: 500, totalCents: 500 },
          { description: 'R2 & Durable Objects Usage', quantity: 1, unitPriceCents: 7_000, totalCents: 7_000 }
        ],
        subtotalCents: 7_500,
        taxCents: 0,
        totalCents: 7_500
      }
    });
    steps.push({
      agentId: 'agt_cloud_ops',
      action: 'submitReceipt(json)',
      outcome: rcptC1.receipt.matchStatus,
      authorizationId: c1.authorization.id,
      amountCents: 7_500,
      details: `Receipt ${rcptC1.receipt.id} matched`
    });
  }

  // 6. Cloud Ops purchase #2 -> settled WITHOUT receipt -> flagged during missing-receipt audit
  const c2 = await client.requestSpend({
    agentId: 'agt_cloud_ops',
    vendor: 'neon.tech',
    amountCents: 4_900,
    category: 'database',
    purpose: 'Neon Postgres branching compute top-up'
  });
  if (c2.card) {
    await client.simulateCharge({
      paymentToken: c2.card.paymentToken,
      merchantVendor: 'neon.tech',
      amountCents: 4_900,
      description: 'Neon Scale Compute'
    });
  }
  steps.push({
    agentId: 'agt_cloud_ops',
    action: 'requestSpend(neon.tech, $49.00, no receipt)',
    outcome: 'settled',
    authorizationId: c2.authorization.id,
    amountCents: 4_900,
    details: 'Settled without receipt upload (will be flagged by missing-receipt audit)'
  });

  // 7. Cloud Ops high-value request left in Pending Approval queue for operator dashboard review
  const c3 = await client.requestSpend({
    agentId: 'agt_cloud_ops',
    vendor: 'aws.amazon.com',
    amountCents: 32_000,
    category: 'cloud_compute',
    purpose: 'Reserve p4d GPU spot block for fine-tuning run'
  });
  steps.push({
    agentId: 'agt_cloud_ops',
    action: 'requestSpend(aws.amazon.com, $320.00)',
    outcome: c3.status,
    authorizationId: c3.authorization.id,
    amountCents: 32_000,
    details: 'Queued in Pending Approvals for human operator review'
  });

  // 8. Growth Bot valid purchase + daily limit check + 3 consecutive blocked attempts -> auto-freeze!
  const g1 = await client.requestSpend({
    agentId: 'agt_growth_bot',
    vendor: 'buffer.com',
    amountCents: 4_500,
    category: 'marketing',
    purpose: 'Social scheduling campaign add-on'
  });
  if (g1.card) {
    await client.simulateCharge({
      paymentToken: g1.card.paymentToken,
      merchantVendor: 'buffer.com',
      amountCents: 4_500,
      description: 'Buffer Campaign Add-on'
    });
    await client.submitReceipt({
      content: {
        merchant: 'Buffer Inc',
        merchantDomain: 'buffer.com',
        paymentToken: g1.card.paymentToken,
        items: [{ description: 'Campaign Add-on', quantity: 1, total: '45.00' }],
        subtotal: '45.00',
        tax: '0.00',
        total: '45.00'
      },
      contentType: 'json'
    });
  }
  steps.push({
    agentId: 'agt_growth_bot',
    action: 'requestSpend(buffer.com, $45.00)',
    outcome: g1.status,
    authorizationId: g1.authorization.id,
    amountCents: 4_500,
    details: 'Approved, settled, and reconciled via JSON receipt'
  });

  // Over daily cap attempt ($90 + $45 = $135 > $120 daily limit)
  const gDaily = await client.requestSpend({
    agentId: 'agt_growth_bot',
    vendor: 'mailchimp.com',
    amountCents: 9_000,
    category: 'marketing',
    purpose: 'Bulk email blast credits exceeding daily limit'
  });
  steps.push({
    agentId: 'agt_growth_bot',
    action: 'requestSpend(mailchimp.com, $90.00)',
    outcome: gDaily.status,
    authorizationId: gDaily.authorization.id,
    amountCents: 9_000,
    details: `${gDaily.decisionCode}: ${gDaily.reason}`
  });

  // 3 consecutive policy blocks trigger anomaly auto-freeze on agt_growth_bot
  const blockedTargets = [
    { vendor: 'casino-ads.net', category: 'gambling', purpose: 'Unverified ad network deposit' },
    { vendor: 'steam.com', category: 'gaming', purpose: 'Gift voucher purchase' },
    { vendor: 'luxury-watch.shop', category: 'retail', purpose: 'Blocked merchandise attempt' }
  ];
  for (const target of blockedTargets) {
    const blocked = await client.requestSpend({
      agentId: 'agt_growth_bot',
      vendor: target.vendor,
      amountCents: 2_000,
      category: target.category,
      purpose: target.purpose
    });
    steps.push({
      agentId: 'agt_growth_bot',
      action: `requestSpend(${target.vendor}, $20.00)`,
      outcome: blocked.walletFrozen ? 'rejected+auto_frozen' : blocked.status,
      authorizationId: blocked.authorization.id,
      amountCents: 2_000,
      details: `${blocked.decisionCode}${blocked.walletFrozen ? ' -> WALLET AUTO-FROZEN' : ''}`
    });
  }

  // 9. Run missing-receipt audit on settled transactions
  const audit = await client.auditMissingReceipts({ includeAllSettled: true });
  steps.push({
    agentId: 'system',
    action: 'auditMissingReceipts(includeAllSettled=true)',
    outcome: `flagged_${audit.flaggedCount}`,
    details: `Flagged ${audit.flaggedCount} settled spend(s) missing a receipt: ${audit.flaggedAuthorizationIds.join(', ')}`
  });

  const overview = await client.getDashboardOverview();
  return {
    seededAgents: 3,
    steps,
    overviewSummary: overview.summary
  };
}

export function createInProcessClient(
  engine: PolicyEngine,
  reconciler: ReceiptReconciler
): SpendClientLike {
  return {
    createAgent: async (input) => engine.createAgent(input),
    requestSpend: async (input) => engine.requestSpend(input),
    simulateCharge: async (input) => engine.simulateCharge(input),
    approveAuthorization: async (authId, operatorName, note) =>
      engine.approveAuthorization(authId, operatorName, note),
    claimApprovedCard: async (authId) => engine.claimApprovedCard(authId),
    submitReceipt: async (input) => reconciler.ingestReceipt(input),
    auditMissingReceipts: async (options) => reconciler.auditMissingReceipts(options),
    getDashboardOverview: async () => ({ summary: engine.getDashboardOverview().summary })
  };
}

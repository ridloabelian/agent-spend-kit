import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  owner: text('owner').notNull().default('platform-team'),
  status: text('status').notNull().default('active'), // 'active' | 'frozen' | 'archived'
  freezeReason: text('freeze_reason'),
  frozenAt: text('frozen_at'),
  currency: text('currency').notNull().default('USD'),

  totalBudgetCents: integer('total_budget_cents').notNull(),
  maxPerTransactionCents: integer('max_per_transaction_cents').notNull(),
  approvalThresholdCents: integer('approval_threshold_cents').notNull(),
  dailyLimitCents: integer('daily_limit_cents').notNull(),
  monthlyLimitCents: integer('monthly_limit_cents').notNull(),
  maxTxPerHour: integer('max_tx_per_hour').notNull().default(20),

  policyMode: text('policy_mode').notNull().default('allowlist'), // 'allowlist' | 'blocklist' | 'open'
  allowedVendors: text('allowed_vendors').notNull().default('[]'),
  blockedVendors: text('blocked_vendors').notNull().default('[]'),
  allowedCategories: text('allowed_categories').notNull().default('[]'),
  blockedCategories: text('blocked_categories').notNull().default('[]'),

  autoFreezeOnAnomaly: integer('auto_freeze_on_anomaly', { mode: 'boolean' }).notNull().default(true),
  anomalyMaxConsecutiveBlocks: integer('anomaly_max_consecutive_blocks').notNull().default(3),
  anomalySpikeMultiplier: real('anomaly_spike_multiplier').notNull().default(3.0),

  metadata: text('metadata').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const authorizations = sqliteTable('authorizations', {
  id: text('id').primaryKey(),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key'),

  vendor: text('vendor').notNull(),
  vendorDomain: text('vendor_domain').notNull(),
  category: text('category').notNull().default('general'),
  amountCents: integer('amount_cents').notNull(),
  settledAmountCents: integer('settled_amount_cents'),
  currency: text('currency').notNull().default('USD'),
  purpose: text('purpose').notNull(),

  status: text('status').notNull(),
  decisionCode: text('decision_code').notNull(),
  decisionReason: text('decision_reason').notNull(),
  decidedBy: text('decided_by').notNull().default('policy_engine'),

  receiptStatus: text('receipt_status').notNull().default('pending'),
  receiptDueAt: text('receipt_due_at'),
  cardId: text('card_id'),

  metadata: text('metadata').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const virtualCards = sqliteTable('virtual_cards', {
  id: text('id').primaryKey(),
  authorizationId: text('authorization_id')
    .notNull()
    .unique()
    .references(() => authorizations.id, { onDelete: 'cascade' }),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),

  provider: text('provider').notNull(),
  providerCardId: text('provider_card_id').notNull(),
  paymentToken: text('payment_token').notNull().unique(),
  brand: text('brand').notNull().default('Visa'),
  last4: text('last4').notNull(),
  maskedPan: text('masked_pan').notNull(),
  expMonth: integer('exp_month').notNull(),
  expYear: integer('exp_year').notNull(),

  spendingLimitCents: integer('spending_limit_cents').notNull(),
  spentCents: integer('spent_cents').notNull().default(0),
  lockedVendorDomain: text('locked_vendor_domain').notNull(),
  singleUse: integer('single_use', { mode: 'boolean' }).notNull().default(true),
  status: text('status').notNull().default('active'), // 'active' | 'used' | 'voided' | 'expired'

  claimedAt: text('claimed_at'),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  createdAt: text('created_at').notNull()
});

export const receipts = sqliteTable('receipts', {
  id: text('id').primaryKey(),
  authorizationId: text('authorization_id').references(() => authorizations.id, {
    onDelete: 'set null'
  }),
  agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),

  rawFormat: text('raw_format').notNull(), // 'text' | 'html' | 'json'
  rawContent: text('raw_content').notNull(),

  merchant: text('merchant').notNull(),
  merchantDomain: text('merchant_domain').notNull(),
  subtotalCents: integer('subtotal_cents').notNull(),
  taxCents: integer('tax_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  lineItems: text('line_items').notNull().default('[]'),
  extractedMeta: text('extracted_meta').notNull().default('{}'),

  matchStatus: text('match_status').notNull(), // 'matched' | 'mismatch' | 'unmatched'
  discrepancyCents: integer('discrepancy_cents').notNull().default(0),
  reconciliationNotes: text('reconciliation_notes').notNull().default(''),
  createdAt: text('created_at').notNull()
});

export const anomalyEvents = sqliteTable('anomaly_events', {
  id: text('id').primaryKey(),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  authorizationId: text('authorization_id').references(() => authorizations.id, {
    onDelete: 'set null'
  }),
  type: text('type').notNull(),
  severity: text('severity').notNull().default('warning'), // 'warning' | 'critical'
  description: text('description').notNull(),
  autoFrozeWallet: integer('auto_froze_wallet', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull()
});

import type Database from 'better-sqlite3';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT 'platform-team',
    status TEXT NOT NULL DEFAULT 'active',
    freeze_reason TEXT,
    frozen_at TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    total_budget_cents INTEGER NOT NULL,
    max_per_transaction_cents INTEGER NOT NULL,
    approval_threshold_cents INTEGER NOT NULL,
    daily_limit_cents INTEGER NOT NULL,
    monthly_limit_cents INTEGER NOT NULL,
    max_tx_per_hour INTEGER NOT NULL DEFAULT 20,
    policy_mode TEXT NOT NULL DEFAULT 'allowlist',
    allowed_vendors TEXT NOT NULL DEFAULT '[]',
    blocked_vendors TEXT NOT NULL DEFAULT '[]',
    allowed_categories TEXT NOT NULL DEFAULT '[]',
    blocked_categories TEXT NOT NULL DEFAULT '[]',
    auto_freeze_on_anomaly INTEGER NOT NULL DEFAULT 1,
    anomaly_max_consecutive_blocks INTEGER NOT NULL DEFAULT 3,
    anomaly_spike_multiplier REAL NOT NULL DEFAULT 3.0,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS authorizations (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    idempotency_key TEXT,
    vendor TEXT NOT NULL,
    vendor_domain TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    amount_cents INTEGER NOT NULL,
    settled_amount_cents INTEGER,
    currency TEXT NOT NULL DEFAULT 'USD',
    purpose TEXT NOT NULL,
    status TEXT NOT NULL,
    decision_code TEXT NOT NULL,
    decision_reason TEXT NOT NULL,
    decided_by TEXT NOT NULL DEFAULT 'policy_engine',
    receipt_status TEXT NOT NULL DEFAULT 'pending',
    receipt_due_at TEXT,
    card_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS virtual_cards (
    id TEXT PRIMARY KEY,
    authorization_id TEXT NOT NULL UNIQUE REFERENCES authorizations(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_card_id TEXT NOT NULL,
    payment_token TEXT NOT NULL UNIQUE,
    brand TEXT NOT NULL DEFAULT 'Visa',
    last4 TEXT NOT NULL,
    masked_pan TEXT NOT NULL,
    exp_month INTEGER NOT NULL,
    exp_year INTEGER NOT NULL,
    spending_limit_cents INTEGER NOT NULL,
    spent_cents INTEGER NOT NULL DEFAULT 0,
    locked_vendor_domain TEXT NOT NULL,
    single_use INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    claimed_at TEXT,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    authorization_id TEXT REFERENCES authorizations(id) ON DELETE SET NULL,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    raw_format TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    merchant TEXT NOT NULL,
    merchant_domain TEXT NOT NULL,
    subtotal_cents INTEGER NOT NULL,
    tax_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    line_items TEXT NOT NULL DEFAULT '[]',
    extracted_meta TEXT NOT NULL DEFAULT '{}',
    match_status TEXT NOT NULL,
    discrepancy_cents INTEGER NOT NULL DEFAULT 0,
    reconciliation_notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS anomaly_events (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    authorization_id TEXT REFERENCES authorizations(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    description TEXT NOT NULL,
    auto_froze_wallet INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_agent_idempotency
   ON authorizations(agent_id, idempotency_key)
   WHERE idempotency_key IS NOT NULL;`,

  `CREATE INDEX IF NOT EXISTS idx_auth_agent_created
   ON authorizations(agent_id, created_at);`,

  `CREATE INDEX IF NOT EXISTS idx_auth_status
   ON authorizations(status, receipt_status);`,

  `CREATE INDEX IF NOT EXISTS idx_receipts_auth
   ON receipts(authorization_id);`,

  `CREATE INDEX IF NOT EXISTS idx_anomalies_agent_created
   ON anomaly_events(agent_id, created_at);`
];

export function ensureSchema(sqlite: Database.Database): void {
  for (const statement of SCHEMA_STATEMENTS) {
    sqlite.exec(statement);
  }
}

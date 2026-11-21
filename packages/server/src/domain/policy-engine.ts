import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { agents, anomalyEvents, authorizations, virtualCards } from '../db/schema.js';
import type { CardProvider, IssuedCardCredentials } from '../providers/types.js';
import { formatCents } from '../receipts/money.js';
import type { ReceiptRecord } from '../receipts/reconciler.js';
import { matchesCategoryList, matchesVendorList, matchesVendorPattern, normalizeVendor } from './vendor-matcher.js';

export type AgentStatus = 'active' | 'frozen' | 'archived';
export type PolicyMode = 'allowlist' | 'blocklist' | 'open';

export type AuthorizationStatus =
  | 'approved'
  | 'pending_approval'
  | 'rejected'
  | 'settled'
  | 'reconciled'
  | 'voided'
  | 'expired';

export type ReceiptStatus =
  | 'not_applicable'
  | 'pending'
  | 'matched'
  | 'mismatch'
  | 'missing_flagged';

export type DecisionCode =
  | 'APPROVED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVED_BY_OPERATOR'
  | 'REJECTED_BY_OPERATOR'
  | 'VENDOR_BLOCKED'
  | 'VENDOR_NOT_ALLOWED'
  | 'CATEGORY_BLOCKED'
  | 'CATEGORY_NOT_ALLOWED'
  | 'PER_TX_CAP_EXCEEDED'
  | 'DAILY_LIMIT_EXCEEDED'
  | 'MONTHLY_LIMIT_EXCEEDED'
  | 'TOTAL_BUDGET_EXCEEDED'
  | 'HOURLY_VELOCITY_EXCEEDED'
  | 'ANOMALY_AMOUNT_SPIKE'
  | 'WALLET_FROZEN'
  | 'WALLET_ARCHIVED'
  | 'VOIDED';

export interface AgentWallet {
  id: string;
  name: string;
  owner: string;
  status: AgentStatus;
  freezeReason: string | null;
  frozenAt: string | null;
  currency: string;
  totalBudgetCents: number;
  maxPerTransactionCents: number;
  approvalThresholdCents: number;
  dailyLimitCents: number;
  monthlyLimitCents: number;
  maxTxPerHour: number;
  policyMode: PolicyMode;
  allowedVendors: string[];
  blockedVendors: string[];
  allowedCategories: string[];
  blockedCategories: string[];
  autoFreezeOnAnomaly: boolean;
  anomalyMaxConsecutiveBlocks: number;
  anomalySpikeMultiplier: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMetrics {
  committedTotalCents: number;
  settledTotalCents: number;
  remainingTotalCents: number;
  spend24hCents: number;
  remainingDailyCents: number;
  spend30dCents: number;
  remainingMonthlyCents: number;
  txCountLastHour: number;
  pendingApprovalCount: number;
  rejectedCount: number;
  missingReceiptCount: number;
  mismatchReceiptCount: number;
}

export interface AgentWalletWithMetrics extends AgentWallet {
  metrics: AgentMetrics;
}

export interface AuthorizationRecord {
  id: string;
  agentId: string;
  idempotencyKey: string | null;
  vendor: string;
  vendorDomain: string;
  category: string;
  amountCents: number;
  settledAmountCents: number | null;
  currency: string;
  purpose: string;
  status: AuthorizationStatus;
  decisionCode: DecisionCode;
  decisionReason: string;
  decidedBy: string;
  receiptStatus: ReceiptStatus;
  receiptDueAt: string | null;
  cardId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MaskedCardSummary {
  id: string;
  authorizationId: string;
  agentId: string;
  provider: 'simulator' | 'stripe_issuing';
  providerCardId: string;
  paymentToken: string;
  brand: string;
  last4: string;
  maskedPan: string;
  expMonth: number;
  expYear: number;
  spendingLimitCents: number;
  spentCents: number;
  lockedVendorDomain: string;
  singleUse: boolean;
  status: 'active' | 'used' | 'voided' | 'expired';
  claimedAt: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface EphemeralCardDetails extends MaskedCardSummary {
  pan: string;
  cvc: string;
}

export interface AuthorizationView extends AuthorizationRecord {
  agentName?: string;
  card?: MaskedCardSummary | null;
  receipt?: ReceiptRecord | null;
}

export interface AnomalyEventRecord {
  id: string;
  agentId: string;
  authorizationId: string | null;
  type: string;
  severity: 'warning' | 'critical';
  description: string;
  autoFrozeWallet: boolean;
  createdAt: string;
}

export interface CreateAgentInput {
  id?: string;
  name: string;
  owner?: string;
  currency?: string;
  totalBudgetCents: number;
  maxPerTransactionCents: number;
  approvalThresholdCents?: number;
  dailyLimitCents: number;
  monthlyLimitCents: number;
  maxTxPerHour?: number;
  policyMode?: PolicyMode;
  allowedVendors?: string[];
  blockedVendors?: string[];
  allowedCategories?: string[];
  blockedCategories?: string[];
  autoFreezeOnAnomaly?: boolean;
  anomalyMaxConsecutiveBlocks?: number;
  anomalySpikeMultiplier?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateAgentInput {
  name?: string;
  owner?: string;
  totalBudgetCents?: number;
  maxPerTransactionCents?: number;
  approvalThresholdCents?: number;
  dailyLimitCents?: number;
  monthlyLimitCents?: number;
  maxTxPerHour?: number;
  policyMode?: PolicyMode;
  allowedVendors?: string[];
  blockedVendors?: string[];
  allowedCategories?: string[];
  blockedCategories?: string[];
  autoFreezeOnAnomaly?: boolean;
  anomalyMaxConsecutiveBlocks?: number;
  anomalySpikeMultiplier?: number;
  metadata?: Record<string, unknown>;
}

export interface RequestSpendInput {
  agentId: string;
  vendor: string;
  amountCents: number;
  purpose: string;
  category?: string;
  currency?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface RequestSpendResult {
  approved: boolean;
  escalated: boolean;
  status: AuthorizationStatus;
  decisionCode: DecisionCode;
  reason: string;
  walletFrozen: boolean;
  authorization: AuthorizationRecord;
  card?: EphemeralCardDetails;
  cardMasked?: MaskedCardSummary;
  remainingBudgetCents: number;
  remainingDailyCents: number;
  remainingMonthlyCents: number;
}

export class DomainError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class PolicyEngine {
  private readonly inflightIssuance = new Map<string, Promise<EphemeralCardDetails>>();

  constructor(
    private readonly sqlite: Database.Database,
    private readonly db: AppDatabase,
    private readonly cardProvider: CardProvider,
    private readonly now: () => Date = () => new Date()
  ) {}

  private parseJsonArray(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private parseJsonObject(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    }
    return {};
  }

  private mapAgentRow(row: Record<string, unknown>): AgentWallet {
    return {
      id: String(row.id),
      name: String(row.name),
      owner: String(row.owner),
      status: String(row.status) as AgentStatus,
      freezeReason: row.freeze_reason ? String(row.freeze_reason) : null,
      frozenAt: row.frozen_at ? String(row.frozen_at) : null,
      currency: String(row.currency),
      totalBudgetCents: Number(row.total_budget_cents),
      maxPerTransactionCents: Number(row.max_per_transaction_cents),
      approvalThresholdCents: Number(row.approval_threshold_cents),
      dailyLimitCents: Number(row.daily_limit_cents),
      monthlyLimitCents: Number(row.monthly_limit_cents),
      maxTxPerHour: Number(row.max_tx_per_hour),
      policyMode: String(row.policy_mode) as PolicyMode,
      allowedVendors: this.parseJsonArray(row.allowed_vendors),
      blockedVendors: this.parseJsonArray(row.blocked_vendors),
      allowedCategories: this.parseJsonArray(row.allowed_categories),
      blockedCategories: this.parseJsonArray(row.blocked_categories),
      autoFreezeOnAnomaly: Boolean(row.auto_freeze_on_anomaly),
      anomalyMaxConsecutiveBlocks: Number(row.anomaly_max_consecutive_blocks),
      anomalySpikeMultiplier: Number(row.anomaly_spike_multiplier),
      metadata: this.parseJsonObject(row.metadata),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapAuthorizationRow(row: Record<string, unknown>): AuthorizationRecord {
    return {
      id: String(row.id),
      agentId: String(row.agent_id),
      idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
      vendor: String(row.vendor),
      vendorDomain: String(row.vendor_domain),
      category: String(row.category),
      amountCents: Number(row.amount_cents),
      settledAmountCents:
        row.settled_amount_cents === null || row.settled_amount_cents === undefined
          ? null
          : Number(row.settled_amount_cents),
      currency: String(row.currency),
      purpose: String(row.purpose),
      status: String(row.status) as AuthorizationStatus,
      decisionCode: String(row.decision_code) as DecisionCode,
      decisionReason: String(row.decision_reason),
      decidedBy: String(row.decided_by),
      receiptStatus: String(row.receipt_status) as ReceiptStatus,
      receiptDueAt: row.receipt_due_at ? String(row.receipt_due_at) : null,
      cardId: row.card_id ? String(row.card_id) : null,
      metadata: this.parseJsonObject(row.metadata),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapCardRow(row: Record<string, unknown>): MaskedCardSummary {
    return {
      id: String(row.id),
      authorizationId: String(row.authorization_id),
      agentId: String(row.agent_id),
      provider: String(row.provider) as 'simulator' | 'stripe_issuing',
      providerCardId: String(row.provider_card_id),
      paymentToken: String(row.payment_token),
      brand: String(row.brand),
      last4: String(row.last4),
      maskedPan: String(row.masked_pan),
      expMonth: Number(row.exp_month),
      expYear: Number(row.exp_year),
      spendingLimitCents: Number(row.spending_limit_cents),
      spentCents: Number(row.spent_cents),
      lockedVendorDomain: String(row.locked_vendor_domain),
      singleUse: Boolean(row.single_use),
      status: String(row.status) as 'active' | 'used' | 'voided' | 'expired',
      claimedAt: row.claimed_at ? String(row.claimed_at) : null,
      expiresAt: String(row.expires_at),
      usedAt: row.used_at ? String(row.used_at) : null,
      createdAt: String(row.created_at)
    };
  }

  private computeAgentMetrics(agent: AgentWallet, referenceNow: Date): AgentMetrics {
    const oneHourAgo = new Date(referenceNow.getTime() - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(referenceNow.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(referenceNow.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const totals = this.sqlite
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status IN ('approved', 'pending_approval') THEN amount_cents
                             WHEN status IN ('settled', 'reconciled') THEN COALESCE(settled_amount_cents, amount_cents)
                             ELSE 0 END), 0) AS committed_total,
           COALESCE(SUM(CASE WHEN status IN ('settled', 'reconciled') THEN COALESCE(settled_amount_cents, amount_cents)
                             ELSE 0 END), 0) AS settled_total,
           COALESCE(SUM(CASE WHEN created_at >= ? AND status IN ('approved', 'pending_approval') THEN amount_cents
                             WHEN created_at >= ? AND status IN ('settled', 'reconciled') THEN COALESCE(settled_amount_cents, amount_cents)
                             ELSE 0 END), 0) AS spend_24h,
           COALESCE(SUM(CASE WHEN created_at >= ? AND status IN ('approved', 'pending_approval') THEN amount_cents
                             WHEN created_at >= ? AND status IN ('settled', 'reconciled') THEN COALESCE(settled_amount_cents, amount_cents)
                             ELSE 0 END), 0) AS spend_30d,
           COALESCE(SUM(CASE WHEN created_at >= ? AND status IN ('approved', 'pending_approval', 'settled', 'reconciled') THEN 1 ELSE 0 END), 0) AS tx_last_hour,
           COALESCE(SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END), 0) AS pending_approvals,
           COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
           COALESCE(SUM(CASE WHEN receipt_status = 'missing_flagged' THEN 1 ELSE 0 END), 0) AS missing_receipts,
           COALESCE(SUM(CASE WHEN receipt_status = 'mismatch' THEN 1 ELSE 0 END), 0) AS mismatch_receipts
         FROM authorizations
         WHERE agent_id = ?`
      )
      .get(oneDayAgo, oneDayAgo, thirtyDaysAgo, thirtyDaysAgo, oneHourAgo, agent.id) as Record<
      string,
      number
    >;

    const committedTotalCents = Number(totals.committed_total ?? 0);
    const spend24hCents = Number(totals.spend_24h ?? 0);
    const spend30dCents = Number(totals.spend_30d ?? 0);

    return {
      committedTotalCents,
      settledTotalCents: Number(totals.settled_total ?? 0),
      remainingTotalCents: Math.max(0, agent.totalBudgetCents - committedTotalCents),
      spend24hCents,
      remainingDailyCents: Math.max(0, agent.dailyLimitCents - spend24hCents),
      spend30dCents,
      remainingMonthlyCents: Math.max(0, agent.monthlyLimitCents - spend30dCents),
      txCountLastHour: Number(totals.tx_last_hour ?? 0),
      pendingApprovalCount: Number(totals.pending_approvals ?? 0),
      rejectedCount: Number(totals.rejected_count ?? 0),
      missingReceiptCount: Number(totals.missing_receipts ?? 0),
      mismatchReceiptCount: Number(totals.mismatch_receipts ?? 0)
    };
  }

  createAgent(input: CreateAgentInput): AgentWalletWithMetrics {
    const nowIso = this.now().toISOString();
    const id =
      input.id?.trim() || `agt_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

    const existing = this.sqlite.prepare('SELECT id FROM agents WHERE id = ?').get(id);
    if (existing) {
      throw new DomainError(`Agent "${id}" already exists`, 409, 'AGENT_ALREADY_EXISTS');
    }

    const approvalThresholdCents =
      input.approvalThresholdCents ?? input.maxPerTransactionCents;

    this.db
      .insert(agents)
      .values({
        id,
        name: input.name.trim(),
        owner: (input.owner ?? 'platform-team').trim(),
        status: 'active',
        freezeReason: null,
        frozenAt: null,
        currency: (input.currency ?? 'USD').toUpperCase(),
        totalBudgetCents: input.totalBudgetCents,
        maxPerTransactionCents: input.maxPerTransactionCents,
        approvalThresholdCents,
        dailyLimitCents: input.dailyLimitCents,
        monthlyLimitCents: input.monthlyLimitCents,
        maxTxPerHour: input.maxTxPerHour ?? 20,
        policyMode: input.policyMode ?? 'allowlist',
        allowedVendors: JSON.stringify(input.allowedVendors ?? []),
        blockedVendors: JSON.stringify(input.blockedVendors ?? []),
        allowedCategories: JSON.stringify(input.allowedCategories ?? []),
        blockedCategories: JSON.stringify(input.blockedCategories ?? []),
        autoFreezeOnAnomaly: input.autoFreezeOnAnomaly ?? true,
        anomalyMaxConsecutiveBlocks: input.anomalyMaxConsecutiveBlocks ?? 3,
        anomalySpikeMultiplier: input.anomalySpikeMultiplier ?? 3.0,
        metadata: JSON.stringify(input.metadata ?? {}),
        createdAt: nowIso,
        updatedAt: nowIso
      })
      .run();

    return this.getAgent(id);
  }

  updateAgent(agentId: string, input: UpdateAgentInput): AgentWalletWithMetrics {
    const current = this.getAgent(agentId);
    const nowIso = this.now().toISOString();

    this.db
      .update(agents)
      .set({
        name: input.name !== undefined ? input.name.trim() : current.name,
        owner: input.owner !== undefined ? input.owner.trim() : current.owner,
        totalBudgetCents: input.totalBudgetCents ?? current.totalBudgetCents,
        maxPerTransactionCents: input.maxPerTransactionCents ?? current.maxPerTransactionCents,
        approvalThresholdCents: input.approvalThresholdCents ?? current.approvalThresholdCents,
        dailyLimitCents: input.dailyLimitCents ?? current.dailyLimitCents,
        monthlyLimitCents: input.monthlyLimitCents ?? current.monthlyLimitCents,
        maxTxPerHour: input.maxTxPerHour ?? current.maxTxPerHour,
        policyMode: input.policyMode ?? current.policyMode,
        allowedVendors: JSON.stringify(input.allowedVendors ?? current.allowedVendors),
        blockedVendors: JSON.stringify(input.blockedVendors ?? current.blockedVendors),
        allowedCategories: JSON.stringify(input.allowedCategories ?? current.allowedCategories),
        blockedCategories: JSON.stringify(input.blockedCategories ?? current.blockedCategories),
        autoFreezeOnAnomaly: input.autoFreezeOnAnomaly ?? current.autoFreezeOnAnomaly,
        anomalyMaxConsecutiveBlocks:
          input.anomalyMaxConsecutiveBlocks ?? current.anomalyMaxConsecutiveBlocks,
        anomalySpikeMultiplier: input.anomalySpikeMultiplier ?? current.anomalySpikeMultiplier,
        metadata: JSON.stringify(input.metadata ?? current.metadata),
        updatedAt: nowIso
      })
      .where(eq(agents.id, agentId))
      .run();

    return this.getAgent(agentId);
  }

  getAgent(agentId: string): AgentWalletWithMetrics {
    const row = this.sqlite.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new DomainError(`Agent "${agentId}" not found`, 404, 'AGENT_NOT_FOUND');
    }
    const agent = this.mapAgentRow(row);
    return {
      ...agent,
      metrics: this.computeAgentMetrics(agent, this.now())
    };
  }

  listAgents(): AgentWalletWithMetrics[] {
    const rows = this.sqlite
      .prepare('SELECT * FROM agents ORDER BY created_at ASC')
      .all() as Array<Record<string, unknown>>;
    const referenceNow = this.now();
    return rows.map((row) => {
      const agent = this.mapAgentRow(row);
      return {
        ...agent,
        metrics: this.computeAgentMetrics(agent, referenceNow)
      };
    });
  }

  freezeAgent(agentId: string, reason = 'Manual operator freeze'): AgentWalletWithMetrics {
    const current = this.getAgent(agentId);
    const nowIso = this.now().toISOString();

    this.db
      .update(agents)
      .set({
        status: 'frozen',
        freezeReason: reason,
        frozenAt: nowIso,
        updatedAt: nowIso
      })
      .where(eq(agents.id, agentId))
      .run();

    if (current.status !== 'frozen') {
      this.db
        .insert(anomalyEvents)
        .values({
          id: `anom_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
          agentId,
          authorizationId: null,
          type: 'MANUAL_FREEZE',
          severity: 'warning',
          description: reason,
          autoFrozeWallet: false,
          createdAt: nowIso
        })
        .run();
    }

    return this.getAgent(agentId);
  }

  unfreezeAgent(agentId: string): AgentWalletWithMetrics {
    const current = this.getAgent(agentId);
    const nowIso = this.now().toISOString();
    const nextMeta = {
      ...current.metadata,
      anomalyResetAt: nowIso
    };

    this.db
      .update(agents)
      .set({
        status: 'active',
        freezeReason: null,
        frozenAt: null,
        metadata: JSON.stringify(nextMeta),
        updatedAt: nowIso
      })
      .where(eq(agents.id, agentId))
      .run();

    return this.getAgent(agentId);
  }

  async requestSpend(input: RequestSpendInput): Promise<RequestSpendResult> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new DomainError(
        'amountCents must be a positive integer',
        400,
        'INVALID_AMOUNT'
      );
    }

    const vendorInfo = normalizeVendor(input.vendor);
    const category = (input.category ?? 'general').trim().toLowerCase() || 'general';
    const referenceNow = this.now();
    const nowIso = referenceNow.toISOString();

    type ReserveOutcome =
      | {
          kind: 'existing';
          authorization: AuthorizationRecord;
          cardRow: MaskedCardSummary | null;
          metrics: AgentMetrics;
          agent: AgentWallet;
        }
      | {
          kind: 'created';
          authorization: AuthorizationRecord;
          walletFrozen: boolean;
          metrics: AgentMetrics;
          agent: AgentWallet;
        };

    const reserved: ReserveOutcome = this.sqlite
      .transaction((): ReserveOutcome => {
        const agentRow = this.sqlite
          .prepare('SELECT * FROM agents WHERE id = ?')
          .get(input.agentId) as Record<string, unknown> | undefined;
        if (!agentRow) {
          throw new DomainError(`Agent "${input.agentId}" not found`, 404, 'AGENT_NOT_FOUND');
        }
        const agent = this.mapAgentRow(agentRow);

        if (input.idempotencyKey) {
          const existingAuthRow = this.sqlite
            .prepare(
              'SELECT * FROM authorizations WHERE agent_id = ? AND idempotency_key = ?'
            )
            .get(input.agentId, input.idempotencyKey) as Record<string, unknown> | undefined;

          if (existingAuthRow) {
            const existingAuth = this.mapAuthorizationRow(existingAuthRow);
            const existingCardRow = this.sqlite
              .prepare('SELECT * FROM virtual_cards WHERE authorization_id = ?')
              .get(existingAuth.id) as Record<string, unknown> | undefined;

            return {
              kind: 'existing',
              authorization: existingAuth,
              cardRow: existingCardRow ? this.mapCardRow(existingCardRow) : null,
              metrics: this.computeAgentMetrics(agent, referenceNow),
              agent
            };
          }
        }

        const metrics = this.computeAgentMetrics(agent, referenceNow);
        const authId = `auth_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

        const insertAuth = (params: {
          status: AuthorizationStatus;
          decisionCode: DecisionCode;
          decisionReason: string;
          receiptStatus: ReceiptStatus;
          receiptDueAt?: string | null;
        }): AuthorizationRecord => {
          const row = {
            id: authId,
            agentId: agent.id,
            idempotencyKey: input.idempotencyKey ?? null,
            vendor: input.vendor.trim(),
            vendorDomain: vendorInfo.domain,
            category,
            amountCents: input.amountCents,
            settledAmountCents: null,
            currency: (input.currency ?? agent.currency).toUpperCase(),
            purpose: input.purpose.trim(),
            status: params.status,
            decisionCode: params.decisionCode,
            decisionReason: params.decisionReason,
            decidedBy: 'policy_engine',
            receiptStatus: params.receiptStatus,
            receiptDueAt: params.receiptDueAt ?? null,
            cardId: null,
            metadata: JSON.stringify(input.metadata ?? {}),
            createdAt: nowIso,
            updatedAt: nowIso
          };

          this.db.insert(authorizations).values(row).run();
          return {
            ...row,
            metadata: input.metadata ?? {}
          };
        };

        const maybeFreezeForConsecutiveBlocks = (
          triggerCode: DecisionCode,
          triggerReason: string
        ): boolean => {
          if (!agent.autoFreezeOnAnomaly) return false;
          const resetAt =
            typeof agent.metadata.anomalyResetAt === 'string'
              ? agent.metadata.anomalyResetAt
              : '';
          const fifteenMinutesAgo = new Date(
            referenceNow.getTime() - 15 * 60 * 1000
          ).toISOString();
          const cutoff = resetAt > fifteenMinutesAgo ? resetAt : fifteenMinutesAgo;

          const recentAuths = this.sqlite
            .prepare(
              `SELECT status, decision_code FROM authorizations
               WHERE agent_id = ? AND created_at >= ?
               ORDER BY created_at DESC, rowid DESC
               LIMIT ?`
            )
            .all(agent.id, cutoff, agent.anomalyMaxConsecutiveBlocks) as Array<{
            status: string;
            decision_code: string;
          }>;

          if (recentAuths.length < agent.anomalyMaxConsecutiveBlocks) {
            return false;
          }

          const allBlocked = recentAuths.every(
            (r) => r.status === 'rejected' && r.decision_code !== 'WALLET_FROZEN'
          );
          if (!allBlocked) return false;

          const freezeReason = `Auto-frozen after ${agent.anomalyMaxConsecutiveBlocks} consecutive policy blocks (latest: ${triggerCode} - ${triggerReason})`;

          this.db
            .update(agents)
            .set({
              status: 'frozen',
              freezeReason,
              frozenAt: nowIso,
              updatedAt: nowIso
            })
            .where(eq(agents.id, agent.id))
            .run();

          this.db
            .insert(anomalyEvents)
            .values({
              id: `anom_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
              agentId: agent.id,
              authorizationId: authId,
              type: 'REPEATED_POLICY_BLOCKS',
              severity: 'critical',
              description: freezeReason,
              autoFrozeWallet: true,
              createdAt: nowIso
            })
            .run();

          return true;
        };

        const rejectWith = (
          decisionCode: DecisionCode,
          decisionReason: string,
          trackConsecutiveAnomaly: boolean
        ): ReserveOutcome => {
          const auth = insertAuth({
            status: 'rejected',
            decisionCode,
            decisionReason,
            receiptStatus: 'not_applicable'
          });
          const walletFrozen =
            trackConsecutiveAnomaly && maybeFreezeForConsecutiveBlocks(decisionCode, decisionReason);
          return {
            kind: 'created',
            authorization: auth,
            walletFrozen: walletFrozen || agent.status === 'frozen',
            metrics,
            agent
          };
        };

        // 1. Wallet status check
        if (agent.status === 'frozen') {
          return rejectWith(
            'WALLET_FROZEN',
            `Wallet is frozen: ${agent.freezeReason ?? 'Operator or anomaly freeze active'}`,
            false
          );
        }
        if (agent.status === 'archived') {
          return rejectWith('WALLET_ARCHIVED', 'Wallet is archived and cannot spend', false);
        }

        // 2. Category & Vendor policy checks
        const blockedCat = matchesCategoryList(category, agent.blockedCategories);
        if (blockedCat) {
          return rejectWith(
            'CATEGORY_BLOCKED',
            `Category "${category}" matches blocked category "${blockedCat}"`,
            true
          );
        }

        const blockedVendor = matchesVendorList(input.vendor, agent.blockedVendors);
        if (blockedVendor) {
          return rejectWith(
            'VENDOR_BLOCKED',
            `Vendor "${vendorInfo.domain}" is on blocklist ("${blockedVendor}")`,
            true
          );
        }

        if (agent.allowedCategories.length > 0) {
          const allowedCat = matchesCategoryList(category, agent.allowedCategories);
          if (!allowedCat) {
            return rejectWith(
              'CATEGORY_NOT_ALLOWED',
              `Category "${category}" is not in allowed categories [${agent.allowedCategories.join(', ')}]`,
              true
            );
          }
        }

        if (agent.policyMode === 'allowlist') {
          const allowedVendor = matchesVendorList(input.vendor, agent.allowedVendors);
          if (!allowedVendor) {
            return rejectWith(
              'VENDOR_NOT_ALLOWED',
              `Vendor "${vendorInfo.domain}" is not in agent allowlist [${agent.allowedVendors.join(', ')}]`,
              true
            );
          }
        }

        // 3. Extreme spike anomaly check
        const spikeThreshold = Math.round(
          agent.maxPerTransactionCents * agent.anomalySpikeMultiplier
        );
        if (agent.autoFreezeOnAnomaly && input.amountCents >= spikeThreshold) {
          const reason = `Requested ${formatCents(
            input.amountCents
          )} triggered anomaly spike threshold (>= ${agent.anomalySpikeMultiplier}x max per-tx ${formatCents(
            agent.maxPerTransactionCents
          )})`;
          const auth = insertAuth({
            status: 'rejected',
            decisionCode: 'ANOMALY_AMOUNT_SPIKE',
            decisionReason: reason,
            receiptStatus: 'not_applicable'
          });
          this.db
            .update(agents)
            .set({
              status: 'frozen',
              freezeReason: reason,
              frozenAt: nowIso,
              updatedAt: nowIso
            })
            .where(eq(agents.id, agent.id))
            .run();
          this.db
            .insert(anomalyEvents)
            .values({
              id: `anom_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
              agentId: agent.id,
              authorizationId: authId,
              type: 'AMOUNT_SPIKE',
              severity: 'critical',
              description: reason,
              autoFrozeWallet: true,
              createdAt: nowIso
            })
            .run();
          return {
            kind: 'created',
            authorization: auth,
            walletFrozen: true,
            metrics,
            agent
          };
        }

        // 4. Per-transaction hard cap
        if (input.amountCents > agent.maxPerTransactionCents) {
          return rejectWith(
            'PER_TX_CAP_EXCEEDED',
            `Amount ${formatCents(input.amountCents)} exceeds per-transaction cap of ${formatCents(
              agent.maxPerTransactionCents
            )}`,
            true
          );
        }

        // 5. Hourly velocity tx count cap
        if (metrics.txCountLastHour >= agent.maxTxPerHour) {
          return rejectWith(
            'HOURLY_VELOCITY_EXCEEDED',
            `Hourly velocity limit reached (${metrics.txCountLastHour}/${agent.maxTxPerHour} transactions in last 60m)`,
            true
          );
        }

        // 6. Total budget, monthly limit, daily limit
        if (metrics.committedTotalCents + input.amountCents > agent.totalBudgetCents) {
          return rejectWith(
            'TOTAL_BUDGET_EXCEEDED',
            `Amount ${formatCents(input.amountCents)} exceeds remaining total budget (${formatCents(
              metrics.remainingTotalCents
            )} left of ${formatCents(agent.totalBudgetCents)})`,
            false
          );
        }

        if (metrics.spend30dCents + input.amountCents > agent.monthlyLimitCents) {
          return rejectWith(
            'MONTHLY_LIMIT_EXCEEDED',
            `Amount ${formatCents(input.amountCents)} exceeds remaining 30-day limit (${formatCents(
              metrics.remainingMonthlyCents
            )} left of ${formatCents(agent.monthlyLimitCents)})`,
            false
          );
        }

        if (metrics.spend24hCents + input.amountCents > agent.dailyLimitCents) {
          return rejectWith(
            'DAILY_LIMIT_EXCEEDED',
            `Amount ${formatCents(input.amountCents)} exceeds remaining 24-hour daily limit (${formatCents(
              metrics.remainingDailyCents
            )} left of ${formatCents(agent.dailyLimitCents)})`,
            false
          );
        }

        // 7. Escalate to human approval if over approval threshold
        if (input.amountCents > agent.approvalThresholdCents) {
          const auth = insertAuth({
            status: 'pending_approval',
            decisionCode: 'APPROVAL_REQUIRED',
            decisionReason: `Amount ${formatCents(
              input.amountCents
            )} exceeds autonomous threshold (${formatCents(
              agent.approvalThresholdCents
            )}); queued for operator approval`,
            receiptStatus: 'not_applicable'
          });
          const updatedMetrics = this.computeAgentMetrics(agent, referenceNow);
          return {
            kind: 'created',
            authorization: auth,
            walletFrozen: false,
            metrics: updatedMetrics,
            agent
          };
        }

        // 8. Instant approval & budget reservation
        const receiptDueAt = new Date(
          referenceNow.getTime() + 24 * 60 * 60 * 1000
        ).toISOString();
        const auth = insertAuth({
          status: 'approved',
          decisionCode: 'APPROVED',
          decisionReason: `Approved within spend envelope (${formatCents(
            input.amountCents
          )} at ${vendorInfo.domain})`,
          receiptStatus: 'pending',
          receiptDueAt
        });

        const updatedMetrics = this.computeAgentMetrics(agent, referenceNow);
        return {
          kind: 'created',
          authorization: auth,
          walletFrozen: false,
          metrics: updatedMetrics,
          agent
        };
      })
      .immediate();

    if (reserved.kind === 'existing') {
      const auth = reserved.authorization;
      const approved = auth.status === 'approved' || auth.status === 'settled' || auth.status === 'reconciled';
      let card: EphemeralCardDetails | undefined;

      if (auth.status === 'approved' && !reserved.cardRow) {
        card = await this.mintAndSaveCard(auth, referenceNow);
      } else if (
        auth.status === 'approved' &&
        reserved.cardRow &&
        !reserved.cardRow.claimedAt &&
        this.cardProvider.deriveCredentials
      ) {
        const derived = this.cardProvider.deriveCredentials(
          auth.id,
          new Date(reserved.cardRow.expiresAt)
        );
        if (derived) {
          card = {
            ...reserved.cardRow,
            pan: derived.pan,
            cvc: derived.cvc
          };
        }
      }

      return {
        approved,
        escalated: auth.status === 'pending_approval',
        status: auth.status,
        decisionCode: auth.decisionCode,
        reason: auth.decisionReason,
        walletFrozen: reserved.agent.status === 'frozen',
        authorization: auth,
        card,
        cardMasked: reserved.cardRow ?? undefined,
        remainingBudgetCents: reserved.metrics.remainingTotalCents,
        remainingDailyCents: reserved.metrics.remainingDailyCents,
        remainingMonthlyCents: reserved.metrics.remainingMonthlyCents
      };
    }

    const auth = reserved.authorization;
    if (auth.status === 'approved') {
      try {
        const card = await this.mintAndSaveCard(auth, referenceNow);
        const refreshedAuth = this.getAuthorizationRecord(auth.id);
        return {
          approved: true,
          escalated: false,
          status: refreshedAuth.status,
          decisionCode: refreshedAuth.decisionCode,
          reason: refreshedAuth.decisionReason,
          walletFrozen: false,
          authorization: refreshedAuth,
          card,
          cardMasked: this.stripCardSecrets(card),
          remainingBudgetCents: reserved.metrics.remainingTotalCents,
          remainingDailyCents: reserved.metrics.remainingDailyCents,
          remainingMonthlyCents: reserved.metrics.remainingMonthlyCents
        };
      } catch (err) {
        this.sqlite
          .transaction(() => {
            this.db
              .update(authorizations)
              .set({
                status: 'voided',
                decisionCode: 'VOIDED',
                decisionReason: `Card provider failed: ${(err as Error).message}`,
                receiptStatus: 'not_applicable',
                updatedAt: this.now().toISOString()
              })
              .where(eq(authorizations.id, auth.id))
              .run();
          })
          .immediate();
        throw err;
      }
    }

    return {
      approved: false,
      escalated: auth.status === 'pending_approval',
      status: auth.status,
      decisionCode: auth.decisionCode,
      reason: auth.decisionReason,
      walletFrozen: reserved.walletFrozen,
      authorization: auth,
      remainingBudgetCents: reserved.metrics.remainingTotalCents,
      remainingDailyCents: reserved.metrics.remainingDailyCents,
      remainingMonthlyCents: reserved.metrics.remainingMonthlyCents
    };
  }

  private stripCardSecrets(card: EphemeralCardDetails): MaskedCardSummary {
    const { pan: _pan, cvc: _cvc, ...masked } = card;
    return masked;
  }

  private async mintAndSaveCard(
    auth: AuthorizationRecord,
    referenceNow: Date,
    markClaimed = false
  ): Promise<EphemeralCardDetails> {
    const existingPromise = this.inflightIssuance.get(auth.id);
    if (existingPromise) {
      return existingPromise;
    }

    const task = (async (): Promise<EphemeralCardDetails> => {
      const expiresAt = new Date(referenceNow.getTime() + 60 * 60 * 1000);
      const issued: IssuedCardCredentials = await this.cardProvider.issueSingleUseCard({
        authorizationId: auth.id,
        agentId: auth.agentId,
        spendingLimitCents: auth.amountCents,
        currency: auth.currency,
        lockedVendorDomain: auth.vendorDomain,
        expiresAt,
        singleUse: true
      });

      const cardId = `vc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const nowIso = this.now().toISOString();
      const expiresIso = expiresAt.toISOString();
      const claimedAt = markClaimed ? nowIso : null;

      this.sqlite
        .transaction(() => {
          const existing = this.sqlite
            .prepare('SELECT * FROM virtual_cards WHERE authorization_id = ?')
            .get(auth.id) as Record<string, unknown> | undefined;
          if (existing) {
            return;
          }

          this.db
            .insert(virtualCards)
            .values({
              id: cardId,
              authorizationId: auth.id,
              agentId: auth.agentId,
              provider: issued.provider,
              providerCardId: issued.providerCardId,
              paymentToken: issued.paymentToken,
              brand: issued.brand,
              last4: issued.last4,
              maskedPan: issued.maskedPan,
              expMonth: issued.expMonth,
              expYear: issued.expYear,
              spendingLimitCents: auth.amountCents,
              spentCents: 0,
              lockedVendorDomain: auth.vendorDomain,
              singleUse: true,
              status: 'active',
              claimedAt,
              expiresAt: expiresIso,
              usedAt: null,
              createdAt: nowIso
            })
            .run();

          this.db
            .update(authorizations)
            .set({
              cardId,
              updatedAt: nowIso
            })
            .where(eq(authorizations.id, auth.id))
            .run();
        })
        .immediate();

      return {
        id: cardId,
        authorizationId: auth.id,
        agentId: auth.agentId,
        provider: issued.provider,
        providerCardId: issued.providerCardId,
        paymentToken: issued.paymentToken,
        brand: issued.brand,
        last4: issued.last4,
        maskedPan: issued.maskedPan,
        pan: issued.pan,
        cvc: issued.cvc,
        expMonth: issued.expMonth,
        expYear: issued.expYear,
        spendingLimitCents: auth.amountCents,
        spentCents: 0,
        lockedVendorDomain: auth.vendorDomain,
        singleUse: true,
        status: 'active',
        claimedAt,
        expiresAt: expiresIso,
        usedAt: null,
        createdAt: nowIso
      };
    })();

    this.inflightIssuance.set(auth.id, task);
    try {
      return await task;
    } finally {
      this.inflightIssuance.delete(auth.id);
    }
  }

  async approveAuthorization(
    authId: string,
    operatorName = 'operator',
    note?: string
  ): Promise<AuthorizationView> {
    const referenceNow = this.now();
    const nowIso = referenceNow.toISOString();

    const updatedAuth = this.sqlite
      .transaction(() => {
        const row = this.sqlite
          .prepare('SELECT * FROM authorizations WHERE id = ?')
          .get(authId) as Record<string, unknown> | undefined;
        if (!row) {
          throw new DomainError(`Authorization "${authId}" not found`, 404, 'AUTH_NOT_FOUND');
        }
        const auth = this.mapAuthorizationRow(row);
        if (auth.status !== 'pending_approval') {
          throw new DomainError(
            `Authorization "${authId}" is in status "${auth.status}", expected "pending_approval"`,
            409,
            'INVALID_AUTH_STATE'
          );
        }

        const receiptDueAt = new Date(
          referenceNow.getTime() + 24 * 60 * 60 * 1000
        ).toISOString();
        const reason = note?.trim()
          ? `Approved by ${operatorName}: ${note.trim()}`
          : `Approved by operator ${operatorName}`;

        this.db
          .update(authorizations)
          .set({
            status: 'approved',
            decisionCode: 'APPROVED_BY_OPERATOR',
            decisionReason: reason,
            decidedBy: `operator:${operatorName}`,
            receiptStatus: 'pending',
            receiptDueAt,
            updatedAt: nowIso
          })
          .where(eq(authorizations.id, authId))
          .run();

        return this.getAuthorizationRecord(authId);
      })
      .immediate();

    await this.mintAndSaveCard(updatedAuth, referenceNow, false);
    return this.getAuthorizationView(authId);
  }

  rejectAuthorization(
    authId: string,
    operatorName = 'operator',
    reason = 'Rejected by operator'
  ): AuthorizationView {
    const nowIso = this.now().toISOString();

    this.sqlite
      .transaction(() => {
        const row = this.sqlite
          .prepare('SELECT * FROM authorizations WHERE id = ?')
          .get(authId) as Record<string, unknown> | undefined;
        if (!row) {
          throw new DomainError(`Authorization "${authId}" not found`, 404, 'AUTH_NOT_FOUND');
        }
        const auth = this.mapAuthorizationRow(row);
        if (auth.status !== 'pending_approval') {
          throw new DomainError(
            `Authorization "${authId}" cannot be rejected from status "${auth.status}"`,
            409,
            'INVALID_AUTH_STATE'
          );
        }

        this.db
          .update(authorizations)
          .set({
            status: 'rejected',
            decisionCode: 'REJECTED_BY_OPERATOR',
            decisionReason: reason,
            decidedBy: `operator:${operatorName}`,
            receiptStatus: 'not_applicable',
            updatedAt: nowIso
          })
          .where(eq(authorizations.id, authId))
          .run();
      })
      .immediate();

    return this.getAuthorizationView(authId);
  }

  async voidAuthorization(authId: string, reason = 'Voided by caller'): Promise<AuthorizationView> {
    const nowIso = this.now().toISOString();

    const cardToVoid = this.sqlite
      .transaction(() => {
        const row = this.sqlite
          .prepare('SELECT * FROM authorizations WHERE id = ?')
          .get(authId) as Record<string, unknown> | undefined;
        if (!row) {
          throw new DomainError(`Authorization "${authId}" not found`, 404, 'AUTH_NOT_FOUND');
        }
        const auth = this.mapAuthorizationRow(row);
        if (auth.status !== 'approved' && auth.status !== 'pending_approval') {
          throw new DomainError(
            `Authorization "${authId}" cannot be voided from status "${auth.status}"`,
            409,
            'INVALID_AUTH_STATE'
          );
        }

        this.db
          .update(authorizations)
          .set({
            status: 'voided',
            decisionCode: 'VOIDED',
            decisionReason: reason,
            receiptStatus: 'not_applicable',
            updatedAt: nowIso
          })
          .where(eq(authorizations.id, authId))
          .run();

        const cardRow = this.sqlite
          .prepare('SELECT * FROM virtual_cards WHERE authorization_id = ?')
          .get(authId) as Record<string, unknown> | undefined;

        if (cardRow) {
          const card = this.mapCardRow(cardRow);
          if (card.status === 'active') {
            this.db
              .update(virtualCards)
              .set({ status: 'voided' })
              .where(eq(virtualCards.id, card.id))
              .run();
            return card.providerCardId;
          }
        }
        return null;
      })
      .immediate();

    if (cardToVoid) {
      await this.cardProvider.voidCard(cardToVoid);
    }

    return this.getAuthorizationView(authId);
  }

  claimApprovedCard(authId: string): {
    authorization: AuthorizationRecord;
    card: EphemeralCardDetails;
  } {
    const nowIso = this.now().toISOString();

    const claimed = this.sqlite
      .transaction(() => {
        const authRow = this.sqlite
          .prepare('SELECT * FROM authorizations WHERE id = ?')
          .get(authId) as Record<string, unknown> | undefined;
        if (!authRow) {
          throw new DomainError(`Authorization "${authId}" not found`, 404, 'AUTH_NOT_FOUND');
        }
        const auth = this.mapAuthorizationRow(authRow);
        if (auth.status !== 'approved') {
          throw new DomainError(
            `Card is not claimable while authorization status is "${auth.status}"`,
            409,
            'CARD_NOT_CLAIMABLE'
          );
        }

        const cardRow = this.sqlite
          .prepare('SELECT * FROM virtual_cards WHERE authorization_id = ?')
          .get(authId) as Record<string, unknown> | undefined;
        if (!cardRow) {
          throw new DomainError(`Virtual card not found for "${authId}"`, 404, 'CARD_NOT_FOUND');
        }
        const card = this.mapCardRow(cardRow);
        if (card.status !== 'active') {
          throw new DomainError(
            `Virtual card is "${card.status}" and cannot be claimed`,
            409,
            'CARD_NOT_ACTIVE'
          );
        }
        if (card.claimedAt) {
          throw new DomainError(
            `Ephemeral card credentials for "${authId}" have already been claimed`,
            409,
            'CARD_ALREADY_CLAIMED'
          );
        }

        this.db
          .update(virtualCards)
          .set({ claimedAt: nowIso })
          .where(eq(virtualCards.id, card.id))
          .run();

        const derived = this.cardProvider.deriveCredentials?.(
          auth.id,
          new Date(card.expiresAt)
        );

        const pan = derived?.pan ?? card.maskedPan;
        const cvc = derived?.cvc ?? '000';

        return {
          authorization: auth,
          card: {
            ...card,
            claimedAt: nowIso,
            pan,
            cvc
          }
        };
      })
      .immediate();

    return claimed;
  }

  simulateCharge(input: {
    paymentToken: string;
    merchantVendor: string;
    amountCents: number;
    description?: string;
  }): {
    settled: boolean;
    authorization: AuthorizationRecord;
    card: MaskedCardSummary;
  } {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new DomainError('amountCents must be a positive integer', 400, 'INVALID_AMOUNT');
    }

    const referenceNow = this.now();
    const nowIso = referenceNow.toISOString();

    return this.sqlite
      .transaction(() => {
        const cardRow = this.sqlite
          .prepare('SELECT * FROM virtual_cards WHERE payment_token = ?')
          .get(input.paymentToken) as Record<string, unknown> | undefined;
        if (!cardRow) {
          throw new DomainError('Invalid payment token', 404, 'CARD_NOT_FOUND');
        }
        const card = this.mapCardRow(cardRow);

        const authRow = this.sqlite
          .prepare('SELECT * FROM authorizations WHERE id = ?')
          .get(card.authorizationId) as Record<string, unknown> | undefined;
        if (!authRow) {
          throw new DomainError('Authorization missing for card', 404, 'AUTH_NOT_FOUND');
        }
        const auth = this.mapAuthorizationRow(authRow);

        if (card.status === 'used') {
          throw new DomainError(
            'Single-use virtual card has already been spent',
            409,
            'SINGLE_USE_CARD_EXHAUSTED'
          );
        }
        if (card.status !== 'active' || auth.status !== 'approved') {
          throw new DomainError(
            `Virtual card cannot be charged (card status: ${card.status}, auth status: ${auth.status})`,
            409,
            'CARD_NOT_ACTIVE'
          );
        }

        if (new Date(card.expiresAt).getTime() <= referenceNow.getTime()) {
          this.db
            .update(virtualCards)
            .set({ status: 'expired' })
            .where(eq(virtualCards.id, card.id))
            .run();
          this.db
            .update(authorizations)
            .set({ status: 'expired', receiptStatus: 'not_applicable', updatedAt: nowIso })
            .where(eq(authorizations.id, auth.id))
            .run();
          throw new DomainError('Virtual card has expired', 409, 'CARD_EXPIRED');
        }

        if (
          !matchesVendorPattern(input.merchantVendor, card.lockedVendorDomain) &&
          !matchesVendorPattern(card.lockedVendorDomain, input.merchantVendor)
        ) {
          throw new DomainError(
            `Merchant "${input.merchantVendor}" does not match locked vendor "${card.lockedVendorDomain}"`,
            403,
            'MERCHANT_LOCK_MISMATCH'
          );
        }

        if (input.amountCents > card.spendingLimitCents) {
          throw new DomainError(
            `Charge ${formatCents(input.amountCents)} exceeds single-use card limit of ${formatCents(
              card.spendingLimitCents
            )}`,
            402,
            'CARD_LIMIT_EXCEEDED'
          );
        }

        const nextMeta = input.description
          ? { ...auth.metadata, settlementDescription: input.description }
          : auth.metadata;

        this.db
          .update(virtualCards)
          .set({
            status: 'used',
            spentCents: input.amountCents,
            usedAt: nowIso
          })
          .where(eq(virtualCards.id, card.id))
          .run();

        this.db
          .update(authorizations)
          .set({
            status: 'settled',
            settledAmountCents: input.amountCents,
            metadata: JSON.stringify(nextMeta),
            updatedAt: nowIso
          })
          .where(eq(authorizations.id, auth.id))
          .run();

        const updatedCardRow = this.sqlite
          .prepare('SELECT * FROM virtual_cards WHERE id = ?')
          .get(card.id) as Record<string, unknown>;
        const updatedAuthRow = this.sqlite
          .prepare('SELECT * FROM authorizations WHERE id = ?')
          .get(auth.id) as Record<string, unknown>;

        return {
          settled: true,
          authorization: this.mapAuthorizationRow(updatedAuthRow),
          card: this.mapCardRow(updatedCardRow)
        };
      })
      .immediate();
  }

  recordProviderSettlement(params: {
    authorizationId?: string;
    providerCardId?: string;
    amountCents?: number;
  }): AuthorizationView | null {
    const nowIso = this.now().toISOString();

    const authId = this.sqlite
      .transaction(() => {
        let authRow: Record<string, unknown> | undefined;
        let cardRow: Record<string, unknown> | undefined;

        if (params.authorizationId) {
          authRow = this.sqlite
            .prepare('SELECT * FROM authorizations WHERE id = ?')
            .get(params.authorizationId) as Record<string, unknown> | undefined;
        }
        if (params.providerCardId) {
          cardRow = this.sqlite
            .prepare('SELECT * FROM virtual_cards WHERE provider_card_id = ?')
            .get(params.providerCardId) as Record<string, unknown> | undefined;
          if (!authRow && cardRow) {
            authRow = this.sqlite
              .prepare('SELECT * FROM authorizations WHERE id = ?')
              .get(String(cardRow.authorization_id)) as Record<string, unknown> | undefined;
          }
        }
        if (!authRow) return null;

        const auth = this.mapAuthorizationRow(authRow);
        const settledAmount = params.amountCents ?? auth.amountCents;

        this.db
          .update(authorizations)
          .set({
            status: 'settled',
            settledAmountCents: settledAmount,
            updatedAt: nowIso
          })
          .where(eq(authorizations.id, auth.id))
          .run();

        this.db
          .update(virtualCards)
          .set({
            status: 'used',
            spentCents: settledAmount,
            usedAt: nowIso
          })
          .where(eq(virtualCards.authorizationId, auth.id))
          .run();

        return auth.id;
      })
      .immediate();

    return authId ? this.getAuthorizationView(authId) : null;
  }

  getAuthorizationRecord(authId: string): AuthorizationRecord {
    const row = this.sqlite
      .prepare('SELECT * FROM authorizations WHERE id = ?')
      .get(authId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new DomainError(`Authorization "${authId}" not found`, 404, 'AUTH_NOT_FOUND');
    }
    return this.mapAuthorizationRow(row);
  }

  getAuthorizationView(authId: string): AuthorizationView {
    const views = this.listAuthorizations({ authorizationId: authId });
    const found = views[0];
    if (!found) {
      throw new DomainError(`Authorization "${authId}" not found`, 404, 'AUTH_NOT_FOUND');
    }
    return found;
  }

  listAuthorizations(filters?: {
    authorizationId?: string;
    agentId?: string;
    status?: string;
    receiptStatus?: string;
  }): AuthorizationView[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.authorizationId) {
      clauses.push('a.id = ?');
      params.push(filters.authorizationId);
    }
    if (filters?.agentId) {
      clauses.push('a.agent_id = ?');
      params.push(filters.agentId);
    }
    if (filters?.status) {
      clauses.push('a.status = ?');
      params.push(filters.status);
    }
    if (filters?.receiptStatus) {
      clauses.push('a.receipt_status = ?');
      params.push(filters.receiptStatus);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const authRows = this.sqlite
      .prepare(
        `SELECT a.*, ag.name as agent_name
         FROM authorizations a
         LEFT JOIN agents ag ON ag.id = a.agent_id
         ${where}
         ORDER BY a.created_at DESC, a.rowid DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    if (authRows.length === 0) return [];

    const cardsByAuth = new Map<string, MaskedCardSummary>();
    const cardRows = this.sqlite
      .prepare('SELECT * FROM virtual_cards')
      .all() as Array<Record<string, unknown>>;
    for (const c of cardRows) {
      const mapped = this.mapCardRow(c);
      cardsByAuth.set(mapped.authorizationId, mapped);
    }

    const receiptsByAuth = new Map<string, ReceiptRecord>();
    const receiptRows = this.sqlite
      .prepare('SELECT * FROM receipts WHERE authorization_id IS NOT NULL ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;
    for (const r of receiptRows) {
      const authKey = String(r.authorization_id);
      if (!receiptsByAuth.has(authKey)) {
        receiptsByAuth.set(authKey, {
          id: String(r.id),
          authorizationId: authKey,
          agentId: r.agent_id ? String(r.agent_id) : null,
          rawFormat: String(r.raw_format) as 'text' | 'html' | 'json',
          rawContent: String(r.raw_content),
          merchant: String(r.merchant),
          merchantDomain: String(r.merchant_domain),
          subtotalCents: Number(r.subtotal_cents),
          taxCents: Number(r.tax_cents),
          totalCents: Number(r.total_cents),
          currency: String(r.currency),
          lineItems: JSON.parse(String(r.line_items ?? '[]')),
          extractedMeta: this.parseJsonObject(r.extracted_meta),
          matchStatus: String(r.match_status) as 'matched' | 'mismatch' | 'unmatched',
          discrepancyCents: Number(r.discrepancy_cents),
          reconciliationNotes: String(r.reconciliation_notes ?? ''),
          createdAt: String(r.created_at)
        });
      }
    }

    return authRows.map((row) => {
      const base = this.mapAuthorizationRow(row);
      return {
        ...base,
        agentName: row.agent_name ? String(row.agent_name) : base.agentId,
        card: cardsByAuth.get(base.id) ?? null,
        receipt: receiptsByAuth.get(base.id) ?? null
      };
    });
  }

  listAnomalies(limit = 50): AnomalyEventRecord[] {
    const rows = this.sqlite
      .prepare('SELECT * FROM anomaly_events ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      agentId: String(row.agent_id),
      authorizationId: row.authorization_id ? String(row.authorization_id) : null,
      type: String(row.type),
      severity: String(row.severity) as 'warning' | 'critical',
      description: String(row.description),
      autoFrozeWallet: Boolean(row.auto_froze_wallet),
      createdAt: String(row.created_at)
    }));
  }

  getDashboardOverview() {
    const agentList = this.listAgents();
    const allAuths = this.listAuthorizations();
    const anomalies = this.listAnomalies(30);
    const pendingApprovals = allAuths.filter((a) => a.status === 'pending_approval');

    let totalEnvelopeCents = 0;
    let totalCommittedCents = 0;
    let totalSettledCents = 0;
    let spend24hCents = 0;
    let activeAgents = 0;
    let frozenAgents = 0;

    for (const agent of agentList) {
      if (agent.status === 'active') activeAgents++;
      if (agent.status === 'frozen') frozenAgents++;
      totalEnvelopeCents += agent.totalBudgetCents;
      totalCommittedCents += agent.metrics.committedTotalCents;
      totalSettledCents += agent.metrics.settledTotalCents;
      spend24hCents += agent.metrics.spend24hCents;
    }

    let receiptMatchedCount = 0;
    let receiptMismatchCount = 0;
    let receiptMissingCount = 0;
    let receiptPendingCount = 0;

    for (const auth of allAuths) {
      if (auth.receiptStatus === 'matched') receiptMatchedCount++;
      else if (auth.receiptStatus === 'mismatch') receiptMismatchCount++;
      else if (auth.receiptStatus === 'missing_flagged') receiptMissingCount++;
      else if (auth.receiptStatus === 'pending') receiptPendingCount++;
    }

    return {
      summary: {
        totalAgents: agentList.length,
        activeAgents,
        frozenAgents,
        totalEnvelopeCents,
        totalCommittedCents,
        totalSettledCents,
        spend24hCents,
        pendingApprovalCount: pendingApprovals.length,
        receiptMatchedCount,
        receiptMismatchCount,
        receiptMissingCount,
        receiptPendingCount
      },
      agents: agentList,
      pendingApprovals,
      authorizations: allAuths,
      anomalies
    };
  }
}

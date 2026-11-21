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

export interface RequestSpendResponse {
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

export interface ReceiptLineItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface ReceiptRecord {
  id: string;
  authorizationId: string | null;
  agentId: string | null;
  rawFormat: 'text' | 'html' | 'json';
  rawContent: string;
  merchant: string;
  merchantDomain: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  lineItems: ReceiptLineItem[];
  extractedMeta: Record<string, unknown>;
  matchStatus: 'matched' | 'mismatch' | 'unmatched';
  discrepancyCents: number;
  reconciliationNotes: string;
  createdAt: string;
}

export interface SubmitReceiptInput {
  content: string | Record<string, unknown>;
  contentType?: 'text' | 'html' | 'json';
  authorizationId?: string;
  agentId?: string;
  paymentToken?: string;
}

export interface SimulateChargeInput {
  paymentToken: string;
  merchantVendor: string;
  amountCents: number;
  description?: string;
}

export interface SimulateChargeResponse {
  settled: boolean;
  authorization: AuthorizationRecord;
  card: MaskedCardSummary;
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

export interface AuthorizationView extends AuthorizationRecord {
  agentName?: string;
  card?: MaskedCardSummary | null;
  receipt?: ReceiptRecord | null;
}

export interface DashboardOverview {
  summary: {
    totalAgents: number;
    activeAgents: number;
    frozenAgents: number;
    totalEnvelopeCents: number;
    totalCommittedCents: number;
    totalSettledCents: number;
    spend24hCents: number;
    pendingApprovalCount: number;
    receiptMatchedCount: number;
    receiptMismatchCount: number;
    receiptMissingCount: number;
    receiptPendingCount: number;
  };
  agents: AgentWalletWithMetrics[];
  pendingApprovals: AuthorizationView[];
  authorizations: AuthorizationView[];
  anomalies: AnomalyEventRecord[];
}

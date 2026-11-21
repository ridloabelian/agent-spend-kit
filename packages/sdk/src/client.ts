import type {
  AgentWalletWithMetrics,
  AuthorizationRecord,
  AuthorizationView,
  CreateAgentInput,
  DashboardOverview,
  EphemeralCardDetails,
  ReceiptRecord,
  RequestSpendInput,
  RequestSpendResponse,
  SimulateChargeInput,
  SimulateChargeResponse,
  SubmitReceiptInput,
  UpdateAgentInput
} from './types.js';

export class AgentSpendError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(message: string, status: number, code = 'API_ERROR', details?: unknown) {
    super(message);
    this.name = 'AgentSpendError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface AgentSpendClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class AgentSpendClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AgentSpendClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json'
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const errObj =
        parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
      const msg =
        (typeof errObj?.error === 'string' && errObj.error) ||
        (typeof errObj?.message === 'string' && errObj.message) ||
        `HTTP ${res.status} ${res.statusText}`;
      const code = typeof errObj?.code === 'string' ? errObj.code : 'HTTP_ERROR';
      throw new AgentSpendError(msg, res.status, code, parsed);
    }

    return parsed as T;
  }

  async health(): Promise<{ ok: boolean; provider: string; timestamp: string }> {
    return this.request('GET', '/api/health');
  }

  async createAgent(input: CreateAgentInput): Promise<AgentWalletWithMetrics> {
    const res = await this.request<{ agent: AgentWalletWithMetrics }>('POST', '/api/agents', input);
    return res.agent;
  }

  async updateAgent(agentId: string, input: UpdateAgentInput): Promise<AgentWalletWithMetrics> {
    const res = await this.request<{ agent: AgentWalletWithMetrics }>(
      'PATCH',
      `/api/agents/${encodeURIComponent(agentId)}`,
      input
    );
    return res.agent;
  }

  async listAgents(): Promise<AgentWalletWithMetrics[]> {
    const res = await this.request<{ agents: AgentWalletWithMetrics[] }>('GET', '/api/agents');
    return res.agents;
  }

  async getAgent(agentId: string): Promise<AgentWalletWithMetrics> {
    const res = await this.request<{ agent: AgentWalletWithMetrics }>(
      'GET',
      `/api/agents/${encodeURIComponent(agentId)}`
    );
    return res.agent;
  }

  async freezeAgent(agentId: string, reason = 'Manual operator freeze'): Promise<AgentWalletWithMetrics> {
    const res = await this.request<{ agent: AgentWalletWithMetrics }>(
      'POST',
      `/api/agents/${encodeURIComponent(agentId)}/freeze`,
      { reason }
    );
    return res.agent;
  }

  async unfreezeAgent(agentId: string): Promise<AgentWalletWithMetrics> {
    const res = await this.request<{ agent: AgentWalletWithMetrics }>(
      'POST',
      `/api/agents/${encodeURIComponent(agentId)}/unfreeze`
    );
    return res.agent;
  }

  async requestSpend(input: RequestSpendInput): Promise<RequestSpendResponse> {
    return this.request<RequestSpendResponse>('POST', '/api/spend/request', input);
  }

  async getAuthorization(authId: string): Promise<AuthorizationView> {
    const res = await this.request<{ authorization: AuthorizationView }>(
      'GET',
      `/api/authorizations/${encodeURIComponent(authId)}`
    );
    return res.authorization;
  }

  async listAuthorizations(filters?: {
    agentId?: string;
    status?: string;
    receiptStatus?: string;
  }): Promise<AuthorizationView[]> {
    const params = new URLSearchParams();
    if (filters?.agentId) params.set('agentId', filters.agentId);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.receiptStatus) params.set('receiptStatus', filters.receiptStatus);
    const qs = params.toString();
    const res = await this.request<{ authorizations: AuthorizationView[] }>(
      'GET',
      `/api/authorizations${qs ? `?${qs}` : ''}`
    );
    return res.authorizations;
  }

  async approveAuthorization(
    authId: string,
    operatorName = 'operator',
    note?: string
  ): Promise<AuthorizationView> {
    const res = await this.request<{ authorization: AuthorizationView }>(
      'POST',
      `/api/authorizations/${encodeURIComponent(authId)}/approve`,
      { operatorName, note }
    );
    return res.authorization;
  }

  async rejectAuthorization(
    authId: string,
    operatorName = 'operator',
    reason = 'Rejected by operator'
  ): Promise<AuthorizationView> {
    const res = await this.request<{ authorization: AuthorizationView }>(
      'POST',
      `/api/authorizations/${encodeURIComponent(authId)}/reject`,
      { operatorName, reason }
    );
    return res.authorization;
  }

  async voidAuthorization(authId: string, reason = 'Voided by caller'): Promise<AuthorizationView> {
    const res = await this.request<{ authorization: AuthorizationView }>(
      'POST',
      `/api/authorizations/${encodeURIComponent(authId)}/void`,
      { reason }
    );
    return res.authorization;
  }

  async claimApprovedCard(authId: string): Promise<{
    authorization: AuthorizationRecord;
    card: EphemeralCardDetails;
  }> {
    return this.request('POST', `/api/authorizations/${encodeURIComponent(authId)}/claim-card`);
  }

  async waitForApproval(
    authId: string,
    options?: { pollIntervalMs?: number; timeoutMs?: number; claimCard?: boolean }
  ): Promise<{ authorization: AuthorizationView; card?: EphemeralCardDetails }> {
    const pollIntervalMs = options?.pollIntervalMs ?? 500;
    const timeoutMs = options?.timeoutMs ?? 30_000;
    const claimCard = options?.claimCard ?? true;
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const auth = await this.getAuthorization(authId);
      if (auth.status !== 'pending_approval') {
        if (auth.status === 'approved' && claimCard) {
          const claimed = await this.claimApprovedCard(authId);
          return { authorization: auth, card: claimed.card };
        }
        return { authorization: auth };
      }

      if (Date.now() >= deadline) {
        throw new AgentSpendError(
          `Timed out waiting for approval of ${authId}`,
          408,
          'APPROVAL_TIMEOUT'
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  async simulateCharge(input: SimulateChargeInput): Promise<SimulateChargeResponse> {
    return this.request<SimulateChargeResponse>('POST', '/api/simulator/charge', input);
  }

  async submitReceipt(input: SubmitReceiptInput): Promise<{
    receipt: ReceiptRecord;
    authorization: AuthorizationView | null;
  }> {
    return this.request('POST', '/api/receipts/ingest', input);
  }

  async listReceipts(filters?: { matchStatus?: string; agentId?: string }): Promise<ReceiptRecord[]> {
    const params = new URLSearchParams();
    if (filters?.matchStatus) params.set('matchStatus', filters.matchStatus);
    if (filters?.agentId) params.set('agentId', filters.agentId);
    const qs = params.toString();
    const res = await this.request<{ receipts: ReceiptRecord[] }>(
      'GET',
      `/api/receipts${qs ? `?${qs}` : ''}`
    );
    return res.receipts;
  }

  async auditMissingReceipts(options?: {
    olderThanMinutes?: number;
    includeAllSettled?: boolean;
  }): Promise<{ flaggedCount: number; flaggedAuthorizationIds: string[] }> {
    return this.request('POST', '/api/receipts/audit-missing', options ?? {});
  }

  async getDashboardOverview(): Promise<DashboardOverview> {
    return this.request<DashboardOverview>('GET', '/api/dashboard/overview');
  }

  async exportLedger(format: 'csv' | 'json', filters?: { agentId?: string }): Promise<string> {
    const params = new URLSearchParams({ format });
    if (filters?.agentId) params.set('agentId', filters.agentId);
    const headers: Record<string, string> = {};
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await this.fetchImpl(`${this.baseUrl}/api/ledger/export?${params.toString()}`, {
      method: 'GET',
      headers
    });
    if (!res.ok) {
      throw new AgentSpendError(`Failed to export ledger: HTTP ${res.status}`, res.status, 'EXPORT_ERROR');
    }
    return res.text();
  }

  async runSimulation(reset = true): Promise<Record<string, unknown>> {
    return this.request('POST', '/api/simulate', { reset });
  }
}

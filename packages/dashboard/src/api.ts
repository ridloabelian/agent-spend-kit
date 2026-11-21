import type {
  AgentWalletWithMetrics,
  AuthorizationView,
  CreateAgentInput,
  DashboardOverview,
  ReceiptRecord,
  RequestSpendInput,
  RequestSpendResponse,
  SimulateChargeInput,
  SimulateChargeResponse,
  SubmitReceiptInput,
  UpdateAgentInput
} from '../../sdk/src/types';

export type {
  AgentWalletWithMetrics,
  AuthorizationView,
  CreateAgentInput,
  DashboardOverview,
  ReceiptRecord,
  RequestSpendInput,
  RequestSpendResponse,
  SimulateChargeInput,
  SimulateChargeResponse,
  SubmitReceiptInput,
  UpdateAgentInput
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {})
    }
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export function formatMoney(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined) return '—';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const formatted = (abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${sign}${currency === 'USD' ? '$' : `${currency} `}${formatted}`;
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const dashboardApi = {
  getOverview: () => apiFetch<DashboardOverview>('/api/dashboard/overview'),
  createAgent: (input: CreateAgentInput) =>
    apiFetch<{ agent: AgentWalletWithMetrics }>('/api/agents', {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  updateAgent: (agentId: string, input: UpdateAgentInput) =>
    apiFetch<{ agent: AgentWalletWithMetrics }>(`/api/agents/${encodeURIComponent(agentId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input)
    }),
  freezeAgent: (agentId: string, reason?: string) =>
    apiFetch<{ agent: AgentWalletWithMetrics }>(
      `/api/agents/${encodeURIComponent(agentId)}/freeze`,
      { method: 'POST', body: JSON.stringify({ reason }) }
    ),
  unfreezeAgent: (agentId: string) =>
    apiFetch<{ agent: AgentWalletWithMetrics }>(
      `/api/agents/${encodeURIComponent(agentId)}/unfreeze`,
      { method: 'POST' }
    ),
  approveAuthorization: (authId: string, note?: string) =>
    apiFetch<{ authorization: AuthorizationView }>(
      `/api/authorizations/${encodeURIComponent(authId)}/approve`,
      { method: 'POST', body: JSON.stringify({ operatorName: 'dashboard-operator', note }) }
    ),
  rejectAuthorization: (authId: string, reason?: string) =>
    apiFetch<{ authorization: AuthorizationView }>(
      `/api/authorizations/${encodeURIComponent(authId)}/reject`,
      { method: 'POST', body: JSON.stringify({ operatorName: 'dashboard-operator', reason }) }
    ),
  requestSpend: (input: RequestSpendInput) =>
    apiFetch<RequestSpendResponse>('/api/spend/request', {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  simulateCharge: (input: SimulateChargeInput) =>
    apiFetch<SimulateChargeResponse>('/api/simulator/charge', {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  ingestReceipt: (input: SubmitReceiptInput) =>
    apiFetch<{ receipt: ReceiptRecord; authorization: AuthorizationView | null }>(
      '/api/receipts/ingest',
      {
        method: 'POST',
        body: JSON.stringify(input)
      }
    ),
  auditMissingReceipts: () =>
    apiFetch<{ flaggedCount: number; flaggedAuthorizationIds: string[] }>(
      '/api/receipts/audit-missing',
      {
        method: 'POST',
        body: JSON.stringify({ includeAllSettled: true })
      }
    ),
  runSimulation: () =>
    apiFetch('/api/simulate', {
      method: 'POST',
      body: JSON.stringify({ reset: true })
    })
};

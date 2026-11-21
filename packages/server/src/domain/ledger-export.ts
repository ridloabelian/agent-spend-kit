import type { AuthorizationView } from './policy-engine.js';

export interface LedgerExportEntry {
  authorizationId: string;
  createdAt: string;
  agentId: string;
  agentName: string;
  vendor: string;
  vendorDomain: string;
  category: string;
  purpose: string;
  currency: string;
  authorizedCents: number;
  settledCents: number | null;
  status: string;
  decisionCode: string;
  decidedBy: string;
  cardLast4: string | null;
  maskedPan: string | null;
  receiptStatus: string;
  receiptId: string | null;
  receiptTotalCents: number | null;
  discrepancyCents: number | null;
}

export function toLedgerEntries(items: AuthorizationView[]): LedgerExportEntry[] {
  return items.map((auth) => ({
    authorizationId: auth.id,
    createdAt: auth.createdAt,
    agentId: auth.agentId,
    agentName: auth.agentName ?? auth.agentId,
    vendor: auth.vendor,
    vendorDomain: auth.vendorDomain,
    category: auth.category,
    purpose: auth.purpose,
    currency: auth.currency,
    authorizedCents: auth.amountCents,
    settledCents: auth.settledAmountCents,
    status: auth.status,
    decisionCode: auth.decisionCode,
    decidedBy: auth.decidedBy,
    cardLast4: auth.card?.last4 ?? null,
    maskedPan: auth.card?.maskedPan ?? null,
    receiptStatus: auth.receiptStatus,
    receiptId: auth.receipt?.id ?? null,
    receiptTotalCents: auth.receipt?.totalCents ?? null,
    discrepancyCents: auth.receipt?.discrepancyCents ?? null
  }));
}

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportLedgerCsv(items: AuthorizationView[]): string {
  const entries = toLedgerEntries(items);
  const headers: Array<keyof LedgerExportEntry> = [
    'authorizationId',
    'createdAt',
    'agentId',
    'agentName',
    'vendor',
    'vendorDomain',
    'category',
    'purpose',
    'currency',
    'authorizedCents',
    'settledCents',
    'status',
    'decisionCode',
    'decidedBy',
    'cardLast4',
    'maskedPan',
    'receiptStatus',
    'receiptId',
    'receiptTotalCents',
    'discrepancyCents'
  ];

  const lines = [headers.join(',')];
  for (const entry of entries) {
    lines.push(headers.map((h) => escapeCsvCell(entry[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

export function exportLedgerJson(items: AuthorizationView[]): string {
  const entries = toLedgerEntries(items);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      count: entries.length,
      entries
    },
    null,
    2
  );
}

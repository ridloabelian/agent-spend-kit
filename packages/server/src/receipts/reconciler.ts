import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { anomalyEvents, authorizations, receipts, virtualCards } from '../db/schema.js';
import { matchesVendorPattern } from '../domain/vendor-matcher.js';
import { formatCents } from './money.js';
import { parseReceipt, type ParsedLineItem } from './parser.js';

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
  lineItems: ParsedLineItem[];
  extractedMeta: Record<string, unknown>;
  matchStatus: 'matched' | 'mismatch' | 'unmatched';
  discrepancyCents: number;
  reconciliationNotes: string;
  createdAt: string;
}

export interface IngestReceiptInput {
  content: string | Record<string, unknown>;
  contentType?: 'text' | 'html' | 'json';
  authorizationId?: string;
  agentId?: string;
  paymentToken?: string;
}

export class ReceiptReconciler {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly db: AppDatabase,
    private readonly now: () => Date = () => new Date()
  ) {}

  ingestReceipt(input: IngestReceiptInput): {
    receipt: ReceiptRecord;
    matchedAuthorizationId: string | null;
  } {
    const parsed = parseReceipt(input.content, input.contentType);
    const rawContent =
      typeof input.content === 'string' ? input.content : JSON.stringify(input.content, null, 2);

    const targetAuthId = input.authorizationId ?? parsed.extractedMeta.authorizationId;
    const targetToken = input.paymentToken ?? parsed.extractedMeta.paymentToken;
    const targetLast4 = parsed.extractedMeta.cardLast4;
    const nowIso = this.now().toISOString();

    return this.sqlite
      .transaction(() => {
        const candidateAuths = this.sqlite
          .prepare(
            `SELECT a.*, vc.last4 as card_last4, vc.payment_token as card_payment_token
             FROM authorizations a
             LEFT JOIN virtual_cards vc ON vc.authorization_id = a.id
             WHERE a.status IN ('approved', 'settled')
               AND a.receipt_status IN ('pending', 'missing_flagged')
             ORDER BY a.created_at DESC`
          )
          .all() as Array<{
          id: string;
          agent_id: string;
          vendor: string;
          vendor_domain: string;
          amount_cents: number;
          settled_amount_cents: number | null;
          receipt_status: string;
          card_last4: string | null;
          card_payment_token: string | null;
          created_at: string;
        }>;

        let matched = targetAuthId
          ? candidateAuths.find((a) => a.id === targetAuthId)
          : undefined;

        if (!matched && targetToken) {
          matched = candidateAuths.find((a) => a.card_payment_token === targetToken);
        }

        if (!matched && targetLast4) {
          const byLast4 = candidateAuths.filter((a) => a.card_last4 === targetLast4);
          matched =
            byLast4.find((a) =>
              matchesVendorPattern(parsed.merchantDomain || parsed.merchant, a.vendor_domain)
            ) ?? byLast4[0];
        }

        if (!matched) {
          const vendorMatches = candidateAuths.filter((a) => {
            if (input.agentId && a.agent_id !== input.agentId) return false;
            return (
              matchesVendorPattern(parsed.merchantDomain || parsed.merchant, a.vendor_domain) ||
              matchesVendorPattern(a.vendor_domain, parsed.merchantDomain || parsed.merchant)
            );
          });

          if (vendorMatches.length > 0) {
            vendorMatches.sort((a, b) => {
              const aExpected = a.settled_amount_cents ?? a.amount_cents;
              const bExpected = b.settled_amount_cents ?? b.amount_cents;
              const aDiff = Math.abs(aExpected - parsed.totalCents);
              const bDiff = Math.abs(bExpected - parsed.totalCents);
              if (aDiff !== bDiff) return aDiff - bDiff;
              return b.created_at.localeCompare(a.created_at);
            });
            matched = vendorMatches[0];
          }
        }

        const receiptId = `rcpt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

        let matchStatus: 'matched' | 'mismatch' | 'unmatched' = 'unmatched';
        let discrepancyCents = 0;
        let notes = 'No open unreceipted authorization matched merchant/token/last4.';

        if (matched) {
          const expectedCents = matched.settled_amount_cents ?? matched.amount_cents;
          discrepancyCents = parsed.totalCents - expectedCents;

          if (discrepancyCents === 0) {
            matchStatus = 'matched';
            notes = `Exact match against authorization ${matched.id} (${formatCents(expectedCents)}).`;

            this.db
              .update(authorizations)
              .set({
                status: 'reconciled',
                settledAmountCents: parsed.totalCents,
                receiptStatus: 'matched',
                updatedAt: nowIso
              })
              .where(eq(authorizations.id, matched.id))
              .run();

            this.db
              .update(virtualCards)
              .set({
                status: 'used',
                spentCents: parsed.totalCents,
                usedAt: nowIso
              })
              .where(eq(virtualCards.authorizationId, matched.id))
              .run();
          } else {
            matchStatus = 'mismatch';
            const deltaSign = discrepancyCents > 0 ? '+' : '-';
            notes = `Amount mismatch vs authorization ${matched.id}: expected ${formatCents(
              expectedCents
            )}, receipt total ${formatCents(parsed.totalCents)} (${deltaSign}${formatCents(
              Math.abs(discrepancyCents)
            )}).`;

            this.db
              .update(authorizations)
              .set({
                status: 'settled',
                settledAmountCents: parsed.totalCents,
                receiptStatus: 'mismatch',
                updatedAt: nowIso
              })
              .where(eq(authorizations.id, matched.id))
              .run();

            this.db
              .update(virtualCards)
              .set({
                status: 'used',
                spentCents: parsed.totalCents,
                usedAt: nowIso
              })
              .where(eq(virtualCards.authorizationId, matched.id))
              .run();

            this.db
              .insert(anomalyEvents)
              .values({
                id: `anom_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
                agentId: matched.agent_id,
                authorizationId: matched.id,
                type: 'RECEIPT_MISMATCH',
                severity: 'warning',
                description: notes,
                autoFrozeWallet: false,
                createdAt: nowIso
              })
              .run();
          }
        }

        const insertedRow = {
          id: receiptId,
          authorizationId: matched?.id ?? null,
          agentId: matched?.agent_id ?? input.agentId ?? null,
          rawFormat: parsed.format,
          rawContent,
          merchant: parsed.merchant,
          merchantDomain: parsed.merchantDomain,
          subtotalCents: parsed.subtotalCents,
          taxCents: parsed.taxCents,
          totalCents: parsed.totalCents,
          currency: parsed.currency,
          lineItems: JSON.stringify(parsed.lineItems),
          extractedMeta: JSON.stringify(parsed.extractedMeta),
          matchStatus,
          discrepancyCents,
          reconciliationNotes: notes,
          createdAt: nowIso
        };

        this.db.insert(receipts).values(insertedRow).run();

        const record: ReceiptRecord = {
          id: receiptId,
          authorizationId: insertedRow.authorizationId,
          agentId: insertedRow.agentId,
          rawFormat: parsed.format,
          rawContent,
          merchant: parsed.merchant,
          merchantDomain: parsed.merchantDomain,
          subtotalCents: parsed.subtotalCents,
          taxCents: parsed.taxCents,
          totalCents: parsed.totalCents,
          currency: parsed.currency,
          lineItems: parsed.lineItems,
          extractedMeta: parsed.extractedMeta,
          matchStatus,
          discrepancyCents,
          reconciliationNotes: notes,
          createdAt: nowIso
        };

        return {
          receipt: record,
          matchedAuthorizationId: matched?.id ?? null
        };
      })
      .immediate();
  }

  auditMissingReceipts(options?: {
    olderThanMinutes?: number;
    includeAllSettled?: boolean;
  }): { flaggedCount: number; flaggedAuthorizationIds: string[] } {
    const olderThanMinutes = options?.olderThanMinutes ?? 60;
    const includeAllSettled = options?.includeAllSettled ?? false;
    const cutoffIso = new Date(this.now().getTime() - olderThanMinutes * 60_000).toISOString();
    const nowIso = this.now().toISOString();

    return this.sqlite
      .transaction(() => {
        const candidates = this.sqlite
          .prepare(
            `SELECT id, agent_id, vendor, amount_cents, settled_amount_cents, status, updated_at, created_at
             FROM authorizations
             WHERE status IN ('approved', 'settled')
               AND receipt_status = 'pending'`
          )
          .all() as Array<{
          id: string;
          agent_id: string;
          vendor: string;
          amount_cents: number;
          settled_amount_cents: number | null;
          status: string;
          updated_at: string;
          created_at: string;
        }>;

        const flaggedAuthorizationIds: string[] = [];

        for (const auth of candidates) {
          const isOverdue = auth.updated_at <= cutoffIso || auth.created_at <= cutoffIso;
          const isSettledAudit = includeAllSettled && auth.status === 'settled';
          if (!isOverdue && !isSettledAudit) continue;

          this.db
            .update(authorizations)
            .set({
              receiptStatus: 'missing_flagged',
              updatedAt: nowIso
            })
            .where(eq(authorizations.id, auth.id))
            .run();

          this.db
            .insert(anomalyEvents)
            .values({
              id: `anom_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
              agentId: auth.agent_id,
              authorizationId: auth.id,
              type: 'MISSING_RECEIPT',
              severity: 'warning',
              description: `Authorization ${auth.id} (${auth.vendor}, ${formatCents(
                auth.settled_amount_cents ?? auth.amount_cents
              )}) is missing a reconciled receipt.`,
              autoFrozeWallet: false,
              createdAt: nowIso
            })
            .run();

          flaggedAuthorizationIds.push(auth.id);
        }

        return {
          flaggedCount: flaggedAuthorizationIds.length,
          flaggedAuthorizationIds
        };
      })
      .immediate();
  }

  listReceipts(filters?: { matchStatus?: string; agentId?: string }): ReceiptRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.matchStatus) {
      clauses.push('match_status = ?');
      params.push(filters.matchStatus);
    }
    if (filters?.agentId) {
      clauses.push('agent_id = ?');
      params.push(filters.agentId);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.sqlite
      .prepare(`SELECT * FROM receipts ${where} ORDER BY created_at DESC`)
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      authorizationId: row.authorization_id ? String(row.authorization_id) : null,
      agentId: row.agent_id ? String(row.agent_id) : null,
      rawFormat: String(row.raw_format) as 'text' | 'html' | 'json',
      rawContent: String(row.raw_content),
      merchant: String(row.merchant),
      merchantDomain: String(row.merchant_domain),
      subtotalCents: Number(row.subtotal_cents),
      taxCents: Number(row.tax_cents),
      totalCents: Number(row.total_cents),
      currency: String(row.currency),
      lineItems: JSON.parse(String(row.line_items ?? '[]')) as ParsedLineItem[],
      extractedMeta: JSON.parse(String(row.extracted_meta ?? '{}')) as Record<string, unknown>,
      matchStatus: String(row.match_status) as 'matched' | 'mismatch' | 'unmatched',
      discrepancyCents: Number(row.discrepancy_cents),
      reconciliationNotes: String(row.reconciliation_notes ?? ''),
      createdAt: String(row.created_at)
    }));
  }
}

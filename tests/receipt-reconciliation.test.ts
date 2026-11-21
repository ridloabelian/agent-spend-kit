import { describe, expect, it } from 'vitest';
import { createApp, exportLedgerCsv, exportLedgerJson, parseReceipt } from '@agent-spend-kit/server';

describe('Receipt parsing, reconciliation, missing-receipt audit & ledger export', () => {
  it('parses plain-text, HTML, and JSON receipts accurately', () => {
    const textParsed = parseReceipt(
      [
        'Merchant: OpenAI',
        'Domain: api.openai.com',
        '2 x Embeddings Batch @ $12.50  $25.00',
        'Subtotal: $25.00',
        'Tax: $2.00',
        'Total: $27.00'
      ].join('\n'),
      'text'
    );
    expect(textParsed.merchant).toBe('OpenAI');
    expect(textParsed.merchantDomain).toBe('api.openai.com');
    expect(textParsed.lineItems).toHaveLength(1);
    expect(textParsed.subtotalCents).toBe(2_500);
    expect(textParsed.taxCents).toBe(200);
    expect(textParsed.totalCents).toBe(2_700);

    const htmlParsed = parseReceipt(
      `<html><body>
        <h1 data-merchant="Anthropic">Anthropic Receipt</h1>
        <a href="https://anthropic.com">anthropic.com</a>
        <table>
          <tr><td>Claude Credits</td><td>1</td><td>$50.00</td><td>$50.00</td></tr>
          <tr><td>Subtotal</td><td>$50.00</td></tr>
          <tr><td>Tax</td><td>$4.50</td></tr>
          <tr><td>Grand Total</td><td>$54.50</td></tr>
        </table>
      </body></html>`,
      'html'
    );
    expect(htmlParsed.merchant).toBe('Anthropic');
    expect(htmlParsed.merchantDomain).toBe('anthropic.com');
    expect(htmlParsed.subtotalCents).toBe(5_000);
    expect(htmlParsed.taxCents).toBe(450);
    expect(htmlParsed.totalCents).toBe(5_450);

    const jsonParsed = parseReceipt({
      merchant: 'Cloudflare',
      merchantDomain: 'cloudflare.com',
      items: [{ description: 'R2 Storage', quantity: 2, unitPrice: '7.50', total: '15.00' }],
      subtotal: '15.00',
      tax: '0.00',
      total: '15.00'
    });
    expect(jsonParsed.merchantDomain).toBe('cloudflare.com');
    expect(jsonParsed.totalCents).toBe(1_500);
    expect(jsonParsed.lineItems[0]?.description).toBe('R2 Storage');
  });

  it('reconciles exact receipts, flags mismatches and missing receipts, and redacts PAN/CVC from exports', async () => {
    let clock = new Date('2026-11-21T08:00:00.000Z');
    const instance = createApp({
      databasePath: ':memory:',
      now: () => clock
    });

    try {
      instance.policyEngine.createAgent({
        id: 'agt_rcpt',
        name: 'Receipt Agent',
        totalBudgetCents: 100_000,
        maxPerTransactionCents: 20_000,
        approvalThresholdCents: 20_000,
        dailyLimitCents: 100_000,
        monthlyLimitCents: 100_000,
        policyMode: 'open'
      });

      // 1. Exact text receipt match
      const s1 = await instance.policyEngine.requestSpend({
        agentId: 'agt_rcpt',
        vendor: 'api.openai.com',
        amountCents: 2_700,
        purpose: 'OpenAI batch'
      });
      instance.policyEngine.simulateCharge({
        paymentToken: s1.card!.paymentToken,
        merchantVendor: 'api.openai.com',
        amountCents: 2_700
      });
      const rec1 = instance.reconciler.ingestReceipt({
        contentType: 'text',
        content: `Merchant: OpenAI\nDomain: api.openai.com\nCard: **** ${s1.card!.last4}\n1 x Tokens  $27.00\nTotal: $27.00`
      });
      expect(rec1.receipt.matchStatus).toBe('matched');
      expect(instance.policyEngine.getAuthorizationView(s1.authorization.id).status).toBe(
        'reconciled'
      );

      // 2. HTML receipt mismatch (+$4.50 tax added after auth)
      const s2 = await instance.policyEngine.requestSpend({
        agentId: 'agt_rcpt',
        vendor: 'anthropic.com',
        amountCents: 5_000,
        purpose: 'Claude credits'
      });
      instance.policyEngine.simulateCharge({
        paymentToken: s2.card!.paymentToken,
        merchantVendor: 'anthropic.com',
        amountCents: 5_000
      });
      const rec2 = instance.reconciler.ingestReceipt({
        contentType: 'html',
        content: `<html><body><h1>Anthropic</h1><p>${s2.authorization.id}</p><table><tr><td>Subtotal</td><td>$50.00</td></tr><tr><td>Tax</td><td>$4.50</td></tr><tr><td>Total</td><td>$54.50</td></tr></table></body></html>`
      });
      expect(rec2.receipt.matchStatus).toBe('mismatch');
      expect(rec2.receipt.discrepancyCents).toBe(450);
      expect(instance.policyEngine.getAuthorizationView(s2.authorization.id).receiptStatus).toBe(
        'mismatch'
      );

      // 3. Settled spend with missing receipt -> flagged after 90 mins
      const s3 = await instance.policyEngine.requestSpend({
        agentId: 'agt_rcpt',
        vendor: 'neon.tech',
        amountCents: 3_500,
        purpose: 'Neon DB compute'
      });
      instance.policyEngine.simulateCharge({
        paymentToken: s3.card!.paymentToken,
        merchantVendor: 'neon.tech',
        amountCents: 3_500
      });

      clock = new Date(clock.getTime() + 90 * 60 * 1000);
      const audit = instance.reconciler.auditMissingReceipts({ olderThanMinutes: 60 });
      expect(audit.flaggedCount).toBe(1);
      expect(audit.flaggedAuthorizationIds).toContain(s3.authorization.id);
      expect(instance.policyEngine.getAuthorizationView(s3.authorization.id).receiptStatus).toBe(
        'missing_flagged'
      );

      // 4. Ledger export redacts full PAN and CVC
      const views = instance.policyEngine.listAuthorizations();
      const csv = exportLedgerCsv(views);
      const json = exportLedgerJson(views);

      expect(csv).toContain(s1.card!.last4);
      expect(csv).not.toContain(s1.card!.pan);
      expect(csv).not.toContain(s2.card!.pan);
      expect(json).not.toContain(s1.card!.pan);
      expect(json).toContain('"discrepancyCents": 450');
    } finally {
      instance.close();
    }
  });
});

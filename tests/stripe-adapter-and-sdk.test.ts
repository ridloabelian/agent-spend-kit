import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { describe, expect, it } from 'vitest';
import { AgentSpendClient } from '@agent-spend-kit/sdk';
import { createApp, StripeIssuingCardProvider } from '@agent-spend-kit/server';

describe('Stripe Issuing adapter & AgentSpendClient SDK', () => {
  it('issues virtual cards and verifies signed webhooks via StripeIssuingCardProvider', async () => {
    const fetchCalls: Array<{ url: string; method: string; body?: string }> = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined
      });

      if (url.endsWith('/v1/issuing/cards') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'ic_test_stripe_1',
            brand: 'Visa',
            last4: '9911',
            exp_month: 11,
            exp_year: 2029,
            status: 'active'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/v1/issuing/cards/ic_test_stripe_1?expand')) {
        return new Response(
          JSON.stringify({
            id: 'ic_test_stripe_1',
            brand: 'Visa',
            last4: '9911',
            exp_month: 11,
            exp_year: 2029,
            number: '4242424242429911',
            cvc: '842',
            status: 'active'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ id: 'ic_test_stripe_1', status: 'canceled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const webhookSecret = 'whsec_test_secret_123';
    const provider = new StripeIssuingCardProvider({
      secretKey: 'sk_test_fake_123',
      cardholderId: 'ich_test_123',
      webhookSecret,
      fetchImpl: mockFetch
    });

    const instance = createApp({
      databasePath: ':memory:',
      cardProvider: provider
    });

    try {
      instance.policyEngine.createAgent({
        id: 'agt_stripe',
        name: 'Stripe Issuing Agent',
        totalBudgetCents: 50_000,
        maxPerTransactionCents: 10_000,
        approvalThresholdCents: 10_000,
        dailyLimitCents: 50_000,
        monthlyLimitCents: 50_000,
        policyMode: 'open'
      });

      const spend = await instance.policyEngine.requestSpend({
        agentId: 'agt_stripe',
        vendor: 'api.openai.com',
        amountCents: 4_200,
        purpose: 'Stripe Issuing virtual card test'
      });

      expect(spend.approved).toBe(true);
      expect(spend.card?.provider).toBe('stripe_issuing');
      expect(spend.card?.providerCardId).toBe('ic_test_stripe_1');
      expect(spend.card?.pan).toBe('4242424242429911');
      expect(spend.card?.cvc).toBe('842');
      const sentForm = new URLSearchParams(fetchCalls[0]?.body ?? '');
      expect(sentForm.get('spending_controls[spending_limits][0][interval]')).toBe(
        'per_authorization'
      );
      expect(sentForm.get('spending_controls[spending_limits][0][amount]')).toBe('4200');

      // Send signed Stripe Issuing settlement webhook
      const payload = JSON.stringify({
        type: 'issuing_transaction.created',
        data: {
          object: {
            id: 'ipi_1',
            card: 'ic_test_stripe_1',
            amount: -4200,
            metadata: { authorizationId: spend.authorization.id }
          }
        }
      });
      const timestamp = '1763700000';
      const sig = crypto
        .createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${payload}`)
        .digest('hex');

      const webhookRes = await instance.app.request('/api/webhooks/stripe-issuing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': `t=${timestamp},v1=${sig}`
        },
        body: payload
      });
      expect(webhookRes.status).toBe(200);
      const webhookData = (await webhookRes.json()) as {
        received: boolean;
        authorization: { status: string; settledAmountCents: number };
      };
      expect(webhookData.received).toBe(true);
      expect(webhookData.authorization.status).toBe('settled');
      expect(webhookData.authorization.settledAmountCents).toBe(4_200);

      // Invalid webhook signature is rejected
      const badWebhookRes = await instance.app.request('/api/webhooks/stripe-issuing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': `t=${timestamp},v1=0000`
        },
        body: payload
      });
      expect(badWebhookRes.status).toBe(500);
    } finally {
      instance.close();
    }
  });

  it('drives full lifecycle over HTTP using @agent-spend-kit/sdk including waitForApproval', async () => {
    const instance = createApp({ databasePath: ':memory:' });
    let baseUrl = '';
    let httpServer: ReturnType<typeof serve> | null = null;

    await new Promise<void>((resolve) => {
      httpServer = serve(
        {
          fetch: instance.app.fetch,
          port: 0,
          hostname: '127.0.0.1'
        },
        (info: AddressInfo) => {
          baseUrl = `http://127.0.0.1:${info.port}`;
          resolve();
        }
      );
    });

    try {
      const sdk = new AgentSpendClient({ baseUrl });
      const health = await sdk.health();
      expect(health.ok).toBe(true);

      await sdk.createAgent({
        id: 'agt_sdk_e2e',
        name: 'SDK E2E Agent',
        totalBudgetCents: 30_000,
        maxPerTransactionCents: 15_000,
        approvalThresholdCents: 3_000,
        dailyLimitCents: 30_000,
        monthlyLimitCents: 30_000,
        policyMode: 'allowlist',
        allowedVendors: ['vercel.com']
      });

      const escalated = await sdk.requestSpend({
        agentId: 'agt_sdk_e2e',
        vendor: 'vercel.com',
        amountCents: 8_000,
        purpose: 'Pro team seat upgrade'
      });
      expect(escalated.escalated).toBe(true);

      // Approve slightly later while agent polls waitForApproval()
      setTimeout(() => {
        void sdk.approveAuthorization(escalated.authorization.id, 'lead-ops', 'Approved');
      }, 150);

      const waited = await sdk.waitForApproval(escalated.authorization.id, {
        pollIntervalMs: 50,
        timeoutMs: 5000
      });
      expect(waited.card).toBeDefined();

      await sdk.simulateCharge({
        paymentToken: waited.card!.paymentToken,
        merchantVendor: 'vercel.com',
        amountCents: 8_000
      });

      const receiptRes = await sdk.submitReceipt({
        contentType: 'json',
        content: {
          merchant: 'Vercel Inc',
          merchantDomain: 'vercel.com',
          authorizationId: escalated.authorization.id,
          subtotal: '80.00',
          tax: '0.00',
          total: '80.00'
        }
      });
      expect(receiptRes.receipt.matchStatus).toBe('matched');

      const csv = await sdk.exportLedger('csv');
      expect(csv).toContain('vercel.com');
      expect(csv).toContain('reconciled');
    } finally {
      if (httpServer) {
        await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
      }
      instance.close();
    }
  });
});

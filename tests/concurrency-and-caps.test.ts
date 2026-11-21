import { describe, expect, it } from 'vitest';
import { createApp, isValidLuhn } from '@agent-spend-kit/server';

describe('Concurrency, double-spend prevention, single-use cards & approvals', () => {
  it('prevents budget overdraft under concurrent Promise.all spend requests', async () => {
    const instance = createApp({ databasePath: ':memory:' });
    try {
      const agent = instance.policyEngine.createAgent({
        id: 'agt_race',
        name: 'Race Condition Test Agent',
        totalBudgetCents: 10_000, // $100.00
        maxPerTransactionCents: 5_000,
        approvalThresholdCents: 5_000,
        dailyLimitCents: 10_000,
        monthlyLimitCents: 10_000,
        maxTxPerHour: 25,
        policyMode: 'allowlist',
        allowedVendors: ['api.openai.com'],
        autoFreezeOnAnomaly: false
      });

      const requests = Array.from({ length: 10 }, (_, idx) =>
        instance.app.request('/api/spend/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: agent.id,
            vendor: 'https://api.openai.com/v1/responses',
            amountCents: 2_500, // $25.00 each -> at most 4 can pass
            category: 'llm_api',
            purpose: `Concurrent batch #${idx}`
          })
        })
      );

      const responses = await Promise.all(requests);
      const bodies = (await Promise.all(responses.map((r) => r.json()))) as Array<{
        approved: boolean;
        decisionCode: string;
        card?: { pan: string; cvc: string; paymentToken: string };
      }>;

      const approved = bodies.filter((b) => b.approved);
      const rejected = bodies.filter((b) => !b.approved);

      expect(approved).toHaveLength(4);
      expect(rejected).toHaveLength(6);
      for (const r of rejected) {
        expect(r.decisionCode).toBe('TOTAL_BUDGET_EXCEEDED');
      }
      for (const a of approved) {
        expect(a.card).toBeDefined();
        expect(isValidLuhn(a.card!.pan)).toBe(true);
      }

      const refreshed = instance.policyEngine.getAgent(agent.id);
      expect(refreshed.metrics.committedTotalCents).toBe(10_000);
      expect(refreshed.metrics.remainingTotalCents).toBe(0);
    } finally {
      instance.close();
    }
  });

  it('deduplicates concurrent requests sharing an idempotencyKey', async () => {
    const instance = createApp({ databasePath: ':memory:' });
    try {
      instance.policyEngine.createAgent({
        id: 'agt_idem',
        name: 'Idempotency Agent',
        totalBudgetCents: 10_000,
        maxPerTransactionCents: 5_000,
        approvalThresholdCents: 5_000,
        dailyLimitCents: 10_000,
        monthlyLimitCents: 10_000,
        policyMode: 'open'
      });

      const calls = Array.from({ length: 5 }, () =>
        instance.policyEngine.requestSpend({
          agentId: 'agt_idem',
          vendor: 'anthropic.com',
          amountCents: 3_000,
          purpose: 'Deduplicated API credit purchase',
          idempotencyKey: 'idem-fixed-key-1'
        })
      );

      const results = await Promise.all(calls);
      const uniqueAuthIds = new Set(results.map((r) => r.authorization.id));
      expect(uniqueAuthIds.size).toBe(1);
      expect(results.every((r) => r.approved)).toBe(true);

      const agent = instance.policyEngine.getAgent('agt_idem');
      expect(agent.metrics.committedTotalCents).toBe(3_000);
    } finally {
      instance.close();
    }
  });

  it('enforces single-use virtual card lock, merchant lock, and card limit', async () => {
    const instance = createApp({ databasePath: ':memory:' });
    try {
      instance.policyEngine.createAgent({
        id: 'agt_card_lock',
        name: 'Card Lock Agent',
        totalBudgetCents: 20_000,
        maxPerTransactionCents: 10_000,
        approvalThresholdCents: 10_000,
        dailyLimitCents: 20_000,
        monthlyLimitCents: 20_000,
        policyMode: 'open'
      });

      const spend = await instance.policyEngine.requestSpend({
        agentId: 'agt_card_lock',
        vendor: 'https://api.openai.com/v1',
        amountCents: 2_000,
        purpose: 'Token top-up'
      });
      const token = spend.card!.paymentToken;

      // Mismatched merchant fails
      await expect(
        Promise.resolve().then(() =>
          instance.policyEngine.simulateCharge({
            paymentToken: token,
            merchantVendor: 'evil-merchant.com',
            amountCents: 2_000
          })
        )
      ).rejects.toMatchObject({ code: 'MERCHANT_LOCK_MISMATCH' });

      // Over card limit fails
      await expect(
        Promise.resolve().then(() =>
          instance.policyEngine.simulateCharge({
            paymentToken: token,
            merchantVendor: 'api.openai.com',
            amountCents: 2_500
          })
        )
      ).rejects.toMatchObject({ code: 'CARD_LIMIT_EXCEEDED' });

      // Valid charge settles once
      const settled = instance.policyEngine.simulateCharge({
        paymentToken: token,
        merchantVendor: 'api.openai.com',
        amountCents: 2_000
      });
      expect(settled.settled).toBe(true);
      expect(settled.card.status).toBe('used');

      // Second charge on same single-use token is rejected
      await expect(
        Promise.resolve().then(() =>
          instance.policyEngine.simulateCharge({
            paymentToken: token,
            merchantVendor: 'api.openai.com',
            amountCents: 100
          })
        )
      ).rejects.toMatchObject({ code: 'SINGLE_USE_CARD_EXHAUSTED' });
    } finally {
      instance.close();
    }
  });

  it('escalates over threshold, allows one-time card claim after approval, and releases voided budget', async () => {
    const instance = createApp({ databasePath: ':memory:' });
    try {
      instance.policyEngine.createAgent({
        id: 'agt_esc',
        name: 'Escalation Agent',
        totalBudgetCents: 20_000,
        maxPerTransactionCents: 15_000,
        approvalThresholdCents: 4_000,
        dailyLimitCents: 20_000,
        monthlyLimitCents: 20_000,
        policyMode: 'open'
      });

      const escalated = await instance.policyEngine.requestSpend({
        agentId: 'agt_esc',
        vendor: 'aws.amazon.com',
        amountCents: 10_000,
        purpose: 'GPU instance block'
      });

      expect(escalated.approved).toBe(false);
      expect(escalated.escalated).toBe(true);
      expect(escalated.status).toBe('pending_approval');
      expect(escalated.card).toBeUndefined();

      // Budget is reserved while pending approval
      expect(instance.policyEngine.getAgent('agt_esc').metrics.remainingTotalCents).toBe(10_000);

      // Operator approves
      const approvedView = await instance.policyEngine.approveAuthorization(
        escalated.authorization.id,
        'alice',
        'Looks good'
      );
      expect(approvedView.status).toBe('approved');

      // One-time card claim succeeds once, fails second time
      const claimed = instance.policyEngine.claimApprovedCard(escalated.authorization.id);
      expect(isValidLuhn(claimed.card.pan)).toBe(true);
      expect(claimed.card.cvc).toMatch(/^\d{3}$/);

      expect(() => instance.policyEngine.claimApprovedCard(escalated.authorization.id)).toThrow(
        /already been claimed/i
      );

      // Voiding returns budget
      await instance.policyEngine.voidAuthorization(escalated.authorization.id, 'No longer needed');
      expect(instance.policyEngine.getAgent('agt_esc').metrics.remainingTotalCents).toBe(20_000);
    } finally {
      instance.close();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createApp } from '@agent-spend-kit/server';

describe('Velocity caps and anomaly auto-freeze', () => {
  it('enforces hourly tx count, 24h daily cap, and 30d monthly cap over rolling time windows', async () => {
    let currentTime = new Date('2026-11-21T10:00:00.000Z');
    const instance = createApp({
      databasePath: ':memory:',
      now: () => currentTime
    });

    try {
      instance.policyEngine.createAgent({
        id: 'agt_vel',
        name: 'Velocity Test Agent',
        totalBudgetCents: 50_000,
        maxPerTransactionCents: 5_000,
        approvalThresholdCents: 5_000,
        dailyLimitCents: 6_000, // $60 / 24h
        monthlyLimitCents: 10_000, // $100 / 30d
        maxTxPerHour: 2,
        policyMode: 'open',
        autoFreezeOnAnomaly: false
      });

      // Tx 1 & 2 succeed within 1h and $60 daily cap ($25 + $25 = $50)
      const tx1 = await instance.policyEngine.requestSpend({
        agentId: 'agt_vel',
        vendor: 'openai.com',
        amountCents: 2_500,
        purpose: 'Call 1'
      });
      const tx2 = await instance.policyEngine.requestSpend({
        agentId: 'agt_vel',
        vendor: 'openai.com',
        amountCents: 2_500,
        purpose: 'Call 2'
      });
      expect(tx1.approved).toBe(true);
      expect(tx2.approved).toBe(true);

      // Tx 3 in same hour hits HOURLY_VELOCITY_EXCEEDED even for $5
      const tx3 = await instance.policyEngine.requestSpend({
        agentId: 'agt_vel',
        vendor: 'openai.com',
        amountCents: 500,
        purpose: 'Call 3 too fast'
      });
      expect(tx3.approved).toBe(false);
      expect(tx3.decisionCode).toBe('HOURLY_VELOCITY_EXCEEDED');

      // Advance 61 minutes -> hourly window resets, but 24h daily limit only has $10 left
      currentTime = new Date(currentTime.getTime() + 61 * 60 * 1000);
      const tx4OverDaily = await instance.policyEngine.requestSpend({
        agentId: 'agt_vel',
        vendor: 'openai.com',
        amountCents: 2_000,
        purpose: 'Exceeds daily remaining $10'
      });
      expect(tx4OverDaily.approved).toBe(false);
      expect(tx4OverDaily.decisionCode).toBe('DAILY_LIMIT_EXCEEDED');

      // Spend remaining $10 daily
      const tx4Ok = await instance.policyEngine.requestSpend({
        agentId: 'agt_vel',
        vendor: 'openai.com',
        amountCents: 1_000,
        purpose: 'Use remaining daily $10'
      });
      expect(tx4Ok.approved).toBe(true);

      // Advance 25 hours -> daily limit resets ($60/day available), monthly has $40 left ($100 - $60)
      currentTime = new Date(currentTime.getTime() + 25 * 60 * 60 * 1000);
      const tx5Ok = await instance.policyEngine.requestSpend({
        agentId: 'agt_vel',
        vendor: 'openai.com',
        amountCents: 4_000,
        purpose: 'Spend remaining $40 monthly'
      });
      expect(tx5Ok.approved).toBe(true);

      const tx6OverMonthly = await instance.policyEngine.requestSpend({
        agentId: 'agt_vel',
        vendor: 'openai.com',
        amountCents: 500,
        purpose: 'Exceeds 30d monthly $100'
      });
      expect(tx6OverMonthly.approved).toBe(false);
      expect(tx6OverMonthly.decisionCode).toBe('MONTHLY_LIMIT_EXCEEDED');
    } finally {
      instance.close();
    }
  });

  it('auto-freezes wallet on repeated policy blocks and allows operator unfreeze reset', async () => {
    const instance = createApp({ databasePath: ':memory:' });
    try {
      instance.policyEngine.createAgent({
        id: 'agt_anom',
        name: 'Anomaly Agent',
        totalBudgetCents: 50_000,
        maxPerTransactionCents: 5_000,
        approvalThresholdCents: 5_000,
        dailyLimitCents: 20_000,
        monthlyLimitCents: 40_000,
        policyMode: 'allowlist',
        allowedVendors: ['api.openai.com'],
        autoFreezeOnAnomaly: true,
        anomalyMaxConsecutiveBlocks: 3
      });

      const b1 = await instance.policyEngine.requestSpend({
        agentId: 'agt_anom',
        vendor: 'blocked1.example',
        amountCents: 1_000,
        purpose: 'Test 1'
      });
      const b2 = await instance.policyEngine.requestSpend({
        agentId: 'agt_anom',
        vendor: 'blocked2.example',
        amountCents: 1_000,
        purpose: 'Test 2'
      });
      expect(b1.walletFrozen).toBe(false);
      expect(b2.walletFrozen).toBe(false);

      // 3rd consecutive block triggers auto-freeze
      const b3 = await instance.policyEngine.requestSpend({
        agentId: 'agt_anom',
        vendor: 'blocked3.example',
        amountCents: 1_000,
        purpose: 'Test 3'
      });
      expect(b3.walletFrozen).toBe(true);
      expect(instance.policyEngine.getAgent('agt_anom').status).toBe('frozen');

      // Legitimate vendor is now blocked because wallet is frozen
      const validWhileFrozen = await instance.policyEngine.requestSpend({
        agentId: 'agt_anom',
        vendor: 'api.openai.com',
        amountCents: 1_000,
        purpose: 'Legit call while frozen'
      });
      expect(validWhileFrozen.approved).toBe(false);
      expect(validWhileFrozen.decisionCode).toBe('WALLET_FROZEN');

      // Operator unfreezes and resets consecutive block counter
      instance.policyEngine.unfreezeAgent('agt_anom');
      const okAfterUnfreeze = await instance.policyEngine.requestSpend({
        agentId: 'agt_anom',
        vendor: 'api.openai.com',
        amountCents: 1_000,
        purpose: 'Legit call after unfreeze'
      });
      expect(okAfterUnfreeze.approved).toBe(true);
    } finally {
      instance.close();
    }
  });

  it('auto-freezes wallet immediately on extreme spend spike anomaly', async () => {
    const instance = createApp({ databasePath: ':memory:' });
    try {
      instance.policyEngine.createAgent({
        id: 'agt_spike',
        name: 'Spike Agent',
        totalBudgetCents: 100_000,
        maxPerTransactionCents: 5_000, // $50 max per tx
        approvalThresholdCents: 5_000,
        dailyLimitCents: 50_000,
        monthlyLimitCents: 100_000,
        policyMode: 'open',
        autoFreezeOnAnomaly: true,
        anomalySpikeMultiplier: 3.0 // >= $150 triggers spike freeze
      });

      const spike = await instance.policyEngine.requestSpend({
        agentId: 'agt_spike',
        vendor: 'api.openai.com',
        amountCents: 20_000, // $200 >= 3x $50
        purpose: 'Runaway loop request'
      });

      expect(spike.approved).toBe(false);
      expect(spike.decisionCode).toBe('ANOMALY_AMOUNT_SPIKE');
      expect(spike.walletFrozen).toBe(true);
      expect(instance.policyEngine.getAgent('agt_spike').status).toBe('frozen');
    } finally {
      instance.close();
    }
  });
});

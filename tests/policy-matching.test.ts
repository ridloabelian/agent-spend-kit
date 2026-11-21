import { describe, expect, it } from 'vitest';
import { createApp, matchesVendorPattern, normalizeVendor } from '@agent-spend-kit/server';

describe('Vendor, URL, wildcard, and category policy matching', () => {
  it('normalizes URLs and matches exact, parent, and wildcard domains safely', () => {
    expect(normalizeVendor('https://www.api.openai.com/v1/chat').domain).toBe('api.openai.com');

    expect(matchesVendorPattern('https://api.openai.com/v1', 'api.openai.com')).toBe(true);
    expect(matchesVendorPattern('https://api.openai.com/v1', 'openai.com')).toBe(true);
    expect(matchesVendorPattern('https://api.openai.com/v1', '*.openai.com')).toBe(true);
    expect(matchesVendorPattern('openai.com', '*.openai.com')).toBe(true);

    // Reject lookalike / sibling subdomains when exact subdomain is specified
    expect(matchesVendorPattern('https://evil-openai.com/pay', 'openai.com')).toBe(false);
    expect(matchesVendorPattern('https://billing.stripe.com/pay', 'api.stripe.com')).toBe(false);
    expect(matchesVendorPattern('Fake OpenAI', 'openai.com')).toBe(false);
  });

  it('enforces allowlist, blocklist, and category rules in policy engine', async () => {
    const instance = createApp({ databasePath: ':memory:' });
    try {
      instance.policyEngine.createAgent({
        id: 'agt_policy',
        name: 'Policy Agent',
        totalBudgetCents: 50_000,
        maxPerTransactionCents: 10_000,
        approvalThresholdCents: 10_000,
        dailyLimitCents: 50_000,
        monthlyLimitCents: 50_000,
        policyMode: 'allowlist',
        allowedVendors: ['*.cloudflare.com', 'api.openai.com'],
        blockedVendors: ['bad.cloudflare.com'],
        allowedCategories: ['infrastructure', 'llm_api'],
        blockedCategories: ['gambling'],
        autoFreezeOnAnomaly: false
      });

      // Blocked vendor takes precedence over wildcard allowlist
      const blockedSubdomain = await instance.policyEngine.requestSpend({
        agentId: 'agt_policy',
        vendor: 'https://bad.cloudflare.com/checkout',
        amountCents: 1_000,
        category: 'infrastructure',
        purpose: 'Should fail on explicit blocklist'
      });
      expect(blockedSubdomain.approved).toBe(false);
      expect(blockedSubdomain.decisionCode).toBe('VENDOR_BLOCKED');

      // Allowed wildcard domain passes
      const allowedSubdomain = await instance.policyEngine.requestSpend({
        agentId: 'agt_policy',
        vendor: 'https://workers.cloudflare.com/billing',
        amountCents: 1_500,
        category: 'infrastructure',
        purpose: 'Workers usage'
      });
      expect(allowedSubdomain.approved).toBe(true);

      // Disallowed category fails even on allowed vendor
      const badCategory = await instance.policyEngine.requestSpend({
        agentId: 'agt_policy',
        vendor: 'api.openai.com',
        amountCents: 1_000,
        category: 'hardware',
        purpose: 'Invalid category'
      });
      expect(badCategory.approved).toBe(false);
      expect(badCategory.decisionCode).toBe('CATEGORY_NOT_ALLOWED');
    } finally {
      instance.close();
    }
  });
});

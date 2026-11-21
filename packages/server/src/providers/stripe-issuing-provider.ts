import crypto from 'node:crypto';
import type {
  CardProvider,
  IssueCardParams,
  IssuedCardCredentials,
  ParsedProviderWebhook,
  ProviderCardStatus
} from './types.js';
import { formatMaskedPan } from './luhn.js';

export interface StripeIssuingProviderOptions {
  secretKey: string;
  cardholderId: string;
  webhookSecret?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface StripeCardApiResponse {
  id: string;
  brand?: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  number?: string;
  cvc?: string;
  status: string;
  spending_controls?: {
    spending_limits?: Array<{ amount: number; interval: string }>;
  };
}

export class StripeIssuingCardProvider implements CardProvider {
  readonly name = 'stripe_issuing' as const;
  private readonly secretKey: string;
  private readonly cardholderId: string;
  private readonly webhookSecret?: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: StripeIssuingProviderOptions) {
    if (!options.secretKey) {
      throw new Error('StripeIssuingCardProvider requires secretKey');
    }
    if (!options.cardholderId) {
      throw new Error('StripeIssuingCardProvider requires cardholderId');
    }
    this.secretKey = options.secretKey;
    this.cardholderId = options.cardholderId;
    this.webhookSecret = options.webhookSecret;
    this.apiBaseUrl = (options.apiBaseUrl ?? 'https://api.stripe.com').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async stripeRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    formParams?: URLSearchParams
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`
    };
    if (formParams) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const res = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method,
      headers,
      body: formParams ? formParams.toString() : undefined
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const stripeErr = data.error as { message?: string } | undefined;
      throw new Error(
        `Stripe Issuing API error (${res.status}): ${stripeErr?.message ?? JSON.stringify(data)}`
      );
    }

    return data as unknown as T;
  }

  async issueSingleUseCard(params: IssueCardParams): Promise<IssuedCardCredentials> {
    const form = new URLSearchParams();
    form.set('cardholder', this.cardholderId);
    form.set('currency', params.currency.toLowerCase());
    form.set('type', 'virtual');
    form.set('status', 'active');
    form.set('spending_controls[spending_limits][0][amount]', String(params.spendingLimitCents));
    form.set('spending_controls[spending_limits][0][interval]', 'per_authorization');
    form.set('metadata[authorizationId]', params.authorizationId);
    form.set('metadata[agentId]', params.agentId);
    form.set('metadata[lockedVendorDomain]', params.lockedVendorDomain);

    const created = await this.stripeRequest<StripeCardApiResponse>(
      'POST',
      '/v1/issuing/cards',
      form
    );

    let cardWithSecret = created;
    if (!created.number || !created.cvc) {
      cardWithSecret = await this.stripeRequest<StripeCardApiResponse>(
        'GET',
        `/v1/issuing/cards/${encodeURIComponent(created.id)}?expand[]=number&expand[]=cvc`
      );
    }

    const pan = cardWithSecret.number ?? `424242******${cardWithSecret.last4}`;
    const cvc = cardWithSecret.cvc ?? '000';

    return {
      provider: 'stripe_issuing',
      providerCardId: created.id,
      paymentToken: `ask_stripe_${created.id}`,
      brand: created.brand ?? 'Visa',
      last4: created.last4,
      maskedPan: cardWithSecret.number
        ? formatMaskedPan(cardWithSecret.number)
        : `4242-42XX-XXXX-${created.last4}`,
      pan,
      cvc,
      expMonth: created.exp_month,
      expYear: created.exp_year
    };
  }

  async voidCard(providerCardId: string): Promise<void> {
    const form = new URLSearchParams();
    form.set('status', 'canceled');
    await this.stripeRequest('POST', `/v1/issuing/cards/${encodeURIComponent(providerCardId)}`, form);
  }

  async getCardStatus(providerCardId: string): Promise<ProviderCardStatus> {
    const card = await this.stripeRequest<StripeCardApiResponse>(
      'GET',
      `/v1/issuing/cards/${encodeURIComponent(providerCardId)}`
    );
    const limit = card.spending_controls?.spending_limits?.[0]?.amount ?? 0;
    const mappedStatus =
      card.status === 'canceled'
        ? 'voided'
        : card.status === 'inactive'
          ? 'expired'
          : 'active';

    return {
      providerCardId: card.id,
      status: mappedStatus,
      spendingLimitCents: limit,
      spentCents: 0
    };
  }

  parseWebhook(rawBody: string, signatureHeader?: string): ParsedProviderWebhook {
    if (this.webhookSecret) {
      if (!signatureHeader) {
        throw new Error('Missing Stripe-Signature header');
      }
      this.verifyStripeSignature(rawBody, signatureHeader, this.webhookSecret);
    }

    const event = JSON.parse(rawBody) as {
      type: string;
      data?: { object?: Record<string, unknown> };
    };
    const obj = event.data?.object ?? {};
    const metadata = (obj.metadata as Record<string, unknown> | undefined) ?? {};
    const merchantData = (obj.merchant_data as Record<string, unknown> | undefined) ?? {};
    const cardObj = obj.card;
    const providerCardId =
      typeof cardObj === 'string'
        ? cardObj
        : cardObj && typeof cardObj === 'object'
          ? String((cardObj as Record<string, unknown>).id ?? '')
          : undefined;

    const rawAmount = typeof obj.amount === 'number' ? Math.abs(obj.amount) : undefined;
    const authorizationId =
      typeof metadata.authorizationId === 'string' ? metadata.authorizationId : undefined;

    return {
      eventType: event.type,
      authorizationId,
      providerCardId: providerCardId || undefined,
      amountCents: rawAmount,
      merchantName:
        typeof merchantData.name === 'string' ? merchantData.name : undefined,
      merchantDomain:
        typeof merchantData.url === 'string' ? merchantData.url : undefined,
      settled:
        event.type === 'issuing_transaction.created' ||
        event.type === 'issuing_authorization.updated',
      rawEvent: event as unknown as Record<string, unknown>
    };
  }

  private verifyStripeSignature(payload: string, header: string, secret: string): void {
    const parts = header.split(',').map((p) => p.trim());
    let timestamp = '';
    const signatures: string[] = [];

    for (const part of parts) {
      const [k, v] = part.split('=');
      if (k === 't' && v) timestamp = v;
      if (k === 'v1' && v) signatures.push(v);
    }

    if (!timestamp || signatures.length === 0) {
      throw new Error('Malformed Stripe-Signature header');
    }

    const expectedHex = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');

    const matched = signatures.some((sig) => {
      try {
        const sigBuf = Buffer.from(sig, 'hex');
        return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
      } catch {
        return false;
      }
    });

    if (!matched) {
      throw new Error('Invalid Stripe webhook signature');
    }
  }
}

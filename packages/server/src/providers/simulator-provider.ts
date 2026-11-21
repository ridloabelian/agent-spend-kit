import crypto from 'node:crypto';
import { formatMaskedPan, generateLuhnNumber } from './luhn.js';
import type {
  CardProvider,
  IssueCardParams,
  IssuedCardCredentials,
  ProviderCardStatus
} from './types.js';

export interface SimulatorCardProviderOptions {
  secret?: string;
  binPrefix?: string;
  now?: () => Date;
}

interface SimulatedCardEntry {
  providerCardId: string;
  status: 'active' | 'used' | 'voided' | 'expired';
  spendingLimitCents: number;
  spentCents: number;
}

export class SimulatorCardProvider implements CardProvider {
  readonly name = 'simulator' as const;
  private readonly secret: string;
  private readonly binPrefix: string;
  private readonly now: () => Date;
  private readonly cards = new Map<string, SimulatedCardEntry>();

  constructor(options?: SimulatorCardProviderOptions) {
    this.secret =
      options?.secret ??
      process.env.SIMULATOR_SECRET ??
      'ask-local-dev-simulator-secret-change-me';
    this.binPrefix = options?.binPrefix ?? '424242';
    this.now = options?.now ?? (() => new Date());
  }

  deriveCredentials(
    authorizationId: string,
    expiresAt?: Date
  ): { pan: string; cvc: string; expMonth: number; expYear: number } {
    const digest = crypto.createHmac('sha256', this.secret).update(authorizationId).digest();

    let bodyDigits = '';
    for (let i = 0; i < 9; i++) {
      const byte = digest[i] ?? 0;
      bodyDigits += String(byte % 10);
    }

    const pan = generateLuhnNumber(this.binPrefix, bodyDigits, 16);
    const cvcSeed = (((digest[9] ?? 0) << 8) | (digest[10] ?? 0)) % 900;
    const cvc = String(100 + cvcSeed);

    const expBase = expiresAt ?? new Date(this.now().getTime() + 30 * 24 * 60 * 60 * 1000);
    const futureExp = new Date(expBase.getTime() + 365 * 24 * 60 * 60 * 1000);
    const expMonth = futureExp.getUTCMonth() + 1;
    const expYear = futureExp.getUTCFullYear();

    return { pan, cvc, expMonth, expYear };
  }

  async issueSingleUseCard(params: IssueCardParams): Promise<IssuedCardCredentials> {
    const { pan, cvc, expMonth, expYear } = this.deriveCredentials(
      params.authorizationId,
      params.expiresAt
    );

    const tokenDigest = crypto
      .createHmac('sha256', this.secret)
      .update(`token:${params.authorizationId}`)
      .digest('hex');

    const providerCardId = `sim_ic_${tokenDigest.slice(0, 16)}`;
    const paymentToken = `ask_tok_${tokenDigest.slice(16, 40)}`;
    const last4 = pan.slice(-4);
    const maskedPan = formatMaskedPan(pan);

    this.cards.set(providerCardId, {
      providerCardId,
      status: 'active',
      spendingLimitCents: params.spendingLimitCents,
      spentCents: 0
    });

    return {
      provider: 'simulator',
      providerCardId,
      paymentToken,
      brand: 'Visa',
      last4,
      maskedPan,
      pan,
      cvc,
      expMonth,
      expYear
    };
  }

  async voidCard(providerCardId: string): Promise<void> {
    const entry = this.cards.get(providerCardId);
    if (entry) {
      entry.status = 'voided';
    }
  }

  async getCardStatus(providerCardId: string): Promise<ProviderCardStatus> {
    const entry = this.cards.get(providerCardId);
    if (!entry) {
      return {
        providerCardId,
        status: 'active',
        spendingLimitCents: 0,
        spentCents: 0
      };
    }
    return { ...entry };
  }
}

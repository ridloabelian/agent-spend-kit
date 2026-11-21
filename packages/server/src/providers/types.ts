export interface IssueCardParams {
  authorizationId: string;
  agentId: string;
  spendingLimitCents: number;
  currency: string;
  lockedVendorDomain: string;
  expiresAt: Date;
  singleUse?: boolean;
}

export interface IssuedCardCredentials {
  provider: 'simulator' | 'stripe_issuing';
  providerCardId: string;
  paymentToken: string;
  brand: string;
  last4: string;
  maskedPan: string;
  pan: string;
  cvc: string;
  expMonth: number;
  expYear: number;
}

export interface ProviderCardStatus {
  providerCardId: string;
  status: 'active' | 'used' | 'voided' | 'expired';
  spendingLimitCents: number;
  spentCents: number;
}

export interface ParsedProviderWebhook {
  eventType: string;
  authorizationId?: string;
  providerCardId?: string;
  amountCents?: number;
  merchantName?: string;
  merchantDomain?: string;
  settled: boolean;
  rawEvent: Record<string, unknown>;
}

export interface CardProvider {
  readonly name: 'simulator' | 'stripe_issuing';
  issueSingleUseCard(params: IssueCardParams): Promise<IssuedCardCredentials>;
  voidCard(providerCardId: string): Promise<void>;
  getCardStatus(providerCardId: string): Promise<ProviderCardStatus>;
  deriveCredentials?(authorizationId: string, expiresAt: Date): {
    pan: string;
    cvc: string;
    expMonth: number;
    expYear: number;
  } | null;
  parseWebhook?(rawBody: string, signatureHeader?: string): ParsedProviderWebhook;
}

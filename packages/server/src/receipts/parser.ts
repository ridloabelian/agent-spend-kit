import { normalizeVendor } from '../domain/vendor-matcher.js';
import { parseMoneyToCents } from './money.js';

export interface ParsedLineItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface ParsedReceipt {
  format: 'text' | 'html' | 'json';
  merchant: string;
  merchantDomain: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  lineItems: ParsedLineItem[];
  extractedMeta: {
    authorizationId?: string;
    paymentToken?: string;
    cardLast4?: string;
    invoiceNumber?: string;
  };
}

function detectFormat(content: string | Record<string, unknown>, explicit?: 'text' | 'html' | 'json'): 'text' | 'html' | 'json' {
  if (explicit) return explicit;
  if (typeof content !== 'string') return 'json';
  const trimmed = content.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // fall through
    }
  }
  if (/<(html|body|table|div|tr|td|p|h1|h2)\b/i.test(trimmed)) {
    return 'html';
  }
  return 'text';
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHints(rawText: string): {
  authorizationId?: string;
  paymentToken?: string;
  cardLast4?: string;
  invoiceNumber?: string;
} {
  const authMatch = /\b(auth_[a-zA-Z0-9_-]+)\b/.exec(rawText);
  const tokMatch = /\b(ask_(?:tok|stripe)_[a-zA-Z0-9_-]+)\b/.exec(rawText);
  const last4Match =
    /(?:\*{4}|x{4}|ending\s+in|card\s*#?:?|last4:?)\s*[- ]?(\d{4})\b/i.exec(rawText);
  const invoiceMatch = /(?:invoice|receipt|order)\s*(?:#|no\.?|id)?\s*:?\s*([A-Z0-9-]{4,})/i.exec(
    rawText
  );

  return {
    authorizationId: authMatch?.[1],
    paymentToken: tokMatch?.[1],
    cardLast4: last4Match?.[1],
    invoiceNumber: invoiceMatch?.[1]
  };
}

function resolveMoneyField(
  obj: Record<string, unknown>,
  centsKeys: string[],
  dollarKeys: string[]
): number | undefined {
  for (const key of centsKeys) {
    const val = obj[key];
    if (typeof val === 'number' && Number.isFinite(val)) {
      return Math.round(val);
    }
    if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
      return Number(val.trim());
    }
  }
  for (const key of dollarKeys) {
    const val = obj[key];
    if (typeof val === 'number' || typeof val === 'string') {
      return parseMoneyToCents(val);
    }
  }
  return undefined;
}

function parseJsonReceipt(content: string | Record<string, unknown>): ParsedReceipt {
  const obj: Record<string, unknown> =
    typeof content === 'string'
      ? (JSON.parse(content) as Record<string, unknown>)
      : content;

  const merchant =
    String(
      obj.merchant ??
        obj.vendor ??
        obj.merchantName ??
        obj.seller ??
        obj.merchantDomain ??
        'Unknown Merchant'
    ).trim();

  const domainInput = String(obj.merchantDomain ?? obj.domain ?? obj.vendorDomain ?? merchant);
  const merchantDomain = normalizeVendor(domainInput).domain;

  const rawItems = (obj.lineItems ?? obj.items ?? []) as Array<Record<string, unknown>>;
  const lineItems: ParsedLineItem[] = Array.isArray(rawItems)
    ? rawItems.map((item) => {
        const description = String(item.description ?? item.name ?? item.title ?? 'Item').trim();
        const quantity =
          typeof item.quantity === 'number' && item.quantity > 0
            ? item.quantity
            : typeof item.qty === 'number' && item.qty > 0
              ? item.qty
              : 1;

        const explicitTotal = resolveMoneyField(
          item,
          ['totalCents', 'amountCents'],
          ['total', 'amount', 'price']
        );
        const explicitUnit = resolveMoneyField(
          item,
          ['unitPriceCents', 'priceCents'],
          ['unitPrice', 'unit_price']
        );

        const totalCents =
          explicitTotal ?? (explicitUnit !== undefined ? Math.round(explicitUnit * quantity) : 0);
        const unitPriceCents =
          explicitUnit ?? Math.round(totalCents / Math.max(1, quantity));

        return {
          description,
          quantity,
          unitPriceCents,
          totalCents
        };
      })
    : [];

  const lineSum = lineItems.reduce((acc, item) => acc + item.totalCents, 0);
  const taxCents = resolveMoneyField(obj, ['taxCents', 'vatCents'], ['tax', 'vat']) ?? 0;
  let subtotalCents = resolveMoneyField(obj, ['subtotalCents'], ['subtotal']);
  let totalCents = resolveMoneyField(
    obj,
    ['totalCents', 'amountCents', 'grandTotalCents'],
    ['total', 'amount', 'amountPaid', 'grandTotal']
  );

  if (subtotalCents === undefined && totalCents !== undefined) {
    subtotalCents = lineItems.length > 0 ? lineSum : Math.max(0, totalCents - taxCents);
  }
  if (totalCents === undefined) {
    const base = subtotalCents ?? lineSum;
    totalCents = base + taxCents;
  }
  if (subtotalCents === undefined) {
    subtotalCents = Math.max(0, totalCents - taxCents);
  }

  const rawSerialized = typeof content === 'string' ? content : JSON.stringify(content);
  const hints = extractHints(rawSerialized);

  return {
    format: 'json',
    merchant,
    merchantDomain,
    subtotalCents,
    taxCents,
    totalCents,
    currency: String(obj.currency ?? 'USD').toUpperCase(),
    lineItems,
    extractedMeta: {
      authorizationId:
        typeof obj.authorizationId === 'string' ? obj.authorizationId : hints.authorizationId,
      paymentToken:
        typeof obj.paymentToken === 'string' ? obj.paymentToken : hints.paymentToken,
      cardLast4: typeof obj.cardLast4 === 'string' ? obj.cardLast4 : hints.cardLast4,
      invoiceNumber:
        typeof obj.invoiceNumber === 'string' ? obj.invoiceNumber : hints.invoiceNumber
    }
  };
}

function parseLinesToReceipt(
  lines: string[],
  format: 'text' | 'html',
  rawForHints: string,
  preferredMerchant?: string,
  preferredDomain?: string
): ParsedReceipt {
  let merchant = preferredMerchant ?? '';
  let merchantDomain = preferredDomain ?? '';
  let subtotalCents: number | undefined;
  let taxCents = 0;
  let totalCents: number | undefined;
  const lineItems: ParsedLineItem[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Merchant / Domain key-value lines
    const merchantKv = /^(?:merchant|vendor|seller|billed\s+by|from)\s*:\s*(.+)$/i.exec(line);
    if (merchantKv?.[1]) {
      merchant = merchantKv[1].trim();
      continue;
    }

    const domainKv = /^(?:domain|website|url)\s*:\s*(.+)$/i.exec(line);
    if (domainKv?.[1]) {
      merchantDomain = normalizeVendor(domainKv[1]).domain;
      continue;
    }

    // Summary amounts: Subtotal, Tax, Total / Amount Paid
    const subtotalMatch =
      /^(?:sub-?total|items\s+total)\s*[:|-]?\s*(?:\$|USD\s*)?([0-9,]+\.\d{2}|[0-9,]+)$/i.exec(
        line
      );
    if (subtotalMatch?.[1]) {
      subtotalCents = parseMoneyToCents(subtotalMatch[1]);
      continue;
    }

    const taxMatch =
      /^(?:sales\s+tax|estimated\s+tax|tax|vat|gst)(?:\s*\([^)]*\))?\s*[:|-]?\s*(?:\$|USD\s*)?([0-9,]+\.\d{2}|[0-9,]+)$/i.exec(
        line
      );
    if (taxMatch?.[1]) {
      taxCents = parseMoneyToCents(taxMatch[1]);
      continue;
    }

    const totalMatch =
      /^(?:grand\s+total|total\s+paid|amount\s+paid|amount\s+charged|total\s+due|total)\s*[:|-]?\s*(?:\$|USD\s*)?([0-9,]+\.\d{2}|[0-9,]+)$/i.exec(
        line
      );
    if (totalMatch?.[1]) {
      totalCents = parseMoneyToCents(totalMatch[1]);
      continue;
    }

    // Ignore metadata header lines when scanning for line items
    if (
      /^(?:receipt|invoice|order|date|card|payment|auth(?:orization)?|status|currency|billing|note)\b/i.test(
        line
      )
    ) {
      continue;
    }

    // Line item pattern 1: "2 x GPT-4o Batch Credits @ $15.00  $30.00"
    const qtyUnitTotal =
      /^(?:[-*•]\s*)?(\d+)\s*[xX×]\s+(.+?)\s+@\s*(?:\$|USD\s*)?([0-9,]+\.\d{2})\s+(?:\$|USD\s*)?([0-9,]+\.\d{2})$/.exec(
        line
      );
    if (qtyUnitTotal) {
      const quantity = Number(qtyUnitTotal[1]);
      const description = qtyUnitTotal[2]!.trim();
      const unitPriceCents = parseMoneyToCents(qtyUnitTotal[3]!);
      const itemTotalCents = parseMoneyToCents(qtyUnitTotal[4]!);
      lineItems.push({ description, quantity, unitPriceCents, totalCents: itemTotalCents });
      continue;
    }

    // Line item pattern 2: "2 x Item Name .... $20.00" or "- Item Name: $12.50" or "Item Name   $12.50"
    const qtyTotalOnly =
      /^(?:[-*•]\s*)?(\d+)\s*[xX×]\s+(.+?)(?:\s*\.{2,}|\s{2,}|\s*[:|-]\s*)(?:\$|USD\s*)([0-9,]+\.\d{2})$/.exec(
        line
      );
    if (qtyTotalOnly) {
      const quantity = Number(qtyTotalOnly[1]);
      const description = qtyTotalOnly[2]!.trim();
      const itemTotalCents = parseMoneyToCents(qtyTotalOnly[3]!);
      lineItems.push({
        description,
        quantity,
        unitPriceCents: Math.round(itemTotalCents / Math.max(1, quantity)),
        totalCents: itemTotalCents
      });
      continue;
    }

    const simpleItem =
      /^(?:[-*•]\s*|\d+\.\s+)?([A-Za-z0-9][^$\n]{2,}?)(?:\s*\.{2,}|\s{2,}|\s*:\s*|\s+-\s+|\s+)\$(\d[\d,]*\.\d{2})$/.exec(
        line
      );
    if (simpleItem?.[1] && simpleItem?.[2]) {
      const description = simpleItem[1].trim();
      if (!/^(sub-?total|tax|vat|total|amount|balance|discount)/i.test(description)) {
        const itemTotalCents = parseMoneyToCents(simpleItem[2]);
        lineItems.push({
          description,
          quantity: 1,
          unitPriceCents: itemTotalCents,
          totalCents: itemTotalCents
        });
      }
    }
  }

  if (!merchant) {
    // Fallback to first non-empty line or domain in text
    const firstNonMeta = lines.find(
      (l) => l.trim().length > 1 && !/^(receipt|invoice|thank you)/i.test(l.trim())
    );
    merchant = firstNonMeta?.trim().slice(0, 80) || 'Unknown Merchant';
  }

  if (!merchantDomain) {
    const domainMatch = /\b([a-z0-9-]+(?:\.[a-z0-9-]+)+\b)/i.exec(`${merchant} ${rawForHints}`);
    if (domainMatch?.[1] && !/^\d+\.\d+$/.test(domainMatch[1])) {
      merchantDomain = normalizeVendor(domainMatch[1]).domain;
    } else {
      merchantDomain = normalizeVendor(merchant).domain;
    }
  }

  const lineSum = lineItems.reduce((acc, item) => acc + item.totalCents, 0);
  if (subtotalCents === undefined) {
    subtotalCents =
      lineItems.length > 0
        ? lineSum
        : totalCents !== undefined
          ? Math.max(0, totalCents - taxCents)
          : 0;
  }
  if (totalCents === undefined) {
    totalCents = subtotalCents + taxCents;
  }

  return {
    format,
    merchant,
    merchantDomain,
    subtotalCents,
    taxCents,
    totalCents,
    currency: 'USD',
    lineItems,
    extractedMeta: extractHints(rawForHints)
  };
}

function parseHtmlReceipt(html: string): ParsedReceipt {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n');

  const headingMatch = /<(?:h1|h2|title)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|title)>/i.exec(withoutScripts);
  const dataMerchantMatch = /data-merchant=["']([^"']+)["']/i.exec(withoutScripts);
  const hrefDomainMatch = /href=["'](https?:\/\/[^"']+)["']/i.exec(withoutScripts);

  const preferredMerchant = dataMerchantMatch?.[1]
    ? decodeHtmlEntities(dataMerchantMatch[1]).trim()
    : headingMatch?.[1]
      ? stripTags(headingMatch[1]).replace(/\s*(?:receipt|invoice).*$/i, '').trim()
      : undefined;

  const preferredDomain = hrefDomainMatch?.[1]
    ? normalizeVendor(hrefDomainMatch[1]).domain
    : undefined;

  const lines: string[] = [];

  // Parse HTML table rows first so multi-column rows become clean single lines
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(withoutScripts)) !== null) {
    const rowHtml = rowMatch[1] ?? '';
    const cells: string[] = [];
    const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      const cellText = stripTags(cellMatch[1] ?? '');
      if (cellText) cells.push(cellText);
    }
    if (cells.length >= 2) {
      // e.g. ["Item", "2", "$10.00", "$20.00"] or ["Subtotal", "$20.00"]
      if (cells.length === 2) {
        lines.push(`${cells[0]}: ${cells[1]}`);
      } else if (cells.length === 3 && /^\d+$/.test(cells[1]!)) {
        lines.push(`${cells[1]} x ${cells[0]}  ${cells[2]}`);
      } else if (cells.length >= 4 && /^\d+$/.test(cells[1]!)) {
        lines.push(`${cells[1]} x ${cells[0]} @ ${cells[2]}  ${cells[cells.length - 1]}`);
      } else {
        lines.push(`${cells.slice(0, -1).join(' ')}  ${cells[cells.length - 1]}`);
      }
    }
  }

  // Also extract block/paragraph/list text not already covered
  const withoutTables = withoutScripts.replace(/<table[\s\S]*?<\/table>/gi, '\n');
  const blockText = decodeHtmlEntities(
    withoutTables
      .replace(/<\/?(?:p|div|li|br|h1|h2|h3|h4|span|section|header|footer|tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  );
  for (const l of blockText.split(/\r?\n/)) {
    const clean = l.replace(/\s+/g, ' ').trim();
    if (clean) lines.push(clean);
  }

  const plainHintText = stripTags(withoutScripts);
  return parseLinesToReceipt(lines, 'html', plainHintText, preferredMerchant, preferredDomain);
}

export function parseReceipt(
  content: string | Record<string, unknown>,
  explicitFormat?: 'text' | 'html' | 'json'
): ParsedReceipt {
  const format = detectFormat(content, explicitFormat);
  if (format === 'json') {
    return parseJsonReceipt(content);
  }

  const rawText = typeof content === 'string' ? content : JSON.stringify(content);
  if (format === 'html') {
    return parseHtmlReceipt(rawText);
  }

  return parseLinesToReceipt(rawText.split(/\r?\n/), 'text', rawText);
}

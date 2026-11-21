export function parseMoneyToCents(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error(`Invalid monetary value: ${input}`);
    }
    return Math.round(input * 100);
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Empty monetary string');
  }

  const negative = trimmed.startsWith('-') || (trimmed.startsWith('(') && trimmed.endsWith(')'));
  const cleaned = trimmed.replace(/[^0-9.,-]/g, '').replace(/^-/, '');

  if (!cleaned) {
    throw new Error(`Unable to parse money value: "${input}"`);
  }

  let normalized = cleaned;
  // Handle "1,234.56" vs "1234,56"
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/,/g, '');
  } else if (normalized.includes(',')) {
    const parts = normalized.split(',');
    const last = parts[parts.length - 1] ?? '';
    if (parts.length === 2 && last.length <= 2) {
      normalized = `${parts[0]}.${last}`;
    } else {
      normalized = parts.join('');
    }
  }

  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) {
    throw new Error(`Unrecognized money format: "${input}"`);
  }

  const whole = Number(match[1] ?? '0');
  const fracRaw = match[2] ?? '';
  const fracPadded = `${fracRaw}00`.slice(0, 2);
  let cents = whole * 100 + Number(fracPadded);

  if (fracRaw.length > 2 && Number(fracRaw[2]) >= 5) {
    cents += 1;
  }

  return negative ? -cents : cents;
}

export function formatCents(cents: number, currency = 'USD'): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  const prefix = currency.toUpperCase() === 'USD' ? '$' : `${currency.toUpperCase()} `;
  return `${sign}${prefix}${dollars}.${rem}`;
}

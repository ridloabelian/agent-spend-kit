export function computeLuhnCheckDigit(partialDigits: string): string {
  if (!/^\d+$/.test(partialDigits)) {
    throw new Error('PAN digits must be numeric');
  }

  let sum = 0;
  let shouldDouble = true;

  for (let i = partialDigits.length - 1; i >= 0; i--) {
    let digit = Number(partialDigits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  const checkDigit = (10 - (sum % 10)) % 10;
  return String(checkDigit);
}

export function generateLuhnNumber(prefix: string, bodyDigits: string, totalLength = 16): string {
  const withoutCheck = `${prefix}${bodyDigits}`.slice(0, totalLength - 1);
  if (withoutCheck.length !== totalLength - 1) {
    throw new Error(`Expected ${totalLength - 1} base digits, received ${withoutCheck.length}`);
  }
  return `${withoutCheck}${computeLuhnCheckDigit(withoutCheck)}`;
}

export function isValidLuhn(pan: string): boolean {
  const digits = pan.replace(/[\s-]/g, '');
  if (!/^\d{12,19}$/.test(digits)) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function formatMaskedPan(pan: string): string {
  const digits = pan.replace(/[\s-]/g, '');
  if (digits.length < 10) return 'XXXX';
  const bin = digits.slice(0, 6);
  const last4 = digits.slice(-4);
  return `${bin.slice(0, 4)}-${bin.slice(4, 6)}XX-XXXX-${last4}`;
}

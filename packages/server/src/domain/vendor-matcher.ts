export interface NormalizedVendor {
  raw: string;
  domain: string;
  slug: string;
  baseLabel: string;
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractBaseLabel(domain: string): string {
  const parts = domain.split('.').filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 2] ?? domain;
  }
  return parts[0] ?? domain;
}

export function normalizeVendor(input: string): NormalizedVendor {
  const raw = input.trim();
  const lowered = raw.toLowerCase();

  let domain = '';
  const hasUrlOrPath = lowered.includes('://') || lowered.includes('/');
  const looksLikeWildcardDomain = lowered.startsWith('*.') && lowered.includes('.');
  const looksLikeDomain = !/\s/.test(lowered) && lowered.includes('.');

  if (looksLikeWildcardDomain) {
    domain = lowered.replace(/^(\*\.)+/, '*.').replace(/^www\./, '');
  } else if (hasUrlOrPath || looksLikeDomain) {
    try {
      const candidate = lowered.includes('://') ? lowered : `https://${lowered}`;
      const parsed = new URL(candidate);
      domain = parsed.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      domain = lowered.replace(/^www\./, '').replace(/[/?#].*$/, '');
    }
  } else {
    domain = toSlug(lowered);
  }

  const cleanDomain = domain.replace(/^\*\./, '');
  return {
    raw,
    domain,
    slug: toSlug(raw),
    baseLabel: extractBaseLabel(cleanDomain)
  };
}

export function matchesVendorPattern(vendorInput: string, patternInput: string): boolean {
  const pattern = patternInput.trim().toLowerCase();
  if (!pattern) return false;
  if (pattern === '*') return true;

  const vendor = normalizeVendor(vendorInput);
  const patNorm = normalizeVendor(pattern);

  // Wildcard domain pattern: *.openai.com matches api.openai.com and openai.com
  if (pattern.startsWith('*.')) {
    const baseDomain = pattern.slice(2).replace(/^www\./, '');
    return (
      vendor.domain === baseDomain ||
      vendor.domain.endsWith(`.${baseDomain}`)
    );
  }

  const vendorHasDot = vendor.domain.includes('.');
  const patternHasDot = patNorm.domain.includes('.');

  if (vendorHasDot && patternHasDot) {
    if (vendor.domain === patNorm.domain) return true;
    // Parent domain pattern (e.g., "openai.com" allows "api.openai.com")
    // Note: pattern "api.openai.com" does NOT match "billing.openai.com".
    const patParts = patNorm.domain.split('.');
    if (patParts.length === 2 && vendor.domain.endsWith(`.${patNorm.domain}`)) {
      return true;
    }
    return false;
  }

  if (!vendorHasDot && patternHasDot) {
    return vendor.slug === patNorm.baseLabel || vendor.slug === toSlug(patNorm.domain);
  }

  if (vendorHasDot && !patternHasDot) {
    return patNorm.slug === vendor.baseLabel || patNorm.slug === toSlug(vendor.domain);
  }

  return vendor.slug === patNorm.slug;
}

export function matchesVendorList(vendorInput: string, patterns: string[]): string | null {
  for (const pattern of patterns) {
    if (matchesVendorPattern(vendorInput, pattern)) {
      return pattern;
    }
  }
  return null;
}

export function matchesCategoryList(category: string, patterns: string[]): string | null {
  const normalized = category.trim().toLowerCase();
  for (const rawPattern of patterns) {
    const pattern = rawPattern.trim().toLowerCase();
    if (!pattern) continue;
    if (pattern === '*' || pattern === normalized) {
      return rawPattern;
    }
  }
  return null;
}

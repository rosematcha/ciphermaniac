export function normalizeCardNumber(value: string | number | null | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  const raw = String(value).trim();
  if (!raw) {
    return '';
  }
  const match = raw.match(/^(\d+)([A-Za-z]*)$/);
  if (!match) {
    return raw.toUpperCase();
  }
  const [, digits = '', suffix = ''] = match;
  const normalized = digits.padStart(3, '0');
  return suffix ? `${normalized}${suffix.toUpperCase()}` : normalized;
}

export function cardNumberIndexKey(value: string | number): string {
  const raw = String(value).trim();
  const match = raw.match(/^(\d+)([A-Za-z]*)$/);
  if (!match) {
    return raw.toUpperCase();
  }
  const digits = (match[1] ?? '').replace(/^0+/, '') || '0';
  return `${digits}${match[2]?.toUpperCase() ?? ''}`;
}

declare const CARD_UID_BRAND: unique symbol;
export type CardUid = string & { readonly [CARD_UID_BRAND]: 'CardUid' };

export function cardUid(
  name: string | null | undefined,
  setCode: string | null | undefined,
  number: string | number | null | undefined
): CardUid | null {
  if (!name) {
    return null;
  }
  const [set, normalized] = canonicalizeVariant(setCode, number);
  return set && normalized ? (`${name}::${set}::${normalized}` as CardUid) : null;
}

export function cardUidOrName(
  name: string,
  setCode: string | null | undefined,
  number: string | number | null | undefined
): string {
  return cardUid(name, setCode, number) ?? name;
}

export function maybeItemUid(item: {
  uid?: string;
  name?: string;
  set?: string | null;
  number?: string | number | null;
}): string | null {
  return item.uid || (item.name ? cardUidOrName(item.name, item.set, item.number) : null);
}

export function itemUid(item: {
  uid?: string;
  name: string;
  set?: string | null;
  number?: string | number | null;
}): string {
  return maybeItemUid(item) as string;
}

/** Type a UID read from a trusted artifact. Construct new UIDs with `cardUid`. */
export function asCardUid(uid: string): CardUid {
  return uid as CardUid;
}

export function canonicalizeVariant(
  setCode: string | null | undefined,
  number: string | number | null | undefined
): [string | null, string | null] {
  const set = String(setCode ?? '')
    .toUpperCase()
    .trim();
  if (!set) {
    return [null, null];
  }
  return [set, normalizeCardNumber(number) || null];
}

export function buildCardId(setCode: string, number: string | number | null | undefined): string {
  return `${setCode.trim().toUpperCase()}~${normalizeCardNumber(number)}`;
}

// Split from the right so malformed names containing `::` cannot shift fields.
export function parseCardUid(uid: string): { name: string; set: string; number: string } | null {
  const parts = uid.split('::');
  if (parts.length < 3) {
    return null;
  }
  const number = parts.at(-1);
  const set = parts.at(-2);
  const name = parts.slice(0, -2).join('::');
  return name && set && number ? { name, set, number } : null;
}

export function accessiblePriceCap(minPrice: number): number {
  return Math.max(minPrice * 2, minPrice + 0.5);
}

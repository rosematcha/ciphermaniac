export function extractArchetypeFromUrl(loc = window.location): string | null {
  const { pathname } = loc;
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const rawSlug = parts[0];
  try {
    return decodeURIComponent(rawSlug).replace(/_/g, ' ');
  } catch {
    return rawSlug.replace(/_/g, ' ');
  }
}

export function buildHomeUrl(archetypeSlug: string): string {
  return `/${encodeURIComponent(archetypeSlug)}`;
}

export function buildAnalysisUrl(archetypeSlug: string): string {
  return `/${encodeURIComponent(archetypeSlug)}/analysis`;
}

export function buildCardUrl(card: { name: string; set: string | null; number: string | null }): string {
  if (card.set && card.number) {
    return `/card/${card.set}~${card.number}`;
  }
  return `/cards?card=${encodeURIComponent(card.name)}`;
}

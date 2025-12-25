/**
 * Missing card page rendering
 * Handles the user-friendly error page when a requested card is not found in tournament data
 * @module card/missingCard
 */

import { fetchCardIndex, fetchReport, fetchTournamentsList, fetchTrendReport, ONLINE_META_NAME } from '../api.js';
import { parseReport } from '../parse.js';
import { buildThumbCandidates } from '../thumbs.js';
import { logger } from '../utils/errorHandler.js';
import { getBaseName, getDisplayName, parseDisplayName } from './identifiers.js';
import { buildCardPath, buildIdentifierLookup, describeSlug, extractSetAndNumber } from './routing.js';
import { getCanonicalCard, getVariantImageCandidates } from '../utils/cardSynonyms.js';

// Types
export interface MissingCardPreview {
  name: string;
  identifier: string;
  label: string;
  meta: string;
  set?: string | null;
  number?: string | number | null;
}

// Constants
const MISSING_CARD_TRENDS_SOURCE = 'Trends - Last 30 Days';

/**
 * Format a usage percentage value for display
 */
export function formatUsagePercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '0%';
  }
  const normalized = Math.max(0, value);
  const precision = normalized >= 10 ? 0 : normalized >= 1 ? 1 : 2;
  return `${normalized.toFixed(precision)}%`;
}

/**
 * Format a delta percentage value for display (with +/- sign)
 */
export function formatDeltaPercent(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return '+0%';
  }
  const clamped = Math.max(Math.min(value, 100), -100);
  const abs = Math.abs(clamped);
  const precision = abs >= 10 ? 0 : abs >= 1 ? 1 : 2;
  const sign = clamped > 0 ? '+' : '-';
  return `${sign}${abs.toFixed(precision)}%`;
}

/**
 * Convert a string to title case
 */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Convert a card identifier to a human-readable display name
 */
export function prettifyIdentifier(identifier: string): string {
  if (!identifier) {
    return '';
  }
  const display = getDisplayName(identifier);
  if (display && display !== identifier) {
    return display;
  }
  const slugGuess = describeSlug(identifier);
  if (slugGuess) {
    return titleCase(slugGuess.replace(/[:]/g, ' '));
  }
  if (identifier.includes('-')) {
    return titleCase(identifier.replace(/-/g, ' '));
  }
  return identifier;
}

/**
 * Normalize trending card data into a consistent format
 */
function normalizeTrendingCard(entry: any) {
  if (!entry || !entry.name) {
    return null;
  }
  const shareKeys = ['recentAvg', 'latest', 'currentShare', 'endShare', 'startShare', 'avgShare', 'share'];
  let latest = 0;
  for (const key of shareKeys) {
    const val = Number(entry[key]);
    if (Number.isFinite(val)) {
      latest = val;
      break;
    }
  }
  const deltaKeys = ['deltaAbs', 'delta'];
  let delta = 0;
  for (const key of deltaKeys) {
    const val = Number(entry[key]);
    if (Number.isFinite(val)) {
      delta = val;
      break;
    }
  }
  delta = Math.max(Math.min(delta, 100), -100);
  const set = typeof entry.set === 'string' ? entry.set : null;
  const numberValue = entry.number;
  const number = typeof numberValue === 'string' || typeof numberValue === 'number' ? String(numberValue).trim() : null;
  const identifier = set && number ? `${entry.name} :: ${set} ${number}` : entry.name;
  return {
    name: entry.name,
    set,
    number,
    latest,
    delta,
    identifier
  };
}

/**
 * Format a tournament label for display
 */
function describeTournamentLabel(label: string | null): string {
  if (!label) {
    return 'latest event';
  }
  const parts = label.split(',');
  if (parts.length >= 2) {
    return parts.slice(1).join(',').trim() || label.trim();
  }
  return label.trim();
}

/**
 * Pick a random underdog card from a tournament for the "Sleeper pick" suggestion
 */
async function pickUnderdogCard(
  tournamentLabel: string,
  existingNames: Set<string>
): Promise<MissingCardPreview | null> {
  try {
    const reportData = await fetchReport(tournamentLabel);
    const parsed = parseReport(reportData);
    const candidates = (parsed?.items || []).filter(
      item =>
        item &&
        typeof item.pct === 'number' &&
        item.pct > 0 &&
        item.pct < 15 &&
        typeof item.name === 'string' &&
        item.name.trim().length > 0
    );
    if (!candidates.length) {
      return null;
    }
    const filtered = candidates.filter(item => !existingNames.has(item.name.toLowerCase()));
    const pool = filtered.length ? filtered : candidates;
    const selection = pool[Math.floor(Math.random() * pool.length)];
    if (!selection) {
      return null;
    }
    existingNames.add(selection.name.toLowerCase());
    const identifier =
      selection.uid ||
      (selection.set && selection.number
        ? `${selection.name} :: ${selection.set} ${selection.number}`
        : selection.name);
    return {
      name: selection.name,
      identifier,
      set: selection.set,
      number: selection.number,
      label: 'Underdog pick',
      meta: `${formatUsagePercent(selection.pct || 0)} in ${describeTournamentLabel(tournamentLabel)}`
    };
  } catch (error: any) {
    logger.warn('Failed to load underdog card preview', {
      tournament: tournamentLabel,
      error: error?.message || error
    });
    return null;
  }
}

/**
 * Pick a random item from an array
 */
function pickRandom<T>(items: T[]): T | null {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  const idx = Math.floor(Math.random() * items.length);
  return items[idx] ?? null;
}

/**
 * Build preview data for suggested cards when the requested card is missing
 */
async function buildMissingCardPreviewData(cardIdentifier: string): Promise<MissingCardPreview[]> {
  const previews: MissingCardPreview[] = [];
  const seenNames = new Set<string>();
  try {
    const [trendPayload, tournaments] = await Promise.all([
      fetchTrendReport(MISSING_CARD_TRENDS_SOURCE).catch(() => null),
      fetchTournamentsList().catch(() => [])
    ]);

    if (trendPayload) {
      const risingList =
        (trendPayload?.suggestions?.onTheRise &&
          trendPayload.suggestions.onTheRise.length &&
          trendPayload.suggestions.onTheRise) ||
        trendPayload?.cardTrends?.rising ||
        [];
      const coolingList =
        (trendPayload?.suggestions?.choppedAndWashed &&
          trendPayload.suggestions.choppedAndWashed.length &&
          trendPayload.suggestions.choppedAndWashed) ||
        trendPayload?.cardTrends?.falling ||
        [];

      const risingPool = (Array.isArray(risingList) ? risingList : [])
        .map(normalizeTrendingCard)
        .filter(Boolean)
        .slice(0, 6);
      const coolingPool = (Array.isArray(coolingList) ? coolingList : [])
        .map(normalizeTrendingCard)
        .filter(Boolean)
        .slice(0, 6);

      const rising = pickRandom(risingPool.filter(item => !seenNames.has(item!.name.toLowerCase())));
      if (rising) {
        seenNames.add(rising.name.toLowerCase());
        previews.push({
          name: rising.name,
          identifier: rising.identifier,
          set: rising.set,
          number: rising.number,
          label: 'Meta riser',
          meta: `${formatUsagePercent(rising.latest)} &middot; ${formatDeltaPercent(rising.delta)}`
        });
      }

      const cooling = pickRandom(coolingPool.filter(item => item && !seenNames.has(item.name.toLowerCase())));
      if (cooling) {
        seenNames.add(cooling.name.toLowerCase());
        previews.push({
          name: cooling.name,
          identifier: cooling.identifier,
          set: cooling.set,
          number: cooling.number,
          label: 'Cooling off',
          meta: `${formatUsagePercent(cooling.latest)} &middot; ${formatDeltaPercent(cooling.delta)}`
        });
      }
    }

    if (Array.isArray(tournaments) && tournaments.length > 0) {
      const underdog = await pickUnderdogCard(tournaments[0], seenNames);
      if (underdog) {
        previews.push({
          ...underdog,
          label: 'Sleeper pick'
        });
      }
    }
  } catch (error: any) {
    logger.warn('Failed to assemble missing-card previews', {
      cardIdentifier,
      error: error?.message || error
    });
  }

  return previews;
}

/**
 * Load a thumbnail image for a preview card with fallback handling
 */
function loadPreviewThumbnail(target: HTMLElement, preview: MissingCardPreview) {
  const variant = preview.set && preview.number ? { set: preview.set, number: preview.number } : undefined;
  const candidates: string[] = [];
  const appendCandidates = (list: string[] | undefined) => {
    if (!Array.isArray(list)) {
      return;
    }
    for (const url of list) {
      if (url && !candidates.includes(url)) {
        candidates.push(url);
      }
    }
  };
  if (preview.identifier) {
    let uidSet: string | null = null;
    let uidNumber: string | null = null;
    if (preview.identifier.includes('::')) {
      const parts = preview.identifier.split('::');
      uidSet = parts[1] || null;
      uidNumber = parts[2] || null;
    } else {
      const match = preview.identifier.match(/^([A-Z]{2,})[:\s]+(\d+[A-Za-z]?)$/);
      if (match) {
        uidSet = match[1];
        uidNumber = match[2];
      }
    }
    if (uidSet && uidNumber) {
      appendCandidates(buildThumbCandidates(preview.name, false, {}, { set: uidSet, number: uidNumber }));
    }
  }
  appendCandidates(buildThumbCandidates(preview.name, false, {}, variant));
  if (candidates.length === 0) {
    return;
  }
  const img = document.createElement('img');
  img.decoding = 'async';
  img.loading = 'lazy';
  img.alt = preview.name;
  img.width = 48;
  img.height = 68;
  target.appendChild(img);

  let idx = 0;
  let fallbackAttempted = false;

  const tryNext = async () => {
    if (idx >= candidates.length && !fallbackAttempted) {
      fallbackAttempted = true;
      try {
        const fallback = await getVariantImageCandidates(preview.identifier, false, {});
        if (fallback.length) {
          candidates.push(...fallback);
        }
      } catch {
        // ignore fallback failure
      }
    }
    if (idx >= candidates.length) {
      target.classList.add('card-missing-trend-thumb--empty');
      img.remove();
      return;
    }
    img.src = candidates[idx++];
  };

  img.onerror = () => {
    tryNext();
  };
  tryNext();
}

/**
 * Render the trending cards section in the missing card page
 */
async function renderMissingCardTrendingCards(container: HTMLElement | null, cardIdentifier: string) {
  if (!container) {
    return;
  }
  // eslint-disable-next-line no-param-reassign
  container.innerHTML = '<p class="card-missing-empty">Loading trending cards...</p>';
  try {
    const previews = await buildMissingCardPreviewData(cardIdentifier);
    if (!previews.length) {
      // eslint-disable-next-line no-param-reassign
      container.innerHTML =
        '<p class="card-missing-empty">Trending cards will appear once new events are processed.</p>';
      return;
    }
    // eslint-disable-next-line no-param-reassign
    container.innerHTML = '';
    previews.forEach(preview => {
      const href = buildCardPath(preview.identifier);
      const link = document.createElement('a');
      link.className = 'card-missing-trend';
      link.href = href;
      link.innerHTML = `
        <div class="card-missing-trend-thumb" aria-hidden="true"></div>
        <div class="card-missing-trend-copy">
          <span class="card-missing-trend-label">${preview.label}</span>
          <span class="card-missing-trend-name">${preview.name}</span>
          ${preview.set && preview.number ? `<span class="card-missing-trend-set">${preview.set} ${preview.number}</span>` : ''}
          <span class="card-missing-trend-meta">${preview.meta}</span>
        </div>
      `;
      container.appendChild(link);
      const thumb = link.querySelector('.card-missing-trend-thumb') as HTMLElement | null;
      if (thumb) {
        loadPreviewThumbnail(thumb, preview);
      }
    });
  } catch (error: any) {
    logger.warn('Failed to load trending cards preview for missing card', {
      cardIdentifier,
      error: error?.message || error
    });
    // eslint-disable-next-line no-param-reassign
    container.innerHTML = '<p class="card-missing-empty">Trending cards unavailable right now.</p>';
  }
}

/**
 * Resolve a display name for a missing card by searching through reports
 */
export async function resolveMissingCardDisplayName(cardIdentifier: string): Promise<string | null> {
  const initial = getDisplayName(cardIdentifier);
  if (initial && initial !== cardIdentifier) {
    return initial;
  }
  const { searchKeys } = buildIdentifierLookup(cardIdentifier);
  const { set: idSet, number: idNumber } = extractSetAndNumber(cardIdentifier);
  if (idSet && idNumber) {
    searchKeys.add(`${idSet}::${idNumber}`.toLowerCase());
    searchKeys.add(`${idSet} ${idNumber}`.toLowerCase());
  }

  const matchFromIndex = (cards: Record<string, any> | undefined, keys: Set<string>) => {
    if (!cards || typeof cards !== 'object') {
      return null;
    }
    for (const [name, details] of Object.entries(cards)) {
      const normalized = name.toLowerCase();
      if (keys.has(normalized)) {
        return name;
      }
      const uid = (details as any)?.uid;
      if (typeof uid === 'string') {
        const display = getDisplayName(uid);
        if (display && keys.has(display.toLowerCase())) {
          return name;
        }
      }
    }
    return null;
  };

  const matchFromReportItems = (items: any[] | undefined, keys: Set<string>) => {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }
    for (const item of items) {
      const name = item?.name;
      if (typeof name === 'string' && keys.has(name.toLowerCase())) {
        const uidDisplay = item?.uid ? getDisplayName(item.uid) : null;
        if (uidDisplay) {
          return `${name} ${uidDisplay}`;
        }
        if (item?.set && item?.number) {
          return `${name} ${item.set} ${item.number}`;
        }
        return name;
      }
      if (item?.set && item?.number) {
        const key = `${item.set}::${item.number}`.toLowerCase();
        if (keys.has(key)) {
          return `${item.name || ''} ${item.set} ${item.number}`.trim();
        }
      }
      const uid = item?.uid;
      if (typeof uid === 'string') {
        const display = getDisplayName(uid);
        if (display && keys.has(display.toLowerCase())) {
          return `${name || ''} ${display}`.trim();
        }
      }
    }
    return null;
  };

  // 1) Prefer online meta index first
  try {
    const onlineReport = await fetchReport(ONLINE_META_NAME).catch(() => null);
    if (onlineReport) {
      const parsed = parseReport(onlineReport);
      const match = matchFromReportItems(parsed?.items, searchKeys);
      if (match) {
        return match;
      }
    }
  } catch {
    // ignore
  }

  // 2) Fall back to tournaments list indices
  let tournaments: string[] = [];
  try {
    tournaments = await fetchTournamentsList();
  } catch {
    tournaments = [];
  }
  const subset = tournaments.slice(0, 12);
  for (const tournament of subset) {
    try {
      const index = await fetchCardIndex(tournament);
      const match = matchFromIndex(index?.cards, searchKeys);
      if (match) {
        return match;
      }
    } catch {
      continue;
    }
  }
  return null;
}

// CSS styles for the missing card page
const MISSING_CARD_STYLES = `
.card-missing {
  max-width: 880px;
  margin: 1.5rem auto 3rem;
  padding: 0 1rem;
  color: var(--text, #eef1f7);
}

.card-missing-card {
  display: flex;
  gap: 1.25rem;
  align-items: center;
  padding: 1.5rem;
  border-radius: 12px;
  border: 1px solid var(--border, #2a3150);
  background: var(--panel, #17181d);
}

.card-missing-thumb {
  width: min(220px, 40vw);
  aspect-ratio: 3 / 4;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.card-missing-info h1 {
  margin: 0 0 0.35rem 0;
  font-size: 1.6rem;
}

.card-missing-info {
  flex: 1;
}

.card-missing-eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.78rem;
  color: var(--muted, #a3a8b7);
  margin: 0 0 0.35rem 0;
}

.card-missing-meta {
  margin: 0 0 1rem 0;
  color: var(--muted, #a3a8b7);
  line-height: 1.4;
}

.card-missing-meta span {
  display: inline-block;
  font-size: 0.85rem;
  opacity: 0.85;
}

.card-missing-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.card-missing-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.6rem 1.1rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2a3150);
  color: var(--text, #eef1f7);
  text-decoration: none;
  font-weight: 600;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.card-missing-button.primary {
  background: var(--accent-2, #6aa3ff);
  border-color: transparent;
  color: #0c1223;
}

.card-missing-button:hover {
  border-color: var(--accent-2, #6aa3ff);
  background: rgba(106, 163, 255, 0.08);
}

.card-missing-trending {
  margin-top: 1.25rem;
  border-radius: 12px;
  border: 1px solid var(--border, #2a3150);
  padding: 1.25rem;
  background: rgba(0, 0, 0, 0.2);
}

.card-missing-trending-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.card-missing-trending-header h2 {
  margin: 0;
  font-size: 1.1rem;
}

.card-missing-link {
  color: var(--muted, #a3a8b7);
  text-decoration: none;
  font-size: 0.9rem;
}

.card-missing-trending-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
}

.card-missing-trend {
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0.65rem 0.9rem;
  text-decoration: none;
  color: var(--text, #eef1f7);
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  gap: 0.75rem;
  align-items: center;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.card-missing-trend:hover {
  border-color: var(--accent-2, #6aa3ff);
  background: rgba(106, 163, 255, 0.08);
}

.card-missing-trend-thumb {
  width: 48px;
  height: 68px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  overflow: hidden;
  flex-shrink: 0;
}

.card-missing-trend-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.card-missing-trend-thumb--empty {
  background: rgba(255, 255, 255, 0.08);
}

.card-missing-trend-copy {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.card-missing-trend-label {
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  color: var(--muted, #a3a8b7);
}

.card-missing-trend-name {
  font-weight: 600;
  display: block;
}

.card-missing-trend-set {
  color: var(--muted, #a3a8b7);
  font-size: 0.9rem;
  display: block;
}

.card-missing-trend-meta {
  color: var(--muted, #a3a8b7);
  font-size: 0.9rem;
}

.card-missing-empty {
  color: var(--muted, #a3a8b7);
  font-size: 0.95rem;
  margin: 0;
}

@media (max-width: 720px) {
  .card-missing-card {
    flex-direction: column;
    padding: 1.25rem;
    align-items: flex-start;
  }

  .card-missing-thumb {
    width: 100%;
    max-width: 340px;
  }

  .card-missing-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .card-missing-button {
    width: 100%;
    justify-content: center;
    text-align: center;
  }
}
`;

/**
 * Inject the missing card page styles if not already present
 */
function ensureMissingCardStyles(): void {
  if (!document.getElementById('card-missing-style')) {
    const style = document.createElement('style');
    style.id = 'card-missing-style';
    style.textContent = MISSING_CARD_STYLES;
    document.head.appendChild(style);
  }
}

/**
 * Render a user-friendly error page for missing cards
 * @param cardIdentifier - The card that was requested
 * @param metaSection - Reference to the meta section element for fallback error display
 */
export async function renderMissingCardPage(cardIdentifier: string, metaSection: HTMLElement | null): Promise<void> {
  try {
    let canonicalIdentifier = cardIdentifier;
    try {
      canonicalIdentifier = (await getCanonicalCard(cardIdentifier)) || cardIdentifier;
    } catch (error: any) {
      logger.debug('Unable to resolve canonical identifier for missing card', {
        cardIdentifier,
        error: error?.message || error
      });
    }
    const resolvedFromReports = (await resolveMissingCardDisplayName(canonicalIdentifier)) || null;
    const displaySource = resolvedFromReports || canonicalIdentifier || cardIdentifier;
    const displayName = prettifyIdentifier(displaySource) || displaySource || cardIdentifier;
    const fallbackVariant = extractSetAndNumber(displaySource);

    if (typeof history !== 'undefined') {
      document.title = `Card Not Found - ${displayName} | Ciphermaniac`;
    }

    const main = document.querySelector('main');
    if (main) {
      const baseName =
        getBaseName(displaySource) || getBaseName(canonicalIdentifier) || getBaseName(cardIdentifier) || cardIdentifier;
      const encodedSearch = encodeURIComponent(displayName);
      main.innerHTML = `
        <section class="card-missing">
          <div class="card-missing-card">
            <div class="card-missing-thumb" aria-hidden="true"></div>
            <div class="card-missing-info">
              <p class="card-missing-eyebrow">No tournament entries yet</p>
              <h1>${displayName}</h1>
              <p class="card-missing-meta">This card has no Day 2 finishes, so no data can be shown.<br><span>Maybe you can get it its page?</span></p>
            <div class="card-missing-actions">
                <a href="/cards?q=${encodedSearch}" class="card-missing-button primary">Search for ${displayName}</a>
                <a href="/trends.html" class="card-missing-button">View meta trends</a>
              </div>
            </div>
          </div>
          <div class="card-missing-trending">
            <div class="card-missing-trending-header">
              <h2>Check these out!</h2>
              <a class="card-missing-link" href="/trends.html">See full report</a>
            </div>
            <div class="card-missing-trending-grid" id="card-missing-trending"></div>
          </div>
        </section>
      `;

      ensureMissingCardStyles();

      const trendingContainer = document.getElementById('card-missing-trending') as HTMLElement | null;
      renderMissingCardTrendingCards(trendingContainer, canonicalIdentifier);

      const imageContainer = main.querySelector('.card-missing-thumb');
      if (imageContainer) {
        const parsed = parseDisplayName(displaySource);
        const variant: any = {};
        if (parsed?.setId) {
          const match = parsed.setId.match(/^([A-Z]+)\s+(\d+[A-Za-z]?)$/);
          if (match) {
            variant.set = match[1];
            variant.number = match[2];
          }
        }
        if (!variant.set && fallbackVariant.set) {
          variant.set = fallbackVariant.set;
        }
        if (!variant.number && fallbackVariant.number) {
          variant.number = fallbackVariant.number;
        }

        const candidateName = parsed?.name || baseName || displayName;
        const candidates = buildThumbCandidates(candidateName, true, {}, variant);

        if (candidates.length === 0) {
          imageContainer.remove();
        } else {
          const img = document.createElement('img');
          img.decoding = 'async';
          img.loading = 'lazy';
          img.alt = displayName;
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'cover';
          img.style.borderRadius = 'inherit';

          let idx = 0;
          let fallbackAttempted = false;

          const tryNext = async () => {
            // If we've exhausted all candidates and haven't tried fallback yet, try synonym variants
            if (idx >= candidates.length && !fallbackAttempted) {
              fallbackAttempted = true;
              try {
                const fallbackCandidates = await getVariantImageCandidates(canonicalIdentifier, false, {});
                if (fallbackCandidates.length > 0) {
                  candidates.push(...fallbackCandidates);
                  if (idx < candidates.length) {
                    img.src = candidates[idx++];
                  } else {
                    imageContainer.remove();
                  }
                } else {
                  imageContainer.remove();
                }
              } catch {
                imageContainer.remove();
              }
              return;
            }

            if (idx >= candidates.length) {
              imageContainer.remove();
              return;
            }
            img.src = candidates[idx++];
          };

          img.onerror = tryNext;
          tryNext();

          imageContainer.appendChild(img);
        }
      }
    }

    logger.info('Rendered missing card page', { cardIdentifier });
  } catch (error: any) {
    logger.error('Failed to render missing card page', {
      cardIdentifier,
      error: error.message
    });
    if (metaSection) {
      // eslint-disable-next-line no-param-reassign
      metaSection.innerHTML =
        '<div style="text-align: center; padding: 2rem; color: var(--text);">Card page not available. We do not have tournament data for this card yet.</div>';
    }
  }
}

/**
 * Archetype Home Page - Enhanced Version
 * Landing page for a specific archetype featuring:
 * - Key card hero display
 * - Playrate stats and meta position
 * - Top performing deck lists with links
 * - Quick navigation to Analysis/Trends
 */
import './utils/buildVersion.js';
import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { fetchArchetypesList } from './api.js';

// --- Interfaces ---

interface DeckEntry {
  id: string;
  player: string;
  playerId: string;
  country?: string;
  placement: number | null;
  archetype: string;
  archetypeId: string;
  cards: Array<{
    count: number;
    name: string;
    set: string;
    number: string;
    category: string;
  }>;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
  tournamentFormat: string;
  tournamentPlatform: string;
  tournamentOrganizer?: string;
  tournamentPlayers: number;
  successTags: string[];
}

interface TrendsMeta {
  generatedAt: string;
  tournamentCount: number;
  cardCount: number;
  weekCount: number;
  windowStart: string;
  windowEnd: string;
}

interface TrendsData {
  meta: TrendsMeta;
  weeks: Array<{
    weekStart: string;
    weekEnd: string;
    tournamentIds: string[];
    totals: Record<string, number>;
  }>;
  cards: Record<string, unknown>;
  insights: {
    coreCards: string[];
    flexSlots: Array<{ uid: string; variance: number; copyRange: [number, number] }>;
    risers: Array<{ uid: string; delta: number; from: number; to: number }>;
    fallers: Array<{ uid: string; delta: number; from: number; to: number }>;
    substitutions: Array<{ cardA: string; cardB: string; correlation: number }>;
  };
}

interface TopPerformer {
  player: string;
  playerId: string;
  placement: number;
  tournamentId: string;
  tournamentName: string;
  tournamentPlayers: number;
  tournamentDate: string;
  country?: string;
  impressivenessScore: number;
}

// --- Constants ---

const R2_BASE_URL = CONFIG.API.R2_BASE;
const LIMITLESS_DECKLIST_BASE = 'https://play.limitlesstcg.com/tournament';
const ONLINE_META_TOURNAMENT = 'Online - Last 14 Days';

// --- State ---

interface AppState {
  archetypeName: string;
  archetypeSlug: string;
  decks: DeckEntry[] | null;
  trends: TrendsData | null;
  thumbnails: string[]; // Array of "SET/NUMBER" strings from API
  keyCard: { set: string; number: string } | null;
}

const state: AppState = {
  archetypeName: '',
  archetypeSlug: '',
  decks: null,
  trends: null,
  thumbnails: [],
  keyCard: null
};

// --- DOM Elements ---

const elements = {
  page: document.querySelector('.archetype-home-page') as HTMLElement | null,
  title: document.getElementById('archetype-title'),
  tabHome: document.getElementById('tab-home') as HTMLAnchorElement | null,
  tabAnalysis: document.getElementById('tab-analysis') as HTMLAnchorElement | null,
  tabTrends: document.getElementById('tab-trends') as HTMLAnchorElement | null,
  heroSection: document.getElementById('archetype-hero') as HTMLElement | null,
  heroBannerImages: document.getElementById('hero-banner-images') as HTMLElement | null,
  heroBannerFallback: document.getElementById('hero-banner-fallback') as HTMLElement | null,
  statsSection: document.getElementById('archetype-stats') as HTMLElement | null,
  statDecks: document.getElementById('stat-total-decks'),
  statTournaments: document.getElementById('stat-tournaments'),
  statWinRate: document.getElementById('stat-win-rate'),
  statTop8Rate: document.getElementById('stat-top8-rate'),
  performersSection: document.getElementById('top-performers') as HTMLElement | null,
  performersList: document.getElementById('performers-list') as HTMLElement | null,
  coreCardsSection: document.getElementById('core-cards-section') as HTMLElement | null,
  coreCardsList: document.getElementById('core-cards-list') as HTMLElement | null,
  actionsSection: document.getElementById('archetype-actions') as HTMLElement | null,
  loadingIndicator: document.getElementById('archetype-loading') as HTMLElement | null,
  errorMessage: document.getElementById('archetype-error') as HTMLElement | null
};

// --- URL Utilities ---

function extractArchetypeFromUrl(): string | null {
  const { pathname } = window.location;
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

function buildUrl(subpage: string = ''): string {
  if (!state.archetypeSlug) {
    return '/archetypes';
  }
  const basePath = `/${encodeURIComponent(state.archetypeSlug)}`;
  return subpage ? `${basePath}/${subpage}` : basePath;
}

function buildLimitlessUrl(tournamentId: string, playerId: string): string {
  return `${LIMITLESS_DECKLIST_BASE}/${tournamentId}/player/${playerId}/decklist`;
}

function buildCardUrl(set: string, number: string): string {
  return `/card/${set}~${number}`;
}

// --- Data Fetching ---

async function fetchDecksData(): Promise<DeckEntry[] | null> {
  const url = `${R2_BASE_URL}/reports/Online%20-%20Last%2014%20Days/archetypes/${encodeURIComponent(state.archetypeSlug)}/decks.json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        logger.warn('Decks data not found', { archetype: state.archetypeSlug });
        return null;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as DeckEntry[];
  } catch (error) {
    logger.error('Failed to fetch decks data', { error });
    return null;
  }
}

async function fetchTrendsData(): Promise<TrendsData | null> {
  const url = `${R2_BASE_URL}/reports/Online%20-%20Last%2014%20Days/archetypes/${encodeURIComponent(state.archetypeSlug)}/trends.json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        logger.warn('Trends data not found', { archetype: state.archetypeSlug });
        return null;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as TrendsData;
  } catch (error) {
    logger.error('Failed to fetch trends data', { error });
    return null;
  }
}

/**
 * Fetch thumbnails from the archetypes index API
 * Uses the same source of truth as the archetypes list page
 */
async function fetchThumbnailsFromAPI(archetypeName: string): Promise<string[]> {
  try {
    const archetypesList = await fetchArchetypesList(ONLINE_META_TOURNAMENT);
    const archetype = archetypesList.find(
      entry => entry.name === archetypeName || entry.name.replace(/_/g, ' ') === archetypeName
    );

    if (archetype && Array.isArray(archetype.thumbnails)) {
      return archetype.thumbnails.filter(Boolean);
    }

    return [];
  } catch (error) {
    logger.error('Failed to fetch thumbnails from API', { error });
    return [];
  }
}

// --- Key Card Resolution ---

interface KeyCardInfo {
  set: string;
  number: string;
  name: string;
}

/**
 * Resolve key cards for the archetype (1-2 cards from thumbnails or deck data)
 */
function resolveKeyCards(): KeyCardInfo[] {
  const cards: KeyCardInfo[] = [];

  // Try thumbnails first - array of "SET/NUMBER" strings from API
  if (state.thumbnails && state.thumbnails.length > 0) {
    // Take up to 2 thumbnails
    for (const setNumber of state.thumbnails.slice(0, 2)) {
      const match = setNumber.match(/^([A-Z0-9]+)\/(\d+[A-Za-z]?)$/);
      if (match) {
        // Extract Pokemon name from archetype
        const tokens = state.archetypeName.split(/[\s_]/);
        const cardIndex = cards.length;
        const cardName = tokens[cardIndex] || tokens[0] || 'Unknown';
        cards.push({ set: match[1], number: match[2], name: cardName });
      }
    }
  }

  // If no thumbnails, fallback: find from deck data
  if (cards.length === 0 && state.decks && state.decks.length > 0) {
    const tokens = state.archetypeName.split(/[\s_]/).map(token => token.toLowerCase());
    const deck = state.decks[0];

    for (const token of tokens.slice(0, 2)) {
      for (const card of deck.cards) {
        if (card.category === 'pokemon' && card.name.toLowerCase().includes(token)) {
          // Avoid duplicates
          if (!cards.some(existingCard => existingCard.set === card.set && existingCard.number === card.number)) {
            cards.push({ set: card.set, number: card.number, name: card.name });
            break;
          }
        }
      }
      if (cards.length >= 2) {
        break;
      }
    }
  }

  return cards;
}

// Keep backward compatibility
function _resolveKeyCard(): KeyCardInfo | null {
  const cards = resolveKeyCards();
  return cards.length > 0 ? cards[0] : null;
}

// --- Impressiveness Score Calculation ---

/**
 * Calculate how impressive a tournament result is.
 * Factors: placement (lower = better), tournament size (larger = more impressive)
 *
 * Formula: score = tournamentPlayers / (placement ^ placementWeight)
 *
 * Examples:
 * - 1st in 157 players: 157 / 1 = 157
 * - 2nd in 160 players: 160 / 2 = 80
 * - 1st in 16 players: 16 / 1 = 16
 * - 2nd in 160 is more impressive than 1st in 16 (80 > 16)
 */
function calculateImpressivenessScore(placement: number, tournamentPlayers: number): number {
  if (!placement || placement < 1) {
    return 0;
  }
  if (!tournamentPlayers || tournamentPlayers < 1) {
    return 0;
  }

  // Use a slight power to balance placement weight
  // placement^1.2 means 1st place is much better than 2nd, but large tournaments still matter
  const placementWeight = 1.2;
  return tournamentPlayers / placement ** placementWeight;
}

/**
 * Get top performing decks sorted by impressiveness
 */
function getTopPerformers(limit: number = 5): TopPerformer[] {
  if (!state.decks || state.decks.length === 0) {
    return [];
  }

  const performers: TopPerformer[] = state.decks
    .filter(deck => deck.placement && deck.placement > 0)
    .map(deck => ({
      player: deck.player,
      playerId: deck.playerId,
      placement: deck.placement!,
      tournamentId: deck.tournamentId,
      tournamentName: deck.tournamentName,
      tournamentPlayers: deck.tournamentPlayers,
      tournamentDate: deck.tournamentDate,
      country: deck.country,
      impressivenessScore: calculateImpressivenessScore(deck.placement!, deck.tournamentPlayers)
    }))
    .sort((performerA, performerB) => performerB.impressivenessScore - performerA.impressivenessScore);

  return performers.slice(0, limit);
}

// --- Stats Calculation ---

function calculateStats(): {
  totalDecks: number;
  tournaments: number;
  winRate: number;
  top8Rate: number;
  top16Rate: number;
} {
  if (!state.decks || state.decks.length === 0) {
    return { totalDecks: 0, tournaments: 0, winRate: 0, top8Rate: 0, top16Rate: 0 };
  }

  const totalDecks = state.decks.length;
  const uniqueTournaments = new Set(state.decks.map(deck => deck.tournamentId));
  const tournaments = uniqueTournaments.size;

  const wins = state.decks.filter(deck => deck.successTags?.includes('winner')).length;
  const top8 = state.decks.filter(deck => deck.successTags?.includes('top8')).length;
  const top16 = state.decks.filter(deck => deck.successTags?.includes('top16')).length;

  return {
    totalDecks,
    tournaments,
    winRate: totalDecks > 0 ? (wins / totalDecks) * 100 : 0,
    top8Rate: totalDecks > 0 ? (top8 / totalDecks) * 100 : 0,
    top16Rate: totalDecks > 0 ? (top16 / totalDecks) * 100 : 0
  };
}

// --- Rendering ---

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatPlacement(placement: number): string {
  if (placement === 1) {
    return '1st';
  }
  if (placement === 2) {
    return '2nd';
  }
  if (placement === 3) {
    return '3rd';
  }
  return `${placement}th`;
}

function getCountryFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) {
    return '';
  }
  // Convert country code to flag emoji
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

/**
 * Format card number with leading zeros for Limitless CDN
 */
function formatCardNumber(raw: string): string {
  const match = raw.match(/^(\d+)([A-Za-z]*)$/);
  if (!match) {
    return raw.toUpperCase();
  }
  const [, digits, suffix = ''] = match;
  return `${digits.padStart(3, '0')}${suffix.toUpperCase()}`;
}

/**
 * Build thumbnail URL for a card using Limitless CDN directly
 * Uses LG (large) size for hero banner for better quality
 */
function buildThumbnailUrl(set: string, number: string): string {
  const formattedNum = formatCardNumber(number);
  return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${set}/${set}_${formattedNum}_R_EN_LG.png`;
}

/**
 * Build fallback text from archetype name
 */
function buildFallbackText(name: string): string {
  const parts = name.replace(/_/g, ' ').split(/\s+/).filter(Boolean).slice(0, 3);
  if (!parts.length) {
    return '??';
  }
  return parts.map(word => word[0].toUpperCase()).join('');
}

/**
 * Render the hero banner with 1-2 close-up card images
 * Similar to the archetypes list page thumbnail style
 */
function renderHero(): void {
  const keyCards = resolveKeyCards();
  if (keyCards.length === 0 || !elements.heroSection || !elements.heroBannerImages) {
    // Show fallback if no cards
    if (elements.heroBannerFallback) {
      elements.heroBannerFallback.textContent = buildFallbackText(state.archetypeName);
      elements.heroBannerFallback.classList.add('is-visible');
    }
    if (elements.heroSection) {
      elements.heroSection.hidden = false;
    }
    return;
  }

  // Store first key card in state for reference
  state.keyCard = { set: keyCards[0].set, number: keyCards[0].number };

  // Clear any existing images
  elements.heroBannerImages.innerHTML = '';

  const isSplit = keyCards.length >= 2;
  let _loadedCount = 0;
  let errorCount = 0;

  const checkComplete = () => {
    if (errorCount === keyCards.length && elements.heroBannerFallback) {
      // All images failed - show fallback
      elements.heroBannerFallback.textContent = buildFallbackText(state.archetypeName);
      elements.heroBannerFallback.classList.add('is-visible');
      elements.heroBannerImages!.innerHTML = '';
    }
  };

  keyCards.slice(0, 2).forEach((card, index) => {
    const img = document.createElement('img');
    img.className = 'hero-banner-image';
    img.loading = 'eager';
    img.decoding = 'async';
    img.alt = `${card.name} - Key card for ${state.archetypeName}`;

    // Apply clip-path for split view (like archetypes page)
    if (isSplit) {
      const clipLeft = index === 0 ? '0%' : '50%';
      const clipRight = index === 0 ? '50%' : '0%';
      img.style.clipPath = `inset(0% ${clipRight} 0% ${clipLeft})`;
      img.classList.add('hero-banner-image--split');
    }

    img.onload = () => {
      _loadedCount++;
    };

    img.onerror = () => {
      errorCount++;
      img.style.display = 'none';
      checkComplete();
    };

    // Use Limitless CDN directly for reliable loading
    img.src = buildThumbnailUrl(card.set, card.number);
    elements.heroBannerImages!.appendChild(img);
  });

  if (isSplit) {
    elements.heroBannerImages.classList.add('hero-banner-images--split');
  }

  elements.heroSection.hidden = false;
}

function renderStats(): void {
  const stats = calculateStats();

  if (elements.statDecks) {
    elements.statDecks.textContent = stats.totalDecks.toLocaleString();
  }

  if (elements.statTournaments) {
    elements.statTournaments.textContent = stats.tournaments.toLocaleString();
  }

  if (elements.statWinRate) {
    elements.statWinRate.textContent = `${stats.winRate.toFixed(1)}%`;
  }

  if (elements.statTop8Rate) {
    elements.statTop8Rate.textContent = `${stats.top8Rate.toFixed(1)}%`;
  }

  if (elements.statsSection) {
    elements.statsSection.hidden = false;
  }
}

function renderTopPerformers(): void {
  const performers = getTopPerformers(5);

  if (!elements.performersList || performers.length === 0) {
    if (elements.performersSection) {
      elements.performersSection.hidden = true;
    }
    return;
  }

  elements.performersList.innerHTML = '';

  performers.forEach((performer, index) => {
    const item = document.createElement('a');
    item.className = 'performer-item';
    item.href = buildLimitlessUrl(performer.tournamentId, performer.playerId);
    item.target = '_blank';
    item.rel = 'noopener noreferrer';

    const flag = getCountryFlag(performer.country);
    const placementClass =
      performer.placement === 1
        ? 'gold'
        : performer.placement === 2
          ? 'silver'
          : performer.placement === 3
            ? 'bronze'
            : '';

    item.innerHTML = `
      <div class="performer-rank">#${index + 1}</div>
      <div class="performer-info">
        <div class="performer-player">
          ${flag ? `<span class="performer-flag">${flag}</span>` : ''}
          <span class="performer-name">${performer.player}</span>
        </div>
        <div class="performer-result">
          <span class="performer-placement ${placementClass}">${formatPlacement(performer.placement)}</span>
          <span class="performer-separator">in</span>
          <span class="performer-tournament">${performer.tournamentName}</span>
        </div>
        <div class="performer-meta">
          <span class="performer-players">${performer.tournamentPlayers} players</span>
          <span class="performer-date">${formatDate(performer.tournamentDate)}</span>
        </div>
      </div>
      <div class="performer-arrow">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </div>
    `;

    elements.performersList!.appendChild(item);
  });

  if (elements.performersSection) {
    elements.performersSection.hidden = false;
  }
}

function renderCoreCards(): void {
  if (!state.trends?.insights?.coreCards || !elements.coreCardsList) {
    if (elements.coreCardsSection) {
      elements.coreCardsSection.hidden = true;
    }
    return;
  }

  const coreCards = state.trends.insights.coreCards.slice(0, 6);
  if (coreCards.length === 0) {
    if (elements.coreCardsSection) {
      elements.coreCardsSection.hidden = true;
    }
    return;
  }

  elements.coreCardsList.innerHTML = '';

  coreCards.forEach(uid => {
    const cardData = state.trends?.cards[uid] as
      | { name: string; set: string | null; number: string | null; currentPlayrate: number }
      | undefined;
    if (!cardData) {
      return;
    }

    const item = document.createElement('div');
    item.className = 'core-card-item';

    // Build card link
    const cardUrl =
      cardData.set && cardData.number
        ? buildCardUrl(cardData.set, cardData.number)
        : `/cards?card=${encodeURIComponent(cardData.name)}`;

    // Build thumbnail
    const thumbHtml =
      cardData.set && cardData.number
        ? `<img class="core-card-thumb" src="/thumbnails/xs/${cardData.set}/${cardData.number}" alt="${cardData.name}" loading="lazy" />`
        : '';

    item.innerHTML = `
      <a href="${cardUrl}" class="core-card-link">
        ${thumbHtml}
        <span class="core-card-name">${cardData.name}</span>
        <span class="core-card-rate">${Math.round(cardData.currentPlayrate)}%</span>
      </a>
    `;

    elements.coreCardsList!.appendChild(item);
  });

  if (elements.coreCardsSection) {
    elements.coreCardsSection.hidden = false;
  }
}

function renderActions(): void {
  if (elements.actionsSection) {
    elements.actionsSection.hidden = false;
  }
}

function setPageState(status: 'loading' | 'ready' | 'error'): void {
  if (elements.page) {
    elements.page.setAttribute('data-state', status);
  }

  if (elements.loadingIndicator) {
    elements.loadingIndicator.hidden = status !== 'loading';
  }

  if (elements.errorMessage) {
    elements.errorMessage.hidden = status !== 'error';
  }
}

// --- Initialization ---

async function init(): Promise<void> {
  const archetypeName = extractArchetypeFromUrl();
  if (!archetypeName) {
    setPageState('error');
    return;
  }

  state.archetypeName = archetypeName;
  state.archetypeSlug = archetypeName.replace(/ /g, '_');

  // Update title immediately
  if (elements.title) {
    elements.title.textContent = archetypeName;
  }
  document.title = `${archetypeName} \u2013 Ciphermaniac`;

  // Update tab links
  if (elements.tabHome) {
    elements.tabHome.href = buildUrl('');
    elements.tabHome.setAttribute('aria-current', 'page');
  }
  if (elements.tabAnalysis) {
    elements.tabAnalysis.href = buildUrl('analysis');
  }
  if (elements.tabTrends) {
    elements.tabTrends.href = buildUrl('trends');
  }

  setPageState('loading');

  // Performance optimization: Progressive rendering
  // Fetch thumbnails first (from API, with built-in caching) to render hero ASAP
  // Then fetch larger data files in parallel

  // Start all fetches immediately
  const thumbnailsPromise = fetchThumbnailsFromAPI(state.archetypeName);
  const decksPromise = fetchDecksData();
  const trendsPromise = fetchTrendsData();

  // Render hero as soon as thumbnails are ready (usually from cache)
  state.thumbnails = await thumbnailsPromise;
  renderHero();

  // Wait for remaining data
  const [decks, trends] = await Promise.all([decksPromise, trendsPromise]);

  state.decks = decks;
  state.trends = trends;

  // Render remaining sections (hero may need re-render if thumbnails were empty)
  if (state.thumbnails.length === 0 && state.decks) {
    // Thumbnails not available but we have decks - try hero again with deck data
    renderHero();
  }
  renderStats();
  renderTopPerformers();
  renderCoreCards();
  renderActions();

  // Preload hero images for next visit
  preloadHeroImages();

  setPageState('ready');
}

/**
 * Preload hero images using link preload for next page visit
 */
function preloadHeroImages(): void {
  const keyCards = resolveKeyCards();
  if (keyCards.length === 0) {
    return;
  }

  // Only preload first card to avoid excessive requests
  const card = keyCards[0];
  const url = buildThumbnailUrl(card.set, card.number);

  // Check if already preloaded
  if (document.querySelector(`link[href="${url}"]`)) {
    return;
  }

  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = url;
  document.head.appendChild(link);
}

// Start
init();

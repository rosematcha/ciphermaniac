import '../utils/buildVersion.js';
import { normalizeCardRouteOnLoad } from '../router.js';
import { logger, setupGlobalErrorHandler } from '../utils/errorHandler.js';
import { getDisplayName, parseDisplayName } from './identifiers.js';
import { getCanonicalCard } from '../utils/cardSynonyms.js';
import { buildCardPath, describeSlug, makeCardSlug, parseCardRoute, resolveCardSlug } from './routing.js';
import { applyPageSeo, buildCardSchema, buildWebPageSchema } from '../utils/seo.js';
import { initCardSearch as initSearchComponent } from '../components/cardSearch.js';
import { renderMissingCardPage } from './missingCard.js';
import {
  cardIdentifier,
  cardLoadTriggered,
  cardName,
  ensureCardMetaStructure,
  markCardPerf,
  measureCardPerf,
  metaSection,
  refreshDomRefs,
  renderOnlineOnlyBanner,
  setCardIdentifier,
  setCardLoadTriggered,
  setCardName,
  setCardPageState,
  setupImmediateUI,
  syncSearchInputValue,
  updateCardTitle,
  updateSearchLink
} from './pageState.js';
import { renderProgressively, startParallelDataLoading } from './loader.js';

setupGlobalErrorHandler();

refreshDomRefs();
if (ensureCardMetaStructure()) {
  refreshDomRefs();
}

const __ROUTE_REDIRECTING = normalizeCardRouteOnLoad();
const routeInfo = parseCardRoute();
const shouldPrefillSearch = routeInfo.source === 'query' || routeInfo.source === 'hash';

const backLink = document.getElementById('back-link') as HTMLAnchorElement | null;
if (backLink) {
  backLink.href = '/';
}

let cardSearchInput: HTMLInputElement | null = null;

async function initializeCardPage() {
  if (__ROUTE_REDIRECTING) {
    return;
  }

  if (routeInfo.source === 'hash' && routeInfo.identifier) {
    const search = location.search || '';
    const target = `${buildCardPath(routeInfo.identifier)}${search}`;
    window.location.replace(target);
    return;
  }

  if (routeInfo.source === 'landing') {
    window.location.replace('/trends');
    return;
  }

  if (routeInfo.identifier) {
    setCardIdentifier(routeInfo.identifier);
  } else if (routeInfo.slug) {
    let resolvedIdentifier: string | null = null;

    const edgeData = (window as any).__CARD_EDGE_DATA;
    if (edgeData?.resolvedIdentifier) {
      ({ resolvedIdentifier } = edgeData);
    } else {
      try {
        resolvedIdentifier = await resolveCardSlug(routeInfo.slug);
      } catch (error: any) {
        logger.warn('Failed to resolve card slug', {
          slug: routeInfo.slug,
          error: error?.message || error
        });
      }
    }

    if (resolvedIdentifier) {
      setCardIdentifier(resolvedIdentifier);
    } else {
      setCardIdentifier(routeInfo.slug);
      updateCardTitle(null, describeSlug(routeInfo.slug));
    }
  }

  if (!cardIdentifier) {
    updateCardTitle(null);
    updateSearchLink();
    return;
  }

  const identifierToCanonize = cardIdentifier;
  let canonicalIdentifier = identifierToCanonize;
  try {
    const resolvedCanonical = await getCanonicalCard(identifierToCanonize);
    if (resolvedCanonical) {
      canonicalIdentifier = resolvedCanonical;
    }
  } catch (error: any) {
    logger.warn('Canonical lookup failed', {
      cardIdentifier,
      error: error?.message || error
    });
  }
  if (cardIdentifier === identifierToCanonize) {
    setCardIdentifier(canonicalIdentifier);
  }

  setCardName(getDisplayName(cardIdentifier) || cardIdentifier);
  updateCardTitle(cardName);
  updateSearchLink();
  syncSearchInputValue(cardSearchInput, shouldPrefillSearch);

  const canonicalSlug = makeCardSlug(cardIdentifier);
  if (canonicalSlug) {
    const desiredPath = buildCardPath(cardIdentifier);
    if (location.pathname !== desiredPath || location.hash) {
      const newUrl = `${desiredPath}${location.search || ''}`;
      history.replaceState(null, '', newUrl);
    }
  } else if (location.hash) {
    history.replaceState(null, '', `${location.pathname}${location.search || ''}`);
  }

  const parsed = cardName ? parseDisplayName(cardName) : null;
  const canonicalPath = buildCardPath(cardIdentifier);
  const cardLabel = parsed?.name || cardName || cardIdentifier;
  const seoTitle = `${cardLabel} Card Stats - Pokemon TCG | Ciphermaniac`;
  const seoDescription = `Usage trends, deck inclusion, and pricing context for ${cardLabel} in the Pokemon TCG.`;
  const absoluteCanonical = new URL(canonicalPath, window.location.origin).toString();

  const isAlternateRoute =
    routeInfo.source === 'query' || routeInfo.source === 'hash' || window.location.search.length > 0;

  applyPageSeo({
    title: seoTitle,
    description: seoDescription,
    canonicalPath,
    structuredData: [
      buildWebPageSchema(seoTitle, seoDescription, absoluteCanonical),
      buildCardSchema(cardLabel, absoluteCanonical, parsed?.setId || null)
    ],
    breadcrumbs: [
      { name: 'Home', url: `${window.location.origin}/` },
      { name: 'Cards', url: `${window.location.origin}/cards` },
      { name: cardLabel, url: absoluteCanonical }
    ],
    robots: isAlternateRoute ? 'noindex, follow' : 'index, follow'
  });

  await load();
}

async function load() {
  if (cardLoadTriggered) {
    return;
  }
  setCardLoadTriggered(true);
  markCardPerf('card:load-start');
  ensureCardMetaStructure();
  refreshDomRefs();
  setCardPageState('loading');

  if (!cardIdentifier) {
    if (metaSection) {
      metaSection.textContent = 'Missing card identifier.';
    }
    setCardPageState('error');
    return;
  }

  setupImmediateUI();
  markCardPerf('card:immediate-ui');

  const dataPromises = startParallelDataLoading();

  const dataResult = await renderProgressively(dataPromises);
  markCardPerf('card:data-ready');

  if (dataResult === false) {
    setCardPageState('missing');
    markCardPerf('card:missing');
    measureCardPerf('card:ttm-missing', 'card:load-start', 'card:missing');

    const fadeTargets = [
      document.getElementById('card-chart'),
      document.getElementById('card-copies'),
      document.getElementById('card-events')
    ];
    fadeTargets.forEach(el => {
      if (el) {
        el.style.transition = 'opacity 0.15s ease-out';
        el.style.opacity = '0';
      }
    });

    const analysisSection = document.getElementById('card-analysis');
    if (analysisSection) {
      analysisSection.style.display = 'none';
    }

    const hero = document.getElementById('card-hero');
    const existingHeroImg = hero?.querySelector('img') as HTMLImageElement | null;

    const transitionTarget = fadeTargets.find(el => el != null);
    if (transitionTarget) {
      await Promise.race([
        new Promise<void>(r => {
          transitionTarget!.addEventListener('transitionend', () => r(), { once: true });
        }),
        new Promise<void>(r => {
          setTimeout(r, 200);
        })
      ]);
    }
    await renderMissingCardPage(cardIdentifier, metaSection, { smooth: true, existingHeroImg });
    return;
  }

  if (dataResult === 'online') {
    renderOnlineOnlyBanner();
    markCardPerf('card:online-only');
  }

  setCardPageState('ready');
  markCardPerf('card:ready');
  measureCardPerf('card:ttm-ready', 'card:load-start', 'card:ready');
  measureCardPerf('card:ttm-data', 'card:load-start', 'card:data-ready');
}

initializeCardPage().catch(error => logger.error('Failed to initialize card page', error));

function initCardSearch() {
  initSearchComponent({
    searchInputId: 'card-search',
    datalistId: 'card-names',
    suggestionsId: 'card-suggestions'
  });

  cardSearchInput = document.getElementById('card-search') as HTMLInputElement | null;
  syncSearchInputValue(cardSearchInput, shouldPrefillSearch);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCardSearch);
} else {
  initCardSearch();
}

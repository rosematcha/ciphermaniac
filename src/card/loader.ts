import {
  buildCardIndexFromMaster,
  fetchArchetypeReport,
  fetchArchetypesList,
  fetchReport,
  fetchTop8ArchetypesList,
  fetchTournamentsList,
  ONLINE_META_NAME
} from '../api.js';
import { parseReport } from '../parse.js';
import { buildThumbCandidates } from '../thumbs.js';
import { baseToLabel, pickArchetype } from '../selectArchetype.js';
import { logger } from '../utils/errorHandler.js';
import { getBaseName, getDisplayName, parseDisplayName } from './identifiers.js';
import { findCard, findCardInReport, renderCardPrice } from './data.js';
import { renderChart, renderCopiesHistogram, renderEvents, renderOnlineStatCard } from './charts.js';
import { getCanonicalCard, getCardVariants } from '../utils/cardSynonyms.js';
import { renderAnalysisSelector } from './analysis.js';
import { processInParallel } from '../utils/parallelLoader.js';
import { extractCardMeta, renderExternalLinks } from './insights.js';
import {
  cardIdentifier,
  cardName,
  centerSection,
  chartSection,
  copiesSection,
  decksSection,
  ensureCardMetaStructure,
  eventsSection,
  metaSection,
  refreshDomRefs,
  retryHeroImage,
  setCardName,
  setupImmediateUI,
  syncSearchInputValue,
  updateCardTitle,
  updateSearchLink
} from './pageState.js';

export function startParallelDataLoading() {
  const tournamentsPromise = fetchTournamentsList().catch(() => ['2025-08-15, World Championships 2025']);
  const overridesPromise = Promise.resolve({});
  const cardPricePromise = cardIdentifier ? renderCardPrice(cardIdentifier).catch(() => null) : Promise.resolve(null);
  const onlineReportPromise = fetchReport(ONLINE_META_NAME, 'all', { skipSqlite: true }).catch(() => null);

  return {
    tournaments: tournamentsPromise,
    overrides: overridesPromise,
    cardPrice: cardPricePromise,
    onlineReport: onlineReportPromise
  };
}

export type CardDataResult = boolean | 'online';

export async function renderProgressively(dataPromises: any): Promise<CardDataResult> {
  let tournaments: string[] = [];
  try {
    tournaments = await dataPromises.tournaments;
  } catch {
    tournaments = ['2025-08-15, World Championships 2025'];
  }
  if (!Array.isArray(tournaments) || tournaments.length === 0) {
    tournaments = ['2025-08-15, World Championships 2025'];
  }

  dataPromises.overrides
    .then(async (overrides: any) => {
      const hero = document.getElementById('card-hero');
      const img = hero?.querySelector('img');
      if (hero && img && cardName && img.style.opacity === '0' && (img as any)._loadingState) {
        const { name, setId } = parseDisplayName(cardName);
        let variant: any = {};
        if (setId) {
          const setMatch = setId.match(/^([A-Z]+)\s+(\d+[A-Za-z]?)$/);
          if (setMatch) {
            variant = { set: setMatch[1], number: setMatch[2] };
          }
        }
        const enhancedCandidates = buildThumbCandidates(name, true, overrides, variant);
        const state = (img as any)._loadingState;

        if (state.idx === 0 || (state.idx >= state.candidates.length && !state.loading && !state.fallbackAttempted)) {
          state.candidates = enhancedCandidates;
          state.idx = 0;
          state.loading = false;
          state.fallbackAttempted = false;

          if (state.idx < state.candidates.length && !state.loading) {
            state.loading = true;
            img.src = state.candidates[state.idx++];
          }
        }
      }
    })
    .catch(() => {
      // Keep default candidates on override failure
    });

  const CACHE_KEY = 'metaCacheV1';
  const META_CACHE_MAX = 200;
  const cache = (() => {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    } catch {
      return {};
    }
  })();
  const saveCache = () => {
    try {
      const keys = Object.keys(cache);
      if (keys.length > META_CACHE_MAX) {
        for (const k of keys.slice(0, keys.length - META_CACHE_MAX)) {
          delete cache[k];
        }
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Ignore quota errors
    }
  };

  return loadAndRenderMainContent(tournaments, cache, saveCache, dataPromises.onlineReport);
}

async function loadAndRenderMainContent(
  tournaments: string[],
  cacheObject: any,
  saveCache: () => void,
  onlineReportPromise?: Promise<any>
): Promise<CardDataResult> {
  const PROCESS_LIMIT = 6;
  const recentTournaments = tournaments.slice(0, PROCESS_LIMIT);

  const timePoints: any[] = [];
  const deckRows: any[] = [];
  const eventsWithCard: string[] = [];

  let sharedCanonical: string | null = null;
  let sharedVariants: string[] | null = null;
  const getSharedVariants = async () => {
    if (!sharedCanonical) {
      sharedCanonical = await getCanonicalCard(cardIdentifier!);
      sharedVariants = await getCardVariants(sharedCanonical);
    }
    return { canonical: sharedCanonical, variants: sharedVariants! };
  };

  const tournamentPromises = recentTournaments.map(async tournamentName => {
    try {
      const ck = `${tournamentName}::${cardIdentifier}`;
      let globalPct: number | null = null;
      let globalFound: number | null = null;
      let globalTotal: number | null = null;
      let globalDist: any[] | null = null;
      let cardMetaObj: any = null;
      if (cacheObject[ck]) {
        ({ pct: globalPct, found: globalFound, total: globalTotal } = cacheObject[ck]);
        if (cacheObject[ck].meta) {
          cardMetaObj = cacheObject[ck].meta;
        }
      } else {
        let card: any = null;
        const hasUID = cardIdentifier && cardIdentifier.includes('::');

        if (!hasUID) {
          try {
            const report = await fetchReport(tournamentName, 'all', { skipSqlite: true });
            const idx = buildCardIndexFromMaster(report);
            const baseName = getBaseName(cardIdentifier!) || '';
            const matchingKey =
              Object.keys(idx.cards || {}).find(k => k.toLowerCase() === baseName.toLowerCase()) || '';
            const entry = idx.cards?.[baseName] || idx.cards?.[matchingKey];
            if (entry) {
              card = {
                name: baseName,
                found: entry.found,
                total: entry.total,
                pct: entry.pct,
                dist: entry.dist
              };
              const rawItem = (report as any)?.items?.find(
                (it: any) => it.name?.toLowerCase() === baseName.toLowerCase()
              );
              if (rawItem) {
                card.category = rawItem.category;
                card.trainerType = rawItem.trainerType;
                card.energyType = rawItem.energyType;
                card.aceSpec = rawItem.aceSpec;
                card.regulationMark = rawItem.regulationMark;
                card.supertype = rawItem.supertype;
                card.rank = rawItem.rank;
              }
            }
          } catch {
            // Ignore initialization errors
          }
        }

        if (!card) {
          const { canonical, variants } = await getSharedVariants();

          const master = await fetchReport(tournamentName, 'all', { skipSqlite: true });
          const parsed = parseReport(master);

          let combinedFound = 0;
          let combinedTotal: number | null = null;
          let hasAnyData = false;
          const combinedDist: any[] = [];
          let firstVariantCard: any = null;

          for (const variant of variants) {
            const variantCard = findCard(parsed.items, variant);
            if (variantCard) {
              hasAnyData = true;
              if (!firstVariantCard) {
                firstVariantCard = variantCard;
              }
              if (Number.isFinite(variantCard.found)) {
                combinedFound += variantCard.found;
              }
              if (combinedTotal === null && Number.isFinite(variantCard.total)) {
                combinedTotal = variantCard.total;
              }
              if (variantCard.dist && Array.isArray(variantCard.dist)) {
                for (const distEntry of variantCard.dist) {
                  const existing = combinedDist.find(distItem => distItem.copies === distEntry.copies);
                  if (existing) {
                    existing.players += distEntry.players || 0;
                  } else {
                    combinedDist.push({ copies: distEntry.copies, players: distEntry.players || 0 });
                  }
                }
              }
            }
          }

          if (hasAnyData && combinedTotal !== null) {
            card = {
              name: getDisplayName(canonical),
              found: combinedFound,
              total: combinedTotal,
              pct: combinedTotal > 0 ? (100 * combinedFound) / combinedTotal : 0,
              dist: combinedDist.sort((a: any, b: any) => a.copies - b.copies),
              ...(firstVariantCard
                ? {
                    category: firstVariantCard.category,
                    trainerType: firstVariantCard.trainerType,
                    energyType: firstVariantCard.energyType,
                    aceSpec: firstVariantCard.aceSpec,
                    regulationMark: firstVariantCard.regulationMark,
                    supertype: firstVariantCard.supertype,
                    rank: firstVariantCard.rank
                  }
                : {})
            };
          }
        }
        if (card) {
          globalPct = Number.isFinite(card.pct) ? card.pct : card.total ? (100 * card.found) / card.total : 0;
          globalFound = Number.isFinite(card.found) ? card.found : null;
          globalTotal = Number.isFinite(card.total) ? card.total : null;
          globalDist = card.dist || null;
          cardMetaObj = extractCardMeta(card);
          const cacheEntry = {
            pct: globalPct,
            found: globalFound,
            total: globalTotal,
            meta: cardMetaObj
          };
          Object.assign(cacheObject, { [ck]: cacheEntry });
          saveCache();
        }
      }
      if (globalPct !== null) {
        return {
          tournament: tournamentName,
          pct: globalPct,
          found: globalFound,
          total: globalTotal,
          dist: globalDist,
          cardMeta: cardMetaObj
        };
      }
      return null;
    } catch {
      return null;
    }
  });

  const tournamentResults = await Promise.all(tournamentPromises);

  let latestCardMeta: any = null;
  tournamentResults.forEach(result => {
    if (result) {
      timePoints.push({ tournament: result.tournament, pct: result.pct });
      eventsWithCard.push(result.tournament);
      deckRows.push({
        tournament: result.tournament,
        archetype: null,
        pct: result.pct,
        found: result.found,
        total: result.total,
        dist: result.dist
      });
      if (!latestCardMeta && result.cardMeta) {
        latestCardMeta = result.cardMeta;
      }
    }
  });

  let isOnlineOnly = false;
  if (timePoints.length === 0 && onlineReportPromise) {
    try {
      const onlineData = await onlineReportPromise;
      if (onlineData) {
        const variants = sharedVariants || [cardIdentifier!];
        const canonical = sharedCanonical || cardIdentifier!;
        const result = findCardInReport(onlineData, cardIdentifier!, variants, canonical);
        if (result) {
          isOnlineOnly = true;
          timePoints.push({ tournament: ONLINE_META_NAME, pct: result.pct });
          eventsWithCard.push(ONLINE_META_NAME);
          deckRows.push({
            tournament: ONLINE_META_NAME,
            archetype: null,
            pct: result.pct,
            found: result.found,
            total: result.total,
            dist: result.dist
          });
          if (!latestCardMeta && result.meta) {
            latestCardMeta = result.meta;
          }
          if (result.resolvedName && result.resolvedName !== cardIdentifier) {
            setCardName(result.resolvedName);
            updateCardTitle(cardName);
            updateSearchLink();
            retryHeroImage(cardName!);
          }
        }
      }
    } catch {
      // Online meta unavailable
    }
  }

  const refLinksSlot = document.getElementById('card-ref-links-slot');
  if (refLinksSlot && cardIdentifier && cardName) {
    renderExternalLinks(refLinksSlot, cardIdentifier, cardName).catch(() => {});
  }

  const LIMIT = 6;
  const showAll = false;

  const PICK_CACHE_KEY = 'archPickV2';
  const PICK_CACHE_MAX = 300;
  const pickCache = (() => {
    try {
      return JSON.parse(localStorage.getItem(PICK_CACHE_KEY) || '{}');
    } catch {
      return {};
    }
  })();
  const savePickCache = () => {
    try {
      const keys = Object.keys(pickCache);
      if (keys.length > PICK_CACHE_MAX) {
        for (const k of keys.slice(0, keys.length - PICK_CACHE_MAX)) {
          delete pickCache[k];
        }
      }
      localStorage.setItem(PICK_CACHE_KEY, JSON.stringify(pickCache));
    } catch {
      // Ignore quota errors
    }
  };

  async function chooseArchetypeForTournament(tournament: string) {
    const ck = `${tournament}::${cardIdentifier}`;
    if (pickCache[ck]) {
      return pickCache[ck];
    }
    try {
      const list = await fetchArchetypesList(tournament);
      const archetypeBases = Array.isArray(list)
        ? list.map(entry => (typeof entry === 'string' ? entry : entry?.name)).filter(Boolean)
        : [];
      const top8 = await fetchTop8ArchetypesList(tournament);
      const candidates: any[] = [];
      const { variants } = await getSharedVariants();

      await processInParallel(
        archetypeBases,
        async base => {
          const arc = await fetchArchetypeReport(tournament, base);
          const parsedReport = parseReport(arc);

          let combinedFound = 0;
          let combinedTotal: number | null = null;
          let hasAnyData = false;

          for (const variant of variants) {
            const variantCardInfo = findCard(parsedReport.items, variant);
            if (variantCardInfo) {
              hasAnyData = true;
              if (Number.isFinite(variantCardInfo.found)) {
                combinedFound += variantCardInfo.found;
              }
              if (combinedTotal === null && Number.isFinite(variantCardInfo.total)) {
                combinedTotal = variantCardInfo.total;
              }
            }
          }

          if (hasAnyData && combinedTotal !== null) {
            const pct = combinedTotal > 0 ? (100 * combinedFound) / combinedTotal : 0;
            candidates.push({
              base,
              pct,
              found: combinedFound,
              total: combinedTotal
            });
          }
          return null;
        },
        { concurrency: 4, onError: 'continue', retryAttempts: 0 }
      );
      const overallUsage = cacheObject[`${tournament}::${cardIdentifier}`]?.pct || 0;
      const minTotal = overallUsage > 20 ? 1 : 3;
      const chosen = pickArchetype(candidates, top8 || undefined, { minTotal });
      const label = chosen ? baseToLabel(chosen.base) : null;
      pickCache[ck] = label;
      savePickCache();
      return label;
    } catch {
      return null;
    }
  }

  const renderToggles = () => {
    // Removed all toggle notes
  };

  const refresh = () => {
    const rebuiltStructure = ensureCardMetaStructure();
    refreshDomRefs();

    if (rebuiltStructure) {
      updateCardTitle(cardName);
      updateSearchLink();
      syncSearchInputValue(null, false);
      try {
        setupImmediateUI();
      } catch (error: any) {
        logger.debug('Failed to re-run immediate UI after rebuilding structure', error?.message || error);
      }
      if (cardIdentifier) {
        renderCardPrice(cardIdentifier).catch(() => {});
      }
    }

    const ptsAll = [...timePoints].reverse();
    const rowsAll = [...deckRows].reverse();
    const pts = showAll ? ptsAll : ptsAll.slice(-LIMIT);
    const rows = showAll ? rowsAll : rowsAll.slice(-LIMIT);

    let chartContainer = chartSection;
    if (!chartContainer) {
      const cardCenter = centerSection || metaSection;
      chartContainer = document.createElement('div');
      chartContainer.id = 'card-chart';
      chartContainer.className = 'card-chart skeleton-loading';
      if (cardCenter) {
        cardCenter.insertBefore(chartContainer, cardCenter.firstChild || null);
      } else if (metaSection) {
        metaSection.appendChild(chartContainer);
      }
      refreshDomRefs();
    }
    if (chartContainer) {
      if (isOnlineOnly && pts.length === 1 && rows.length > 0) {
        const row = rows[rows.length - 1];
        renderOnlineStatCard(chartContainer, row.pct || 0, row.total || 0, row.found || 0);
      } else {
        renderChart(chartContainer, pts);
      }
    }

    const copiesTarget = copiesSection;
    if (copiesTarget) {
      const latest = rows[rows.length - 1];
      if (latest && latest.dist && Array.isArray(latest.dist) && latest.dist.length > 0) {
        renderCopiesHistogram(copiesTarget, {
          dist: latest.dist,
          total: latest.total || 0
        });
      } else if (latest) {
        (async () => {
          try {
            const { variants } = await getSharedVariants();
            const master = await fetchReport(latest.tournament, 'all', { skipSqlite: true });
            const parsed = parseReport(master);

            let combinedFound = 0;
            let combinedTotal: number | null = null;
            const combinedDist: any[] = [];

            for (const variant of variants) {
              const variantCard = findCard(parsed.items, variant);
              if (variantCard) {
                if (Number.isFinite(variantCard.found)) {
                  combinedFound += variantCard.found;
                }
                if (combinedTotal === null && Number.isFinite(variantCard.total)) {
                  combinedTotal = variantCard.total;
                }
                if (variantCard.dist && Array.isArray(variantCard.dist)) {
                  for (const distEntry of variantCard.dist) {
                    const existing = combinedDist.find(distItem => distItem.copies === distEntry.copies);
                    if (existing) {
                      existing.players += distEntry.players || 0;
                    } else {
                      combinedDist.push({ copies: distEntry.copies, players: distEntry.players || 0 });
                    }
                  }
                }
              }
            }

            if (combinedFound > 0 && combinedTotal !== null) {
              renderCopiesHistogram(copiesTarget, {
                dist: combinedDist.sort((a: any, b: any) => a.copies - b.copies),
                total: combinedTotal
              });
            } else {
              copiesTarget.textContent = '';
            }
          } catch {
            copiesTarget.textContent = '';
          }
        })();
      } else {
        copiesTarget.textContent = '';
      }
    }

    let eventsTarget = eventsSection;
    if (!eventsTarget && metaSection) {
      eventsTarget = document.createElement('div');
      eventsTarget.id = 'card-events';
      metaSection.appendChild(eventsTarget);
      refreshDomRefs();
      eventsTarget = eventsSection;
    }

    renderEvents(eventsTarget || decksSection || metaSection || document.body, rows);
    renderToggles();
    renderAnalysisSelector(eventsWithCard, cardIdentifier);

    const tableContainer = eventsSection || decksSection;
    if (tableContainer && !(tableContainer as any)._hoverPrefetchAttached) {
      tableContainer.addEventListener('mouseover', async eventTarget => {
        const targetElement = eventTarget.target instanceof HTMLElement ? eventTarget.target : null;
        const rowEl = targetElement ? targetElement.closest('.event-row') : null;
        if (!rowEl) {
          return;
        }
        const tournamentFromRow = (rowEl as HTMLElement).dataset.tournament;
        if (!tournamentFromRow) {
          return;
        }
        const target = deckRows.find(deckRow => deckRow.tournament === tournamentFromRow);
        if (target && !target.archetype) {
          const label = await chooseArchetypeForTournament(tournamentFromRow);
          if (label) {
            target.archetype = label;
            const eventsToRender = showAll ? [...deckRows].reverse() : [...deckRows].reverse().slice(-LIMIT);
            renderEvents(tableContainer, eventsToRender);
            renderToggles();
          }
        }
      });
      (tableContainer as any)._hoverPrefetchAttached = true;
    }
  };
  refresh();

  let resizeTimer: any = null;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    const currentWidth = window.innerWidth;
    if (Math.abs(currentWidth - lastWidth) < 50) {
      return;
    }

    if (resizeTimer) {
      return;
    }

    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      lastWidth = window.innerWidth;
      const elementToRender = chartSection || metaSection;
      const pointsToRender = showAll ? [...timePoints].reverse() : [...timePoints].reverse().slice(-LIMIT);
      if (elementToRender) {
        if (isOnlineOnly && pointsToRender.length === 1) {
          return;
        }
        renderChart(elementToRender, pointsToRender);
      }
    }, 200);
  });

  const hasData = deckRows.length > 0 || timePoints.length > 0 || eventsWithCard.length > 0;
  if (!hasData) {
    return false;
  }
  return isOnlineOnly ? 'online' : true;
}

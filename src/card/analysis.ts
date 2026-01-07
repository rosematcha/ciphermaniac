/**
 * Analysis table functionality for card page
 * Renders per-archetype usage breakdowns for a card
 */
import { fetchArchetypeReport, fetchArchetypesList, fetchReport } from '../api.js';
import { parseReport } from '../parse.js';
import { findCard } from './data.js';
import { getDisplayName } from './identifiers.js';
import { getCanonicalCard, getCardVariants } from '../utils/cardSynonyms.js';
import { cleanupOrphanedProgressDisplay, createProgressIndicator, processInParallel } from '../utils/parallelLoader.js';
import { logger } from '../utils/errorHandler.js';

/**
 * Renders the analysis event selector dropdown and initializes the analysis table
 * @param events - List of tournament names that have data for this card
 * @param cardIdentifier - The current card identifier
 */
export function renderAnalysisSelector(events: string[], cardIdentifier: string | null): void {
  const analysisSel = document.getElementById('analysis-event') as HTMLSelectElement | null;
  const analysisTable = document.getElementById('analysis-table') as HTMLElement | null;

  if (!(analysisSel && analysisTable)) {
    return;
  }

  analysisSel.innerHTML = '';

  if (!events || events.length === 0) {
    analysisTable.textContent = 'Select an event to view per-archetype usage.';
    return;
  }

  for (const tournamentName of events) {
    const opt = document.createElement('option');
    opt.value = tournamentName;
    opt.textContent = tournamentName;
    analysisSel.appendChild(opt);
  }

  // Store cardIdentifier in a data attribute for the change handler
  analysisSel.dataset.cardIdentifier = cardIdentifier || '';

  analysisSel.addEventListener('change', () => {
    renderAnalysisTable(analysisSel.value, analysisSel.dataset.cardIdentifier || null);
  });

  renderAnalysisTable(analysisSel.value || events[0], cardIdentifier);
}

/**
 * Renders the per-archetype usage analysis table for a specific tournament
 * @param tournament - Tournament name to analyze
 * @param cardIdentifier - The card identifier to analyze
 */
export async function renderAnalysisTable(tournament: string, cardIdentifier: string | null): Promise<void> {
  const analysisTable = document.getElementById('analysis-table') as HTMLElement | null;

  if (!analysisTable) {
    return;
  }

  // Create wrapper with relative positioning for overlay loading indicator
  const loadingWrapper = document.createElement('div');
  loadingWrapper.className = 'analysis-loading-wrapper';
  loadingWrapper.style.cssText = 'position: relative; min-height: 200px;';

  // Show loading state with skeleton (provides reserved space)
  const loadingSkeleton = document.createElement('div');
  loadingSkeleton.className = 'skeleton-analysis-loading';
  loadingSkeleton.setAttribute('aria-hidden', 'true');
  loadingSkeleton.style.cssText = 'opacity: 0.3;'; // Dimmed to show loading overlay on top
  loadingSkeleton.innerHTML = `
    <div class="skeleton-text medium" style="margin-bottom: 8px;"></div>
    <div class="skeleton-text large" style="margin-bottom: 16px;"></div>
    <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 8px;">
      <div class="skeleton-text small"></div>
      <div class="skeleton-text small"></div>
      <div class="skeleton-text small"></div>
      <div class="skeleton-text small"></div>
      <div class="skeleton-text small"></div>
      <div class="skeleton-text small"></div>
    </div>
    ${Array(5)
      .fill(0)
      .map(
        () => `
      <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 4px;">
        <div class="skeleton-text medium"></div>
        <div class="skeleton-text small"></div>
        <div class="skeleton-text small"></div>
        <div class="skeleton-text small"></div>
        <div class="skeleton-text small"></div>
        <div class="skeleton-text small"></div>
      </div>
    `
      )
      .join('')}
  `;

  // Create overlay container for the progress indicator
  const progressOverlay = document.createElement('div');
  progressOverlay.className = 'analysis-progress-overlay';
  progressOverlay.style.cssText = `
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--panel);
    opacity: 0.95;
    z-index: 5;
    border-radius: 8px;
  `;

  // Create progress indicator inside the overlay
  // This restores the status bars and steps the user liked
  const progress = createProgressIndicator(
    'Loading Archetype Analysis',
    ['Processing archetype data', 'Building analysis table'],
    {
      position: 'relative', // Relative to the overlay flex container
      container: progressOverlay,
      autoRemove: true,
      showPercentage: true
    }
  );

  // Assemble: skeleton + overlay inside wrapper
  loadingWrapper.appendChild(loadingSkeleton);
  loadingWrapper.appendChild(progressOverlay);

  analysisTable.innerHTML = '';
  analysisTable.appendChild(loadingWrapper);

  try {
    // Overall (All archetypes) distribution for this event
    let overall: any = null;
    try {
      const master = await fetchReport(tournament);
      const parsed = parseReport(master);

      // Get canonical card and all its variants for combined usage statistics
      const canonical = await getCanonicalCard(cardIdentifier!);
      const variants = await getCardVariants(canonical);

      // Combine data from all variants
      let combinedFound = 0;
      let combinedTotal: number | null = null;
      const combinedDist: any[] = [];
      let hasAnyData = false;

      for (const variant of variants) {
        const variantCard = findCard(parsed.items, variant);
        if (variantCard) {
          hasAnyData = true;
          if (Number.isFinite(variantCard.found)) {
            combinedFound += variantCard.found;
          }
          if (combinedTotal === null && Number.isFinite(variantCard.total)) {
            combinedTotal = variantCard.total;
          }

          // Combine distribution data
          if (variantCard.dist && Array.isArray(variantCard.dist)) {
            for (const distEntry of variantCard.dist) {
              const existing = combinedDist.find(distItem => distItem.copies === distEntry.copies);
              if (existing) {
                existing.players += distEntry.players || 0;
              } else {
                combinedDist.push({
                  copies: distEntry.copies,
                  players: distEntry.players || 0
                });
              }
            }
          }
        }
      }

      if (hasAnyData && combinedTotal !== null) {
        overall = {
          name: getDisplayName(canonical),
          found: combinedFound,
          total: combinedTotal,
          pct: combinedTotal > 0 ? (100 * combinedFound) / combinedTotal : 0,
          dist: combinedDist.sort((first, second) => first.copies - second.copies)
        };
      }
    } catch {
      /* ignore */
    }

    // Per-archetype distributions using enhanced parallel loading
    const list = await fetchArchetypesList(tournament);
    const archetypeBases = Array.isArray(list)
      ? list.map(entry => (typeof entry === 'string' ? entry : entry?.name)).filter(Boolean)
      : [];

    progress.updateStep(0, 'loading');

    // Get canonical card and all its variants for combined usage statistics
    const canonical = await getCanonicalCard(cardIdentifier!);
    const variants = await getCardVariants(canonical);

    // Use parallel processing utility for better performance
    const archetypeResults = await processInParallel(
      archetypeBases,
      async base => {
        try {
          const archetypeReport = await fetchArchetypeReport(tournament, base);
          const parsedReport = parseReport(archetypeReport);

          // Combine data from all variants for this archetype
          let combinedFound = 0;
          let combinedTotal: number | null = null;
          const combinedDist: any[] = [];
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

              // Combine distribution data
              if (variantCardInfo.dist && Array.isArray(variantCardInfo.dist)) {
                for (const distEntry of variantCardInfo.dist) {
                  const existing = combinedDist.find(distItem => distItem.copies === distEntry.copies);
                  if (existing) {
                    existing.players += distEntry.players || 0;
                  } else {
                    combinedDist.push({
                      copies: distEntry.copies,
                      players: distEntry.players || 0
                    });
                  }
                }
              }
            }
          }

          if (hasAnyData && combinedTotal !== null) {
            // For high-usage cards (>20%), include single-deck archetypes to show distribution
            const overallItem = overall || {};
            const overallPct = overallItem.total ? (100 * overallItem.found) / overallItem.total : overallItem.pct || 0;
            const minSample = overallPct > 20 ? 1 : 2; // Lower threshold for high-usage cards

            if (combinedTotal >= minSample) {
              const percentage = combinedTotal > 0 ? (100 * combinedFound) / combinedTotal : 0;

              // Precompute percent of all decks in archetype by copies
              const copiesPct = (numberOfCopies: number) => {
                if (!Array.isArray(combinedDist) || !(combinedTotal! > 0)) {
                  return null;
                }
                const distribution = combinedDist.find(distItem => distItem.copies === numberOfCopies);
                if (!distribution) {
                  return 0;
                }
                return (100 * (distribution.players ?? 0)) / combinedTotal!;
              };

              return {
                archetype: base.replace(/_/g, ' '),
                pct: percentage,
                found: combinedFound,
                total: combinedTotal,
                c1: copiesPct(1),
                c2: copiesPct(2),
                c3: copiesPct(3),
                c4: copiesPct(4)
              };
            }
          }
          return null;
        } catch {
          return null; // missing archetype
        }
      },
      {
        concurrency: 6, // Reasonable limit to avoid overwhelming the server
        onProgress: (processed, total) => {
          progress.updateProgress(processed, total, `${processed}/${total} archetypes processed`);
        }
      }
    );

    // Filter out null results
    const rows = archetypeResults.filter((result): result is NonNullable<typeof result> => result !== null);

    progress.updateStep(0, 'complete', `Processed ${rows.length} archetypes with data`);
    progress.updateStep(1, 'loading');

    rows.sort((archA, archB) => {
      // Primary sort: actual deck count (found)
      const foundDiff = (archB.found ?? 0) - (archA.found ?? 0);
      if (foundDiff !== 0) {
        return foundDiff;
      }

      // Secondary sort: deck popularity (total) when found counts are equal
      const totalDiff = (archB.total ?? 0) - (archA.total ?? 0);
      if (totalDiff !== 0) {
        return totalDiff;
      }

      // Tertiary sort: alphabetical by archetype name
      return archA.archetype.localeCompare(archB.archetype);
    });

    // Fade out existing content before replacing
    analysisTable.style.transition = 'opacity 0.1s ease-out';
    analysisTable.style.opacity = '0';

    // Wait for fade out, then rebuild
    await new Promise(resolve => {
      setTimeout(resolve, 100);
    });

    analysisTable.innerHTML = '';

    // Per-archetype table
    if (rows.length === 0) {
      const note = document.createElement('div');
      note.className = 'summary';
      note.textContent = 'No per-archetype usage found for this event (or all archetypes have only one deck).';
      analysisTable.appendChild(note);

      progress.updateStep(1, 'complete');
      progress.setComplete(500); // Show for half a second then fade

      // Fade in the empty state
      requestAnimationFrame(() => {
        analysisTable.style.opacity = '1';
      });
      return;
    }
    const tbl = document.createElement('table');
    tbl.style.width = '100%';
    tbl.style.borderCollapse = 'collapse';
    tbl.style.background = 'var(--panel)';
    tbl.style.border = '1px solid #242a4a';
    tbl.style.borderRadius = '8px';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    ['Archetype', 'Played %', '1x', '2x', '3x', '4x'].forEach((header, i) => {
      const th = document.createElement('th');
      th.textContent = header;
      if (header === 'Played %') {
        th.title = 'Percent of decks in the archetype that ran the card (any copies).';
      }
      if (['1x', '2x', '3x', '4x'].includes(header)) {
        th.title = `Percent of decks in the archetype that ran exactly ${header}`;
      }
      th.style.textAlign = i > 0 && i < 6 ? 'right' : 'left';
      th.style.padding = '10px 12px';
      th.style.borderBottom = '1px solid #2c335a';
      th.style.color = 'var(--muted)';
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    tbl.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const rowData of rows) {
      const tableRow = document.createElement('tr');
      const formatValue = (value: number | null) => (value === null ? '—' : `${Math.round(value)}%`);

      const archetypeDeckCount = rowData.total !== null ? rowData.total : rowData.found !== null ? rowData.found : null;
      const firstCell = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = rowData.archetype;
      firstCell.appendChild(strong);
      if (archetypeDeckCount !== null) {
        firstCell.appendChild(document.createTextNode(` (${archetypeDeckCount})`));
      }
      firstCell.style.padding = '10px 12px';
      firstCell.style.textAlign = 'left';
      tableRow.appendChild(firstCell);

      const otherValues = [
        rowData.pct !== null ? `${Math.round(rowData.pct)}%` : '—',
        formatValue(rowData.c1),
        formatValue(rowData.c2),
        formatValue(rowData.c3),
        formatValue(rowData.c4)
      ];

      otherValues.forEach((valueText, valueIndex) => {
        const tableCell = document.createElement('td');
        tableCell.textContent = valueText;

        if (valueIndex === 0) {
          tableCell.title = 'Played % = (decks with the card / total decks in archetype)';
        }
        if (valueIndex >= 1 && valueIndex <= 4) {
          const numberOfCopies = valueIndex;
          tableCell.title = `Percent of decks in archetype that ran exactly ${numberOfCopies}x`;
        }

        if (typeof valueText === 'string') {
          const percentageMatch = valueText.match(/^\s*(\d+)%$/);
          if (percentageMatch && Number(percentageMatch[1]) === 0) {
            tableCell.classList.add('zero-pct');
          }
        }

        tableCell.style.padding = '10px 12px';
        tableCell.style.textAlign = 'right';
        tableRow.appendChild(tableCell);
      });

      tbody.appendChild(tableRow);
    }
    tbl.appendChild(tbody);
    analysisTable.appendChild(tbl);

    // Fade in the new table content
    requestAnimationFrame(() => {
      analysisTable.style.opacity = '1';
    });

    // Make table header sticky via a floating cloned header as a fallback when CSS sticky doesn't work
    // This ensures the header row stays visible even if ancestor overflow/transform prevents CSS sticky.
    try {
      enableFloatingTableHeader(tbl);
    } catch (err) {
      // Non-fatal: if anything goes wrong, don't block rendering
      logger.debug('enableFloatingTableHeader failed:', err);
    }

    progress.updateStep(1, 'complete', `Built table with ${rows.length} archetypes`);
    progress.setComplete(500); // Show for half a second then fade away
  } catch (error) {
    logger.error('Analysis table error:', error);
    analysisTable.textContent = 'Failed to load analysis for this event.';

    // Clean up progress indicator and any orphans
    if (progress && progress.fadeAndRemove) {
      progress.fadeAndRemove();
    }
    if (progress && progress.fadeAndRemove) {
      progress.fadeAndRemove();
    }

    // Failsafe cleanup for any lingering progress indicators
    setTimeout(() => {
      cleanupOrphanedProgressDisplay();
    }, 100);
  }
}

/**
 * Creates a floating clone of the table header that appears fixed at the top of the viewport
 * when the real header scrolls out of view. This is a robust fallback for cases where
 * CSS position: sticky is prevented by overflow/transform on ancestor elements.
 * @param table - The table element to enhance with floating header
 */
export function enableFloatingTableHeader(table: HTMLTableElement): void {
  if (!table || !(table instanceof HTMLTableElement)) {
    return;
  }
  const thead = table.querySelector('thead');
  if (!thead) {
    return;
  }

  // Create floating wrapper
  const floating = document.createElement('div');
  floating.className = 'floating-thead';
  floating.style.position = 'fixed';
  floating.style.top = '0';
  const initialRect = table.getBoundingClientRect();
  floating.style.left = `${initialRect.left}px`;
  floating.style.width = `${initialRect.width}px`;
  floating.style.overflow = 'hidden';
  floating.style.zIndex = '1000';
  floating.style.pointerEvents = 'none';
  floating.style.display = 'none';

  // Clone header table structure
  const cloneTable = document.createElement('table');
  cloneTable.className = table.className;
  cloneTable.style.borderCollapse = 'collapse';
  const cloneThead = thead.cloneNode(true);
  cloneTable.appendChild(cloneThead);
  floating.appendChild(cloneTable);
  document.body.appendChild(floating);

  // Helper to sync column widths
  function syncWidths() {
    if (!thead) {
      return;
    }
    const srcCols = thead.querySelectorAll('th');
    const dstCols = (cloneThead as HTMLElement).querySelectorAll('th');
    const srcRect = table.getBoundingClientRect();
    floating.style.left = `${Math.max(0, srcRect.left)}px`;
    floating.style.width = `${srcRect.width}px`;
    for (let i = 0; i < srcCols.length; i++) {
      const columnWidth = srcCols[i].getBoundingClientRect().width;
      dstCols[i].style.width = `${columnWidth}px`;
    }
  }

  function onScroll() {
    if (!thead) {
      return;
    }
    const rect = table.getBoundingClientRect();
    const headerRect = thead.getBoundingClientRect();
    // Show floating header once the real header is scrolled above the viewport top
    if (headerRect.top < 0 && rect.bottom > 40) {
      syncWidths();
      floating.style.display = '';
    } else {
      floating.style.display = 'none';
    }
  }

  // Throttle resize/scroll handlers lightly
  let ticking = false;
  function ticked() {
    onScroll();
    ticking = false;
  }
  function schedule() {
    if (!ticking) {
      requestAnimationFrame(ticked);
      ticking = true;
    }
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);

  // Initial sync
  schedule();

  // Return a cleanup function attached to the table for potential removal
  Object.defineProperty(table, '_floatingHeaderCleanup', {
    value: () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (floating && floating.parentNode) {
        floating.parentNode.removeChild(floating);
      }
    },
    configurable: true
  });
}

import { escapeHtml } from '../../utils/html.js';
import { getState } from '../state.js';
import type { MatchupSortMode, MatchupStats } from '../types.js';
import { elements } from './elements.js';

const MAX_MATCHUPS_DEFAULT = 10;
let matchupSortMode: MatchupSortMode = 'games';

function sortMatchups(matchups: MatchupStats[], sortBy: MatchupSortMode): MatchupStats[] {
  return [...matchups].sort((a, b) => {
    switch (sortBy) {
      case 'winrate':
        return b.winRate - a.winRate;
      case 'name':
        return a.opponent.localeCompare(b.opponent);
      case 'games':
      default:
        return b.total - a.total;
    }
  });
}

function getWinrateBarClass(winRate: number): string {
  if (winRate > 55) {
    return 'winrate-bar-fill--high';
  }
  if (winRate < 45) {
    return 'winrate-bar-fill--low';
  }
  return 'winrate-bar-fill--mid';
}

export function renderMatchups(): void {
  const state = getState();
  if (!state.trendsData || !elements.matchupsSection || !elements.matchupsList) {
    return;
  }
  const { matchups } = state.trendsData;

  if (!matchups || Object.keys(matchups).length === 0) {
    elements.matchupsSection.hidden = true;
    return;
  }

  const allRows = sortMatchups(Object.values(matchups), matchupSortMode);
  const totalMatchups = allRows.length;
  const showAll = state.showAllMatchups;
  const rows = showAll ? allRows : allRows.slice(0, MAX_MATCHUPS_DEFAULT);

  elements.matchupsList.innerHTML = '';
  rows.forEach(mt => {
    const tr = document.createElement('tr');

    let wrClass = 'winrate-mid';
    if (mt.winRate > 55) {
      wrClass = 'winrate-high';
    } else if (mt.winRate < 45) {
      wrClass = 'winrate-low';
    }

    const barFillClass = getWinrateBarClass(mt.winRate);
    const opponentUrl = `/${encodeURIComponent(mt.opponent.replace(/ /g, '_'))}/trends`;

    tr.innerHTML = `
      <td class="col-opponent">
        <a href="${opponentUrl}">${escapeHtml(mt.opponent)}</a>
      </td>
      <td class="col-winrate">
        <div class="winrate-bar-container">
          <div class="winrate-bar">
            <div class="winrate-bar-fill ${barFillClass}" style="width: ${mt.winRate}%"></div>
          </div>
          <span class="winrate-value ${wrClass}">${mt.winRate.toFixed(1)}%</span>
        </div>
      </td>
      <td class="col-record">${mt.wins}-${mt.losses}-${mt.ties}</td>
      <td class="col-total">${mt.total}</td>
    `;
    elements.matchupsList?.appendChild(tr);
  });

  if (totalMatchups > MAX_MATCHUPS_DEFAULT && elements.matchupsToggle) {
    elements.matchupsToggle.textContent = showAll ? `Show Top ${MAX_MATCHUPS_DEFAULT}` : `Show All (${totalMatchups})`;
    elements.matchupsToggle.hidden = false;
  } else if (elements.matchupsToggle) {
    elements.matchupsToggle.hidden = true;
  }

  elements.matchupsSection.hidden = false;
}

export function setupMatchupSorting(): void {
  const sortButtons = document.querySelectorAll('.matchups-sort-btn');
  sortButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const sortBy = (btn as HTMLElement).dataset.sort as MatchupSortMode;
      if (sortBy && sortBy !== matchupSortMode) {
        matchupSortMode = sortBy;
        sortButtons.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        renderMatchups();
      }
    });
  });
}

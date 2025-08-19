import { render } from './render.js';
import { isFavorite } from './favorites.js';

export function getComparator(sort){
  return ({
    'percent-desc': (a,b) => (b.pct ?? -1) - (a.pct ?? -1),
    'percent-asc': (a,b) => (a.pct ?? 1e9) - (b.pct ?? 1e9),
    'alpha-asc': (a,b) => a.name.localeCompare(b.name),
    'alpha-desc': (a,b) => b.name.localeCompare(a.name),
  }[sort] || ((a,b)=>0));
}

export function applyFiltersSort(all, overrides){
  const q = document.getElementById('search').value.trim().toLowerCase();
  const sort = document.getElementById('sort').value;
  const favSel = document.getElementById('fav-filter');
  const wantFavOnly = favSel && favSel.value === 'fav';
  const filtered = all.filter(x => {
    if(q && !x.name.toLowerCase().includes(q)) return false;
    if(wantFavOnly && !isFavorite(x.name)) return false;
    return true;
  });

  const cmp = getComparator(sort);
  filtered.sort(cmp);
  render(filtered, overrides);
}

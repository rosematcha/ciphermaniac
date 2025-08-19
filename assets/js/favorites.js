// Local favorites (bookmarks) for cards, stored by exact card name
const KEY = 'favoritesV1';

function load(){
  try{
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  }catch{
    return new Set();
  }
}

function save(set){
  try{ localStorage.setItem(KEY, JSON.stringify(Array.from(set))); }catch{}
}

let favs = load();
const listeners = new Set();

export function getFavoritesSet(){ return favs; }
export function isFavorite(name){ return favs.has(name); }
export function toggleFavorite(name){
  if(!name) return isFavorite(name);
  if(favs.has(name)) favs.delete(name); else favs.add(name);
  save(favs);
  // Notify listeners
  for(const fn of listeners){ try{ fn(new Set(favs)); }catch{} }
  return favs.has(name);
}
export function setFavorite(name, enabled){
  if(!name) return isFavorite(name);
  if(enabled){ favs.add(name); } else { favs.delete(name); }
  save(favs);
  for(const fn of listeners){ try{ fn(new Set(favs)); }catch{} }
  return favs.has(name);
}
export function subscribeFavorites(fn){ listeners.add(fn); return () => listeners.delete(fn); }

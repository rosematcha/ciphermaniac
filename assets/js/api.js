import { REPORTS_BASE } from './constants.js';

export async function fetchTournamentsList(){
  const res = await fetch(`${REPORTS_BASE}/tournaments.json`);
  if(!res.ok) throw new Error('Failed to load tournaments list');
  return await res.json();
}

export async function fetchReport(tournament) {
  const jsonUrl = `${REPORTS_BASE}/${encodeURIComponent(tournament)}/master.json`;
  const res = await fetch(jsonUrl);
  if(!res.ok) throw new Error(`Failed to load master.json at ${jsonUrl}`);
  return await res.json();
}

export async function fetchOverrides(){
  try{
    const res = await fetch('assets/overrides.json');
    if(!res.ok) return {};
    return await res.json();
  }catch{
    return {};
  }
}

export async function fetchArchetypesList(tournament){
  const url = `${REPORTS_BASE}/${encodeURIComponent(tournament)}/archetypes/index.json`;
  const res = await fetch(url);
  if(!res.ok) throw new Error(`Failed to load archetype index at ${url}`);
  return await res.json();
}

export async function fetchArchetypeReport(tournament, archetypeBase){
  const jsonUrl = `${REPORTS_BASE}/${encodeURIComponent(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}.json`;
  const res = await fetch(jsonUrl);
  if(!res.ok) throw new Error(`Failed to load archetype JSON at ${jsonUrl}`);
  return await res.json();
}

// Optional helper: list of archetype base names that made Top 8 for the tournament
export async function fetchTop8ArchetypesList(tournament){
  const url = `${REPORTS_BASE}/${encodeURIComponent(tournament)}/archetypes/top8.json`;
  try{
    const res = await fetch(url);
    if(!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  }catch{
    return null;
  }
}

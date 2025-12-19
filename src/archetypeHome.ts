/**
 * Archetype Home Page
 * Landing page for a specific archetype.
 */
import './utils/buildVersion.js';

// DOM Elements
const elements = {
  title: document.getElementById('archetype-title'),
  tabHome: document.getElementById('tab-home') as HTMLAnchorElement | null,
  tabAnalysis: document.getElementById('tab-analysis') as HTMLAnchorElement | null,
  tabTrends: document.getElementById('tab-trends') as HTMLAnchorElement | null,
  cardImage: document.getElementById('archetype-card-image') as HTMLImageElement | null
};

/**
 * Extract archetype name from URL path
 */
function extractArchetypeFromUrl(): string | null {
  const { pathname } = window.location;
  // Match /:name (and optional subpaths)
  // Assuming the router only serves this page for valid archetypes
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

/**
 * Format archetype name for display
 */
function formatArchetypeName(name: string): string {
  return name;
}

/**
 * Build URL helpers
 */
function buildUrl(subpage: string = ''): string {
  const name = extractArchetypeFromUrl();
  if (!name) {
    return '/archetypes';
  }

  const basePath = `/${name.replace(/ /g, '_')}`;
  return subpage ? `${basePath}/${subpage}` : basePath;
}

/**
 * Initialize the page
 */
function init() {
  const name = extractArchetypeFromUrl();
  if (!name) {
    return;
  }

  const formattedName = formatArchetypeName(name);

  // Update title
  if (elements.title) {
    elements.title.textContent = formattedName;
  }
  document.title = `${formattedName} \u2013 Ciphermaniac`;

  // Update tab links
  if (elements.tabHome) {
    elements.tabHome.href = buildUrl('');
  }
  if (elements.tabAnalysis) {
    elements.tabAnalysis.href = buildUrl('analysis');
  }
  if (elements.tabTrends) {
    elements.tabTrends.href = buildUrl('trends');
  }
}

// Initialize
init();

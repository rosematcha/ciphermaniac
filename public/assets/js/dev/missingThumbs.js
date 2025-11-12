// Dev utility: collect missing thumbnails encountered during rendering and log a report.
// Opt-in via URL hash: #dev-missing-thumbs
import { buildThumbCandidates } from '../thumbs.js';
import { logger } from '../utils/logger.js';

const state = {
  enabled: false,
  missing: new Map() // name -> { tried: string[], lastFolder: 'sm'|'xs' }
};

function isEnabled() {
  return location.hash.includes('dev-missing-thumbs');
}

export function initMissingThumbsDev() {
  state.enabled = isEnabled();
  window.addEventListener('hashchange', () => {
    state.enabled = isEnabled();
  });
  if (state.enabled) {
    // Expose helpers in dev mode
    Object.assign(window, {
      ciphermaniacDumpMissingReport: dumpMissingReport,
      ciphermaniacProposeOverrides: proposeOverridesSkeleton,
      ciphermaniacDownloadOverrides: downloadOverridesSkeleton
    });
    logger.info(
      '[dev] Missing thumbs dev mode enabled. Run ciphermaniacDumpMissingReport(), ciphermaniacProposeOverrides(), or ciphermaniacDownloadOverrides() in console.'
    );
  }
}

/**
 *
 * @param name
 * @param useSm
 * @param overrides
 */
export function trackMissing(name, useSm, overrides) {
  if (!state.enabled) {
    return;
  }
  const tried = buildThumbCandidates(name, useSm, overrides);
  const rec = state.missing.get(name) || {
    tried: [],
    lastFolder: useSm ? 'sm' : 'xs'
  };
  rec.tried = Array.from(new Set(rec.tried.concat(tried)));
  rec.lastFolder = useSm ? 'sm' : 'xs';
  state.missing.set(name, rec);
}

export function dumpMissingReport() {
  if (!state.enabled) {
    return;
  }
  const arr = Array.from(state.missing.entries()).map(([name, info]) => ({
    name,
    ...info
  }));
  if (arr.length === 0) {
    logger.info('[dev] No missing thumbnails recorded.');
    return;
  }
  logger.info('[dev] Missing thumbnail candidates:');
  for (const item of arr) {
    logger.debug(`- ${item.name} (${item.lastFolder})`);
    for (const path of item.tried) {
      logger.debug(`   ${path}`);
    }
  }

  // Propose overrides JSON skeleton
  const overrides = {};
  for (const item of arr) {
    // Suggest the first candidate for each missing card
    if (item.tried && item.tried.length) {
      const rel = item.tried[0].replace(/^thumbnails\/(sm|xs)\//, '');
      overrides[item.name] = rel;
    }
  }
  const json = JSON.stringify(overrides, null, 2);
  logger.info('[dev] Proposed overrides.json:', json);

  // Download as file
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'overrides.json';
  link.textContent = 'Download overrides.json';
  link.style.cssText =
    'position:fixed;top:10px;right:10px;z-index:9999;background:#222;color:#fff;padding:8px;border-radius:6px;font-size:14px;';
  document.body.appendChild(link);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60000);
  setTimeout(() => {
    link.remove();
  }, 60000);
}

function pickBasename(path) {
  const parts = String(path).split('/');
  return parts[parts.length - 1] || path;
}

// Build a simple overrides skeleton mapping missing card names to a best-guess filename
/**
 *
 */
export function proposeOverridesSkeleton() {
  if (!state.enabled) {
    return {};
  }
  const out = {};
  for (const [name, info] of state.missing.entries()) {
    // Choose the first candidate's basename as a starting point
    const tried = info.tried || buildThumbCandidates(name, info.lastFolder === 'sm', {});
    if (tried.length > 0) {
      out[name] = pickBasename(tried[0]);
    }
  }
  console.info('[dev] Proposed overrides skeleton (copy into assets/overrides.json and adjust as needed):');
  console.log(JSON.stringify(out, null, 2));
  return out;
}

// Offer a quick download of the proposed overrides skeleton as JSON
export function downloadOverridesSkeleton() {
  const obj = proposeOverridesSkeleton();
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'overrides-skeleton.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

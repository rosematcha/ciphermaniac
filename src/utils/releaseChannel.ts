const RELEASE_CHANNEL_META_NAME = 'ciphermaniac-release-channel';
const CLOUDFLARE_PRODUCTION_CHANNEL = 'cloudflare-production';

function readReleaseChannel(doc: Document | null): string {
  if (!doc) {
    return '';
  }

  const selector = `meta[name="${RELEASE_CHANNEL_META_NAME}"]`;
  const meta = doc.querySelector(selector);
  return String(meta?.getAttribute('content') || '')
    .trim()
    .toLowerCase();
}

export function getReleaseChannel(doc: Document | null = typeof document !== 'undefined' ? document : null): string {
  return readReleaseChannel(doc);
}

export function isCloudflarePagesProductionRelease(
  doc: Document | null = typeof document !== 'undefined' ? document : null
): boolean {
  return getReleaseChannel(doc) === CLOUDFLARE_PRODUCTION_CHANNEL;
}

export function shouldHideUnreadyFeatures(
  doc: Document | null = typeof document !== 'undefined' ? document : null
): boolean {
  return isCloudflarePagesProductionRelease(doc);
}

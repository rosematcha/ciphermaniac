import { normalizeCardNumber } from '../lib/cardUtils.js';

// Module-level cache: persists across requests within the same isolate,
// avoiding re-fetch and re-parse of the ~1-2MB synonyms JSON on every request.
let cachedSynonymsData = null;

// Cloudflare Pages Function to serve card.html for all /card/* routes
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;

  // Extract the card slug from the path (e.g., /card/SFA~018)
  const match = path.match(/\/card\/([^/?#]+)/);

  if (match && match[1]) {
    const slug = decodeURIComponent(match[1]);

    // Check if this is a SET~NUMBER format
    const setNumberMatch = slug.match(/^([A-Z]{2,5})~(\d+[A-Za-z]?)$/i);

    if (setNumberMatch) {
      const [, setCode, number] = setNumberMatch;

      try {
        // Use module-level cache to avoid re-fetching/parsing on every request
        if (!cachedSynonymsData) {
          const synonymsResponse = await context.env.ASSETS.fetch(
            new URL('/assets/card-synonyms.json', context.request.url)
          );
          if (synonymsResponse.ok) {
            cachedSynonymsData = await synonymsResponse.json();
          }
        }

        if (cachedSynonymsData) {
          const synonymsData = cachedSynonymsData;

          // Normalize the set code and number for comparison
          const normalizedSet = setCode.toUpperCase();
          const normalizedNumber = normalizeCardNumber(number);

          // Search for a synonym that matches this set and number
          let foundSynonym = null;
          let canonicalUid = null;

          // Check if this SET:NUMBER appears as a synonym (not canonical)
          for (const [uid, canonical] of Object.entries(synonymsData.synonyms || {})) {
            if (uid.includes('::')) {
              const parts = uid.split('::');
              if (parts.length >= 3) {
                const uidSet = parts[1].toUpperCase();
                const uidNumber = normalizeCardNumber(parts[2]);

                if (uidSet === normalizedSet && uidNumber === normalizedNumber) {
                  foundSynonym = uid;
                  canonicalUid = canonical;
                  break;
                }
              }
            }
          }

          // If we found a synonym, redirect to the canonical version
          if (foundSynonym && canonicalUid) {
            // Extract the canonical SET and NUMBER
            const canonicalParts = canonicalUid.split('::');
            if (canonicalParts.length >= 3) {
              const canonicalSet = canonicalParts[1];
              const canonicalNumber = canonicalParts[2];
              const canonicalSlug = `${canonicalSet}~${canonicalNumber}`;

              // Only redirect if the canonical is different from the requested slug
              if (canonicalSlug.toUpperCase() !== slug.toUpperCase()) {
                // 301 permanent redirect to canonical URL
                return Response.redirect(new URL(`/card/${canonicalSlug}`, context.request.url).toString(), 301);
              }
            }
          }

          // Resolve card identifier at the edge to eliminate client-side slug resolution.
          // Search canonicals for a UID matching this set:number (the card IS a canonical)
          let resolvedUid = canonicalUid || null;
          if (!resolvedUid) {
            for (const [_uid, canonical] of Object.entries(synonymsData.canonicals || {})) {
              if (typeof canonical === 'string' && canonical.includes('::')) {
                const parts = canonical.split('::');
                if (
                  parts.length >= 3 &&
                  parts[1].toUpperCase() === normalizedSet &&
                  normalizeCardNumber(parts[2]) === normalizedNumber
                ) {
                  resolvedUid = canonical;
                  break;
                }
              }
            }
          }
          // Also check synonym UIDs themselves (key side) for set:number match
          if (!resolvedUid) {
            for (const [uid] of Object.entries(synonymsData.synonyms || {})) {
              if (uid.includes('::')) {
                const parts = uid.split('::');
                if (
                  parts.length >= 3 &&
                  parts[1].toUpperCase() === normalizedSet &&
                  normalizeCardNumber(parts[2]) === normalizedNumber
                ) {
                  resolvedUid = uid;
                  break;
                }
              }
            }
          }

          if (resolvedUid) {
            return serveCardHtmlWithData(context, { resolvedIdentifier: resolvedUid });
          }
        }
      } catch (error) {
        // If there's an error loading synonyms, just serve the page normally
        console.error('Error checking card synonyms:', error);
      }
    }
  }

  // Serve card.html for any /card/* path (default behavior)
  const fallbackResponse = await context.env.ASSETS.fetch(new URL('/card.html', context.request.url));
  return new Response(fallbackResponse.body, {
    status: fallbackResponse.status,
    headers: {
      ...Object.fromEntries(fallbackResponse.headers.entries()),
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400'
    }
  });
}

/**
 * Serve card.html with edge-resolved data injected as a script block.
 * The client reads window.__CARD_EDGE_DATA to skip slug resolution.
 */
async function serveCardHtmlWithData(context, edgeData) {
  const htmlResponse = await context.env.ASSETS.fetch(new URL('/card.html', context.request.url));
  const html = await htmlResponse.text();

  // Inject edge data right before the closing </head> tag so it's available
  // before any module scripts execute.
  const injection = `<script>window.__CARD_EDGE_DATA=${JSON.stringify(edgeData)};</script>`;
  const injectedHtml = html.replace('</head>', `${injection}\n</head>`);

  return new Response(injectedHtml, {
    status: 200,
    headers: {
      'Content-Type': 'text/html;charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400'
    }
  });
}

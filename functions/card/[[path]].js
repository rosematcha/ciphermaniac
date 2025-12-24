/**
 * Normalize card number to 3 digits with optional suffix
 * @param {string} value - Card number to normalize
 * @returns {string} Normalized card number
 */
function normalizeCardNumber(value) {
  if (!value) {
    return '';
  }
  const raw = String(value).trim();
  if (!raw) {
    return '';
  }
  const match = raw.match(/^(\d+)([A-Za-z]*)$/);
  if (!match) {
    return raw.toUpperCase();
  }
  const digits = match[1];
  const suffix = match[2] || '';
  const padded = digits.padStart(3, '0');
  return `${padded}${suffix.toUpperCase()}`;
}

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
        // Fetch the synonyms data
        const synonymsResponse = await context.env.ASSETS.fetch(
          new URL('/assets/card-synonyms.json', context.request.url)
        );

        if (synonymsResponse.ok) {
          const synonymsData = await synonymsResponse.json();

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
        }
      } catch (error) {
        // If there's an error loading synonyms, just serve the page normally
        console.error('Error checking card synonyms:', error);
      }
    }
  }

  // Serve card.html for any /card/* path (default behavior)
  return context.env.ASSETS.fetch(new URL('/card.html', context.request.url));
}

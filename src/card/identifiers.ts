/**
 * Card identification and parsing utilities
 * @module card/identifiers
 */

/**
 * Get card name from current URL location
 * @returns Card identifier from URL
 */
export function getCardNameFromLocation(): string | null {
    const params = new URLSearchParams(location.search);
    const query = params.get('name');
    if (query) {
        return query;
    }

    // Hash route: #card/<encoded name or UID>
    const match = location.hash.match(/^#card\/(.+)$/);
    if (match) {
        return decodeURIComponent(match[1]);
    }

    return null;
}

/**
 * Get the canonical identifier for a card - prefer UID, fallback to name
 * @param cardItem - Card item object
 * @returns Canonical card identifier
 */
export function getCanonicalId(cardItem: { uid?: string; name: string }): string {
    return cardItem.uid || cardItem.name;
}

/**
 * Get display name from card identifier (UID or name)
 * @param cardId - Card identifier
 * @returns Display name or null
 */
export function getDisplayName(cardId: string | null): string | null {
    if (!cardId) {
        return null;
    }

    if (cardId.includes('::')) {
        // UID format: "Name::SET::NUMBER" -> "Name SET NUMBER"
        const parts = cardId.split('::');
        return parts.length >= 3 ? `${parts[0]} ${parts[1]} ${parts[2]}` : cardId;
    }

    return cardId;
}

/**
 * Parse display name into name and set ID parts
 * @param displayName - Display name to parse
 * @returns Object with name and setId properties
 */
export function parseDisplayName(displayName: string | null): { name: string; setId: string } {
    if (!displayName) {
        return { name: '', setId: '' };
    }

    // Match pattern: "CardName SetCode Number" -> split into name and "SetCode Number"
    const match = displayName.match(/^(.+?)\s+([A-Z]+\s+\d+[A-Za-z]?)$/);
    if (match) {
        return { name: match[1], setId: match[2] };
    }

    // If no set ID pattern found, treat entire string as name
    return { name: displayName, setId: '' };
}

/**
 * Get base name from card identifier
 * @param cardId - Card identifier
 * @returns Base name or null
 */
export function getBaseName(cardId: string | null): string | null {
    if (!cardId) {
        return null;
    }

    if (cardId.includes('::')) {
        return cardId.split('::')[0];
    }

    return cardId;
}

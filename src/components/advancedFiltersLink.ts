/**
 * Initialize a trigger that navigates to the index page with advanced filters enabled.
 */

interface AdvancedFiltersLinkOptions {
    inputSelector?: string;
    triggerSelector?: string;
}

interface FiltersRedirectPayload {
    open: boolean;
    query?: string;
}

export function initAdvancedFiltersLink(options: AdvancedFiltersLinkOptions = {}): void {
    const { inputSelector, triggerSelector } = options;

    if (typeof triggerSelector !== 'string' || triggerSelector.length === 0) {
        return;
    }

    const trigger = document.querySelector(triggerSelector) as HTMLElement | null;
    if (!trigger) {
        return;
    }

    const input = typeof inputSelector === 'string' ? (document.querySelector(inputSelector) as HTMLInputElement | HTMLTextAreaElement | null) : null;

    const buildUrl = (event: MouseEvent) => {
        const query = input?.value?.trim() ?? '';
        const payload: FiltersRedirectPayload = { open: true };

        if (query) {
            payload.query = query;
        }

        try {
            sessionStorage.setItem('cmFiltersRedirect', JSON.stringify(payload));
        } catch {
            // Ignore storage errors (e.g., private mode)
        }

        const url = '/index.html#grid';

        if (event.metaKey || event.ctrlKey) {
            window.open(url, '_blank');
        } else {
            window.location.href = url;
        }
    };

    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        buildUrl(event as MouseEvent);
    });
}

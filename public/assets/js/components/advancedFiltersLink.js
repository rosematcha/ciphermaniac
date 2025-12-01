/**
 * Initialize a trigger that navigates to the index page with advanced filters enabled.
 */
export function initAdvancedFiltersLink(options = {}) {
    const { inputSelector, triggerSelector } = options;
    if (typeof triggerSelector !== 'string' || triggerSelector.length === 0) {
        return;
    }
    const trigger = document.querySelector(triggerSelector);
    if (!trigger) {
        return;
    }
    const input = typeof inputSelector === 'string' ? document.querySelector(inputSelector) : null;
    const buildUrl = (event) => {
        const query = input?.value?.trim() ?? '';
        const payload = { open: true };
        if (query) {
            payload.query = query;
        }
        try {
            sessionStorage.setItem('cmFiltersRedirect', JSON.stringify(payload));
        }
        catch {
            // Ignore storage errors (e.g., private mode)
        }
        const url = '/index.html#grid';
        if (event.metaKey || event.ctrlKey) {
            window.open(url, '_blank');
        }
        else {
            window.location.href = url;
        }
    };
    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        buildUrl(event);
    });
}

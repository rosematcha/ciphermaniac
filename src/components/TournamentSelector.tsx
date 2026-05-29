import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { fetchTournamentsList, prettyTournamentName } from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import { ONLINE_META_LABEL, ONLINE_META_NAME } from '../lib/constants';

/**
 * Sticky dropdown in the topnav that switches the global tournament scope.
 */
export function TournamentSelector() {
  const { tournament, setTournament } = useTournament();
  const [tournaments] = createResource(fetchTournamentsList);
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  let containerRef: HTMLDivElement | undefined;

  const filtered = createMemo(() => {
    const all = tournaments() ?? [ONLINE_META_NAME];
    const q = query().trim().toLowerCase();
    if (!q) {
      return all;
    }
    return all.filter(t => t.toLowerCase().includes(q));
  });

  const sorted = createMemo(() => {
    const all = filtered();
    const online = all.filter(t => t === ONLINE_META_NAME);
    const rest = all.filter(t => t !== ONLINE_META_NAME).sort((a, b) => b.localeCompare(a)); // newest first by date prefix
    return [...online, ...rest];
  });

  function close() {
    setOpen(false);
    setQuery('');
  }

  function pick(t: string) {
    setTournament(t);
    close();
  }

  function onDocClick(e: MouseEvent) {
    if (!containerRef) {
      return;
    }
    if (!containerRef.contains(e.target as Node)) {
      close();
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open()) {
      close();
    }
  }

  onMount(() => {
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
  });
  onCleanup(() => {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
  });

  return (
    <div class='t-selector' ref={containerRef}>
      <button
        class='t-selector-trigger'
        type='button'
        aria-haspopup='listbox'
        aria-expanded={open() ? 'true' : 'false'}
        onClick={() => setOpen(!open())}
        title={prettyTournamentName(tournament())}
      >
        <span class='t-selector-label'>{shortLabel(tournament())}</span>
        <span class='t-selector-caret' aria-hidden='true'>
          ▾
        </span>
      </button>
      <Show when={open()}>
        <div class='t-selector-pop' role='listbox' aria-label='Tournament'>
          <input
            class='search'
            type='search'
            placeholder='Filter tournaments...'
            value={query()}
            onInput={e => setQuery(e.currentTarget.value)}
            autofocus
          />
          <div class='t-selector-list'>
            <For each={sorted()}>
              {t => (
                <button
                  type='button'
                  class='t-selector-item'
                  classList={{ active: t === tournament() }}
                  onClick={() => pick(t)}
                >
                  <span class='primary'>{shortLabel(t)}</span>
                  <Show when={t !== ONLINE_META_NAME}>
                    <span class='secondary'>{datePart(t)}</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}

function shortLabel(key: string): string {
  if (key === ONLINE_META_NAME) {
    return ONLINE_META_LABEL;
  }
  const m = key.match(/^\d{4}-\d{2}-\d{2},\s*(.+)$/);
  return m ? m[1] : key;
}

function datePart(key: string): string {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    return '';
  }
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

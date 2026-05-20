import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { classifyTournament, fetchTournamentsList, prettyTournamentName } from '../lib/data';
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

  const grouped = createMemo(() => {
    const groups: Record<string, string[]> = {
      Online: [],
      'International Championships': [],
      'Regional Championships': [],
      'Special Events': [],
      Other: []
    };
    filtered().forEach(t => {
      const c = classifyTournament(t);
      if (c === 'online') {
        groups.Online.push(t);
      } else if (c === 'international') {
        groups['International Championships'].push(t);
      } else if (c === 'regional') {
        groups['Regional Championships'].push(t);
      } else if (c === 'special') {
        groups['Special Events'].push(t);
      } else {
        groups.Other.push(t);
      }
    });
    return Object.entries(groups).filter(([, list]) => list.length > 0);
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
            <For each={grouped()}>
              {([groupLabel, list]) => (
                <div class='t-selector-group'>
                  <div class='t-selector-group-head'>{groupLabel}</div>
                  <For each={list}>
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

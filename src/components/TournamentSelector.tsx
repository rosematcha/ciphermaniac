import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show
} from 'solid-js';
import { fetchTournamentsList, prettyTournamentName, shortTournamentName } from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import { ONLINE_META_DATE_LABEL, ONLINE_META_LABEL, ONLINE_META_NAME } from '../lib/constants';
import { selectorGroups } from './tournamentSelector/model';

/**
 * Sticky dropdown in the topnav that switches the global tournament scope.
 */
export function TournamentSelector() {
  const { tournament, setTournament } = useTournament();
  const [tournaments] = createResource(fetchTournamentsList);
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [expanded, setExpanded] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

  const groups = createMemo(() => selectorGroups(tournaments() ?? [ONLINE_META_NAME], query(), expanded(), shortLabel));

  // Reconcile a stale localStorage selection: if the persisted tournament is no
  // longer in the published list (renamed / removed), every report fetch would
  // 404. Once the list loads, fall back to the online-meta default and rewrite
  // storage. Only the value hydrated at mount is checked — a later programmatic
  // selection (e.g. a ?tour= deep link on ArchetypePage) can legitimately name
  // a fresh tournament that the edge-cached tournaments.json doesn't list yet,
  // and must not be clobbered.
  const hydratedSelection = tournament();
  createEffect(() => {
    const list = tournaments();
    if (!list || list.length === 0) {
      return;
    }
    const current = tournament();
    if (current !== ONLINE_META_NAME && current === hydratedSelection && !list.includes(current)) {
      setTournament(ONLINE_META_NAME);
    }
  });

  function close() {
    setOpen(false);
    setQuery('');
    setExpanded(false);
  }

  function pick(t: string) {
    setTournament(t, { history: 'push' });
    close();
  }

  function onDocClick(e: MouseEvent) {
    if (!containerRef) {
      return;
    }
    // The path, not the target: "More..." removes itself before the click
    // reaches the document, and a detached target would read as outside.
    if (!e.composedPath().includes(containerRef)) {
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
            placeholder='Search tournaments'
            aria-label='Search tournaments'
            value={query()}
            onInput={e => setQuery(e.currentTarget.value)}
            autofocus
          />
          <div class='t-selector-list'>
            <Show when={groups().online}>
              <SelectorItem active={tournament() === ONLINE_META_NAME} onPick={() => pick(ONLINE_META_NAME)}>
                <span class='primary'>{ONLINE_META_LABEL}</span>
                <span class='secondary'>{ONLINE_META_DATE_LABEL}</span>
              </SelectorItem>
            </Show>
            <Show when={groups().standard.length > 0}>
              <div class='t-selector-group' role='group' aria-labelledby='t-selector-standard'>
                <div class='t-selector-group-label' id='t-selector-standard'>
                  Standard
                </div>
                <For each={groups().standard}>
                  {t => (
                    <SelectorItem active={t === tournament()} onPick={() => pick(t)}>
                      <span class='primary'>{shortLabel(t)}</span>
                      <span class='secondary'>{datePart(t)}</span>
                    </SelectorItem>
                  )}
                </For>
                <Show when={groups().hasMore}>
                  <button type='button' class='t-selector-more' onClick={() => setExpanded(true)}>
                    More...
                  </button>
                </Show>
              </div>
            </Show>
            <Show when={!groups().online && groups().standard.length === 0}>
              <div class='t-selector-empty'>No tournaments match.</div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

function SelectorItem(props: { active: boolean; onPick: () => void; children: JSX.Element }) {
  return (
    <button type='button' class='t-selector-item' classList={{ active: props.active }} onClick={() => props.onPick()}>
      {props.children}
    </button>
  );
}

function shortLabel(key: string): string {
  if (key === ONLINE_META_NAME) {
    return ONLINE_META_LABEL;
  }
  const m = key.match(/^\d{4}-\d{2}-\d{2},\s*(.+)$/);
  return shortTournamentName(m ? m[1] : key);
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

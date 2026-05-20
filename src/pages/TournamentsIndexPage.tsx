import { createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import { classifyTournament, fetchTournamentsList } from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import { ONLINE_META_NAME } from '../lib/constants';
import { Section } from '../components/Section';
import { ChipGroup, SearchInput } from '../components/Chip';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { nameFromTournamentKey } from '../lib/format';

type Filter = 'all' | 'regional' | 'international' | 'special';

export function TournamentsIndexPage() {
  const { tournament, setTournament } = useTournament();
  const [list] = createResource(fetchTournamentsList);
  const [query, setQuery] = createSignal('');
  const [filter, setFilter] = createSignal<Filter>('all');

  onMount(() => {
    document.title = 'Tournaments — Ciphermaniac';
  });

  const tournaments = createMemo(() => {
    const all = list() ?? [];
    const q = query().trim().toLowerCase();
    const f = filter();
    return all.filter(t => {
      if (t === ONLINE_META_NAME) {
        return f === 'all';
      }
      const cls = classifyTournament(t);
      if (f !== 'all' && cls !== f) {
        return false;
      }
      if (q && !t.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  });

  return (
    <>
      <section class='hero'>
        <h1>Tournaments</h1>
        <div class='hero-meta'>
          <Show when={list()} fallback={<Skeleton width='200px' height='13px' />}>
            <span>{(list()!.length - 1).toLocaleString()} historical tournaments</span>
            <span class='dot'>·</span>
            <span>1 rolling online window</span>
          </Show>
        </div>
      </section>

      <Section>
        <div class='filter-bar'>
          <div class='filter-row'>
            <SearchInput value={query()} onInput={setQuery} placeholder='Search tournaments...' />
          </div>
          <div class='filter-row'>
            <ChipGroup
              options={[
                { value: 'all', label: 'All' },
                { value: 'regional', label: 'Regionals' },
                { value: 'international', label: 'Internationals' },
                { value: 'special', label: 'Special events' }
              ]}
              selected={filter()}
              onSelect={v => setFilter(v as Filter)}
            />
          </div>
        </div>
      </Section>

      <Section right={`${tournaments().length.toLocaleString()} matching`}>
        <Show
          when={list()}
          fallback={
            <div class='tournament-list'>
              <For each={Array.from({ length: 8 })}>{() => <Skeleton height='44px' />}</For>
            </div>
          }
        >
          <Show
            when={tournaments().length > 0}
            fallback={
              <EmptyState
                title='No tournaments match.'
                description='Try a different filter or clear the search.'
                actions={
                  <button
                    class='btn btn-secondary'
                    type='button'
                    onClick={() => {
                      setQuery('');
                      setFilter('all');
                    }}
                  >
                    Reset
                  </button>
                }
              />
            }
          >
            <div class='tournament-list'>
              <For each={tournaments()}>
                {t => (
                  <button
                    class='tournament-row tournament-row-clickable'
                    classList={{ active: t === tournament() }}
                    onClick={() => setTournament(t)}
                    title={`Switch active tournament to: ${t}`}
                  >
                    <span class='date'>{dateFromKey(t)}</span>
                    <span class='name'>{nameFromTournamentKey(t)}</span>
                    <Show when={t === tournament()} fallback={<span class='players'>{classifyTournament(t)}</span>}>
                      <span class='players active-marker'>Active</span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Section>
    </>
  );
}

function dateFromKey(key: string): string {
  if (key === ONLINE_META_NAME) {
    return 'Live';
  }
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    return '—';
  }
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

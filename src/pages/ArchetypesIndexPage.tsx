import { createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { fetchArchetypes, prettyTournamentName } from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import { ONLINE_META_LABEL, ONLINE_META_NAME } from '../lib/constants';
import type { ArchetypeIndexEntry } from '../types';
import { Section } from '../components/Section';
import { SearchInput } from '../components/Chip';
import { Segmented } from '../components/Segmented';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { ArchetypeCard } from '../components/ArchetypeCard';
import { createPersistentViewMode } from '../lib/persistentSignal';
import { formatPercent } from '../lib/format';

type ViewMode = 'grid' | 'list';
const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' }
];

export function ArchetypesIndexPage() {
  const { tournament } = useTournament();
  const [archetypes] = createResource(tournament, fetchArchetypes);
  // For event views, fetch the online-meta archetypes as an image fallback when
  // the event index ships without thumbnails/signature cards.
  const [onlineArchetypes] = createResource(
    () => tournament() !== ONLINE_META_NAME,
    needFallback => (needFallback ? fetchArchetypes(ONLINE_META_NAME) : [])
  );
  const onlineByName = createMemo(() => {
    const map = new Map<string, ArchetypeIndexEntry>();
    for (const a of onlineArchetypes() ?? []) {
      map.set(a.name, a);
    }
    return map;
  });
  const [query, setQuery] = createSignal('');
  const [viewMode, setViewMode] = createPersistentViewMode('cm:archetypesView');
  const navigate = useNavigate();

  onMount(() => {
    document.title = 'Archetypes — Ciphermaniac';
  });

  const filtered = createMemo(() => {
    const list = archetypes() ?? [];
    const q = query().trim().toLowerCase();
    if (!q) {
      return list;
    }
    return list.filter(a => (a.label || a.name).toLowerCase().includes(q));
  });

  const scopeLabel = () => (tournament() === ONLINE_META_NAME ? ONLINE_META_LABEL : prettyTournamentName(tournament()));

  return (
    <>
      <section class='hero'>
        <h1>Archetypes</h1>
        <div class='hero-meta'>
          <Show when={archetypes()} fallback={<Skeleton width='200px' height='13px' />}>
            <span>{archetypes()!.length.toLocaleString()} active archetypes</span>
            <span class='dot'>·</span>
            <span>{scopeLabel()}</span>
          </Show>
        </div>
      </section>

      <Section>
        <div class='filter-bar'>
          <div class='filter-row'>
            <SearchInput value={query()} onInput={setQuery} placeholder='Search archetypes by name...' />
            <Segmented<ViewMode>
              options={VIEW_OPTIONS}
              selected={viewMode()}
              onSelect={setViewMode}
              ariaLabel='View mode'
            />
          </div>
        </div>
      </Section>

      <Section right={`${filtered().length.toLocaleString()} matching`}>
        <Show
          when={archetypes()}
          fallback={
            <Show when={viewMode() === 'grid'} fallback={<ListSkeleton />}>
              <div class='gallery-grid'>
                <For each={Array.from({ length: 8 })}>{() => <Skeleton height='240px' />}</For>
              </div>
            </Show>
          }
        >
          <Show
            when={filtered().length > 0}
            fallback={
              <EmptyState
                title='No archetypes match.'
                description='Try a different search term, or clear the filter to see everything.'
                actions={
                  <button class='btn btn-secondary' type='button' onClick={() => setQuery('')}>
                    Clear filter
                  </button>
                }
              />
            }
          >
            <Show
              when={viewMode() === 'grid'}
              fallback={
                <ArchetypesListView
                  items={filtered()}
                  onSelect={slug => navigate(`/archetypes/${encodeURIComponent(slug)}`)}
                />
              }
            >
              <div class='gallery-grid'>
                <For each={filtered()}>{a => <ArchetypeCard entry={a} online={onlineByName().get(a.name)} />}</For>
              </div>
            </Show>
          </Show>
        </Show>
      </Section>
    </>
  );
}

function ArchetypesListView(props: { items: ArchetypeIndexEntry[]; onSelect: (slug: string) => void }) {
  return (
    <div class='table-wrap'>
      <table class='data'>
        <thead>
          <tr>
            <th class='num'>#</th>
            <th>Archetype</th>
            <th class='num'>Meta share</th>
            <th class='num'>Decks</th>
            <th>Signature cards</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.items}>
            {(entry, i) => (
              <tr
                class='is-link'
                onClick={() => props.onSelect(entry.name)}
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    props.onSelect(entry.name);
                  }
                }}
              >
                <td class='num muted-cell'>{i() + 1}</td>
                <td>
                  <span class='cardname'>{entry.label || entry.name}</span>
                </td>
                <td class='num'>{formatPercent(entry.percent)}</td>
                <td class='num muted-cell'>{entry.deckCount?.toLocaleString() ?? '—'}</td>
                <td class='muted-cell'>{formatSignatures(entry)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function formatSignatures(entry: ArchetypeIndexEntry): string {
  const sigs = entry.signatureCards ?? [];
  if (sigs.length === 0) {
    return '—';
  }
  return sigs
    .slice(0, 3)
    .map(s => s.name)
    .join(' · ');
}

function ListSkeleton() {
  return (
    <div class='table-wrap'>
      <table class='data'>
        <thead>
          <tr>
            <th class='num'>#</th>
            <th>Archetype</th>
            <th class='num'>Meta share</th>
            <th class='num'>Decks</th>
            <th>Signature cards</th>
          </tr>
        </thead>
        <tbody>
          <For each={Array.from({ length: 12 })}>
            {() => (
              <tr>
                <td class='num'>
                  <Skeleton width='20px' />
                </td>
                <td>
                  <Skeleton width='60%' />
                </td>
                <td class='num'>
                  <Skeleton width='40px' />
                </td>
                <td class='num'>
                  <Skeleton width='48px' />
                </td>
                <td>
                  <Skeleton width='80%' />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

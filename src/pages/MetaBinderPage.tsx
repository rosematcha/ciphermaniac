import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { BottomSheet } from '../components/BottomSheet';
import { CardImage } from '../components/CardImage';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { fetchArchetype, fetchArchetypes, fetchPrices, fetchTournamentsList, prettyTournamentName } from '../lib/data';
import { ONLINE_META_NAME } from '../lib/constants';
import { latestValue, resolved } from '../lib/resource';
import { type BinderArchetypeInput, type BinderCard, binderChecklist, buildBinder } from '../lib/metaBinder';
import '../styles/pages/meta-binder.css';

/** Archetypes at or above this meta share are selected on first load. */
const DEFAULT_SHARE_FLOOR = 1;
/** `?a=` value standing for "the user deselected everything", vs. no param at all. */
const EMPTY_SELECTION = 'none';

export function MetaBinderPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tournaments] = createResource(fetchTournamentsList);
  const tournamentsData = () => latestValue(tournaments);
  const [prices] = createResource(fetchPrices);
  const [sheetOpen, setSheetOpen] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const narrowQuery = typeof window !== 'undefined' ? window.matchMedia('(max-width: 860px)') : null;
  const [isNarrow, setIsNarrow] = createSignal(narrowQuery?.matches ?? false);
  onMount(() => {
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    narrowQuery?.addEventListener('change', onChange);
    onCleanup(() => narrowQuery?.removeEventListener('change', onChange));
  });

  onMount(() => {
    document.title = 'Meta Binder — Tools — Ciphermaniac';
  });

  const tournament = () => (typeof searchParams.t === 'string' && searchParams.t ? searchParams.t : ONLINE_META_NAME);

  const [archetypes] = createResource(tournament, fetchArchetypes);
  const archetypeList = () => latestValue(archetypes) ?? [];

  /**
   * The selection lives in a signal, not in the URL, with the URL mirrored from
   * it. Deriving it from `searchParams` and writing back on every toggle looks
   * tidier but races: `setSearchParams` lands asynchronously, so two toggles in
   * the same tick both read the pre-update value and the second overwrites the
   * first. The signal composes; an effect pushes it to the URL for sharing.
   *
   * `null` means "untouched", which resolves to every archetype above the share
   * floor — a cold visit lands on a useful binder, while an explicit empty
   * selection stays empty.
   */
  const initialFromUrl = typeof searchParams.a === 'string' ? searchParams.a : null;
  const [picked, setPicked] = createSignal<string[] | null>(
    initialFromUrl === null ? null : initialFromUrl === EMPTY_SELECTION ? [] : initialFromUrl.split('~').filter(Boolean)
  );

  const selected = createMemo<string[]>(() => {
    const explicit = picked();
    if (explicit !== null) {
      return explicit;
    }
    return archetypeList()
      .filter(a => (a.percent ?? 0) >= DEFAULT_SHARE_FLOOR)
      .map(a => a.name);
  });

  const selectedSet = createMemo(() => new Set(selected()));

  // Mirror to the URL so a binder can be shared or reloaded. Only once the user
  // has actually picked something — the default selection stays out of the URL
  // so it can follow the meta rather than freezing on first visit.
  createEffect(() => {
    const explicit = picked();
    if (explicit === null) {
      return;
    }
    // The router drops an empty param value, which would read back as
    // "untouched" and restore the defaults on reload — so an explicitly empty
    // selection gets its own sentinel.
    setSearchParams({ a: explicit.length ? explicit.join('~') : EMPTY_SELECTION }, { replace: true });
  });

  function toggleArchetype(base: string) {
    const set = new Set(selected());
    if (set.has(base)) {
      set.delete(base);
    } else {
      set.add(base);
    }
    // Index order, not click order, so the URL is stable regardless of how the
    // selection was assembled.
    setPicked(
      archetypeList()
        .filter(a => set.has(a.name))
        .map(a => a.name)
    );
  }

  // One resource keyed on the whole selection: archetype reports are ~23KB each
  // and fetchArchetype memoizes, so re-selecting a previously loaded archetype
  // costs nothing.
  const [reports] = createResource(
    () => ({ tournament: tournament(), bases: selected().join('~') }),
    async ({ tournament: key, bases }) => {
      const list = bases ? bases.split('~').filter(Boolean) : [];
      if (!list.length) {
        return [] as BinderArchetypeInput[];
      }
      const settled = await Promise.allSettled(list.map(base => fetchArchetype(key, base)));
      const byBase = new Map(archetypeList().map(a => [a.name, a]));
      const inputs: BinderArchetypeInput[] = [];
      list.forEach((base, i) => {
        const outcome = settled[i];
        // A single missing archetype report shouldn't empty the binder.
        if (outcome.status !== 'fulfilled') {
          return;
        }
        const entry = byBase.get(base);
        inputs.push({
          base,
          label: entry?.label ?? base,
          deckCount: entry?.deckCount ?? outcome.value.deckTotal ?? 0,
          items: outcome.value.items
        });
      });
      return inputs;
    }
  );

  const binder = createMemo(() => buildBinder(resolved(reports) ?? []));

  const priceFor = (card: BinderCard): number | null => {
    const entry = resolved(prices)?.[card.uid];
    return typeof entry?.price === 'number' ? entry.price : null;
  };

  /** Total for everything in the binder, at the copy counts it recommends. */
  const totalPrice = createMemo(() => {
    const table = resolved(prices);
    if (!table) {
      return null;
    }
    const b = binder();
    const all = [...b.sections.flatMap(s => s.cards), ...b.archetypeGroups.flatMap(g => g.cards)];
    let sum = 0;
    let priced = 0;
    for (const card of all) {
      const price = priceFor(card);
      if (price !== null) {
        sum += price * card.copies;
        priced += 1;
      }
    }
    return { sum, priced, total: all.length };
  });

  const loading = () => reports.loading && !resolved(reports);

  async function copyChecklist() {
    try {
      await navigator.clipboard.writeText(binderChecklist(binder()));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function printChecklist() {
    const win = window.open('', '_blank');
    if (!win) {
      return;
    }
    const heading = `Meta Binder — ${prettyTournamentName(tournament())}`;
    win.document.write(
      `<!doctype html><html><head><title>${heading}</title><style>` +
        'body{font:14px/1.5 system-ui,sans-serif;margin:32px;max-width:640px}' +
        'h1{font-size:18px;margin:0 0 16px}pre{white-space:pre-wrap;font:inherit}' +
        `</style></head><body><h1>${heading}</h1><pre>${binderChecklist(binder())}</pre></body></html>`
    );
    win.document.close();
    win.print();
  }

  const selectionControls = (
    <div class='mb-archetypes' role='group' aria-label='Archetypes'>
      <For each={archetypeList()}>
        {a => (
          <button
            type='button'
            class='chip mb-arche-chip'
            aria-pressed={selectedSet().has(a.name) ? 'true' : 'false'}
            onClick={() => toggleArchetype(a.name)}
          >
            <span>{a.label}</span>
            <span class='mb-arche-share num'>{(a.percent ?? 0).toFixed(1)}%</span>
          </button>
        )}
      </For>
    </div>
  );

  return (
    <div class='mb-page'>
      <section class='hero'>
        <h1>Meta Binder</h1>
        <div class='hero-meta'>
          <span>Work out which cards you need to own to build the decks people are actually playing</span>
        </div>
      </section>

      <div class='mb-controls'>
        <label class='mb-tournament'>
          Event
          <select
            value={tournament()}
            onChange={e => {
              // A different event has a different archetype list, so the old
              // selection can't carry over — reset to that event's default.
              setPicked(null);
              setSearchParams({ t: e.currentTarget.value, a: undefined }, { replace: true });
            }}
          >
            <For each={tournamentsData() ?? [ONLINE_META_NAME]}>
              {t => <option value={t}>{prettyTournamentName(t)}</option>}
            </For>
          </select>
        </label>

        <Show
          when={!isNarrow()}
          fallback={
            <button type='button' class='btn btn-secondary mb-sheet-trigger' onClick={() => setSheetOpen(true)}>
              {selected().length} archetype{selected().length === 1 ? '' : 's'}
            </button>
          }
        >
          {selectionControls}
        </Show>
      </div>

      <div class='mb-summary'>
        <div class='mb-summary-stat'>
          <b class='num'>{binder().cardCount}</b> cards
        </div>
        <div class='mb-summary-stat'>
          <b class='num'>{binder().copyCount}</b> copies
        </div>
        <div class='mb-summary-stat'>
          <b class='num'>{binder().totalDecks.toLocaleString()}</b> decks covered
        </div>
        {/* Prices resolve after the binder itself, and this row wraps: letting
            the stat appear at its natural width re-flowed the summary and
            dropped the action buttons a line. The slot holds its width and
            fades the number in instead. */}
        <div class='mb-summary-stat mb-summary-price' classList={{ 'is-ready': Boolean(totalPrice()) }}>
          <Show when={totalPrice()}>
            {price => (
              <>
                <b class='num'>${price().sum.toFixed(2)}</b>
                <Show when={price().priced < price().total}>
                  <span class='mb-unpriced'>{price().total - price().priced} unpriced</span>
                </Show>
              </>
            )}
          </Show>
        </div>
        <div class='mb-summary-actions'>
          <button type='button' class='btn btn-secondary' onClick={copyChecklist} disabled={!binder().cardCount}>
            {copied() ? 'Copied' : 'Copy list'}
          </button>
          <button type='button' class='btn btn-secondary' onClick={printChecklist} disabled={!binder().cardCount}>
            Print list
          </button>
        </div>
      </div>

      <Show when={!loading()} fallback={<BinderLoading />}>
        <Show
          when={binder().cardCount > 0}
          fallback={
            <EmptyState title='Nothing selected.' description='Pick at least one archetype to build a binder from.' />
          }
        >
          <For each={binder().sections.filter(s => s.cards.length > 0)}>
            {section => (
              <BinderSection title={section.title} count={section.cards.length}>
                <For each={section.cards}>{c => <BinderTile card={c} price={priceFor(c)} />}</For>
              </BinderSection>
            )}
          </For>
          <For each={binder().archetypeGroups}>
            {group => (
              <BinderSection title={group.label} count={group.cards.length} note={`${group.deckCount} decks`}>
                <For each={group.cards}>{c => <BinderTile card={c} price={priceFor(c)} />}</For>
              </BinderSection>
            )}
          </For>
        </Show>
      </Show>

      <BottomSheet open={sheetOpen()} onClose={() => setSheetOpen(false)} title='Archetypes'>
        {selectionControls}
      </BottomSheet>
    </div>
  );
}

function BinderLoading() {
  return (
    <div class='mb-grid' aria-busy='true'>
      {/* Shaped like `.mb-card` rather than a flat block: the art box is a 2.5:3.5
          aspect, so a tile's height follows its column width and no single pixel
          value is right at more than one breakpoint. */}
      <For each={Array.from({ length: 12 })}>
        {() => (
          <div class='mb-card mb-card-skeleton'>
            <div class='mb-card-img' />
            <div class='mb-card-meta'>
              <span class='mb-card-name'>
                <Skeleton width='75%' height='1em' />
              </span>
              <span class='mb-card-stats'>
                <Skeleton width='40%' height='1em' />
              </span>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

function BinderSection(props: { title: string; count: number; note?: string; children: unknown }) {
  return (
    <section class='mb-section'>
      <h2>
        {props.title}
        <span class='mb-section-count num'>{props.count}</span>
        <Show when={props.note}>
          <span class='mb-section-note'>{props.note}</span>
        </Show>
      </h2>
      <div class='mb-grid'>{props.children as never}</div>
    </section>
  );
}

function BinderTile(props: { card: BinderCard; price: number | null }) {
  const pct = () => Math.round(props.card.deckShare * 100);
  return (
    <div class='mb-card'>
      <div class='mb-card-img'>
        <Show
          when={props.card.set && props.card.number !== undefined}
          fallback={<div class='mb-card-ph'>{props.card.name}</div>}
        >
          <CardImage
            set={props.card.set!}
            number={props.card.number!}
            size='sm'
            alt={props.card.name}
            sizes='(max-width: 560px) 45vw, 160px'
          />
        </Show>
        <span class='mb-card-copies num' aria-label={`${props.card.copies} copies`}>
          {props.card.copies}×
        </span>
      </div>
      <div class='mb-card-meta'>
        <span class='mb-card-name' title={props.card.name}>
          {props.card.name}
        </span>
        <span class='mb-card-stats num'>
          {pct()}%
          <Show when={props.price !== null}>
            <span class='mb-card-price'>${(props.price! * props.card.copies).toFixed(2)}</span>
          </Show>
        </span>
      </div>
    </div>
  );
}

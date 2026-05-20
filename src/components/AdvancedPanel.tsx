import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from 'solid-js';
import type { ArchetypeReport, CardItem, Deck, DeckCard } from '../types';
import { fetchArchetypeDecks } from '../lib/data';
import { filterDecksBySuccess, generateReportForFilters } from '../utils/clientSideFiltering';
import { getSynonymDatabase } from '../utils/cardSynonyms';
import { getCanonicalCardFromData } from '../../shared/synonyms.js';
import { normalizeCardNumber } from '../../shared/cardUtils.js';
import { CardList, type CardListItem, type ViewMode } from './CardList';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';

type RuleMode = 'include' | 'exclude';
type CountOp = '>=' | '=' | '<=';

interface Rule {
  id: number;
  cardId: string;
  name: string;
  set?: string;
  number?: string | number;
  mode: RuleMode;
  countOp: CountOp;
  count: number;
}

const SUCCESS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All decks' },
  { value: 'winner', label: 'Winners' },
  { value: 'top2', label: 'Finals' },
  { value: 'top4', label: 'Top 4' },
  { value: 'top8', label: 'Top 8' },
  { value: 'top16', label: 'Top 16' },
  { value: 'top10', label: 'Top 10%' },
  { value: 'top25', label: 'Top 25%' },
  { value: 'top50', label: 'Top 50%' }
];

const OP_LABEL: Record<CountOp, string> = { '>=': '≥', '=': '=', '<=': '≤' };
const OP_CYCLE: Record<CountOp, CountOp> = { '>=': '=', '=': '<=', '<=': '>=' };

let ruleIdSeq = 0;
const nextRuleId = () => ++ruleIdSeq;

/**
 * Rewrite a deck card's (name, set, number) to the canonical printing, so the
 * filter aggregator sees the same SET~NUMBER that we build rule cardIds from.
 */
function canonicalizeDeckCard(card: DeckCard, db: Parameters<typeof getCanonicalCardFromData>[0]): DeckCard {
  if (!card?.name || !card?.set || card.number === undefined || card.number === null) {
    return card;
  }
  // Synonym DB keys numbers in zero-padded form (e.g. JTG::098), but deck
  // cards carry the raw integer (e.g. JTG/98). Normalize before lookup or the
  // mapping misses and the card stays on its non-canonical printing.
  const normalizedNumber = normalizeCardNumber(card.number) || String(card.number);
  const variantUid = `${card.name}::${card.set}::${normalizedNumber}`;
  const canonical = getCanonicalCardFromData(db, variantUid);
  if (canonical === variantUid) {
    return card;
  }
  const parts = canonical.split('::');
  if (parts.length < 3) {
    return card;
  }
  return { ...card, name: parts[0], set: parts[1], number: parts[2] };
}

/**
 * Build the `SET~NUMBER` cardId the same way clientSideFiltering does, so the
 * filter matches deck cards (which the aggregator keys by this same id).
 */
function buildCardId(set: string, number: string | number | null | undefined): string {
  if (number === undefined || number === null) {
    return `${set}~`;
  }
  const raw = String(number).trim();
  if (!raw) {
    return `${set}~`;
  }
  const match = /^(\d+)([A-Za-z]*)$/.exec(raw);
  if (!match) {
    return `${set}~${raw.toUpperCase()}`;
  }
  const [, digits, suffix = ''] = match;
  const normalized = digits.padStart(3, '0');
  const fullNumber = suffix ? `${normalized}${suffix.toUpperCase()}` : normalized;
  return `${set}~${fullNumber}`;
}

interface AdvancedPanelProps {
  slug: string;
  label: string;
  tournament: string;
  report: ArchetypeReport;
  viewMode: ViewMode;
}

export function AdvancedPanel(props: AdvancedPanelProps) {
  const [decks] = createResource(
    () => ({ t: props.tournament, slug: props.slug }),
    ({ t, slug }) => fetchArchetypeDecks(t, slug)
  );
  const [synonymDb] = createResource(() => getSynonymDatabase());

  /**
   * The data layer canonicalizes `cards.json` at read time (e.g. Dragapult ex
   * is reported under its canonical printing PRE/073 even though most decks
   * actually list TWM/130). The filter aggregator keys card counts by raw
   * `SET~NUMBER`, so without canonicalizing the deck-side cards too, a rule
   * built from the canonical printing would match zero decks. Walk each deck
   * once on load and rewrite each card's set/number to the canonical pair.
   */
  const canonicalDecks = createMemo(() => {
    const raw = decks();
    const db = synonymDb();
    if (!raw) {
      return raw;
    }
    if (!db) {
      return raw as Deck[];
    }
    return raw.map(deck => ({
      ...deck,
      cards: (deck.cards ?? []).map(card => canonicalizeDeckCard(card as DeckCard, db))
    })) as Deck[];
  });

  const [rules, setRules] = createSignal<Rule[]>([]);
  const [search, setSearch] = createSignal('');
  const [successFilter, setSuccessFilter] = createSignal('all');
  const [threshold, setThreshold] = createSignal(60);
  const [popoverOpen, setPopoverOpen] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal(0);

  // Debounced applied state — separate signal so filtering only re-runs after
  // the user stops fiddling for a beat.
  const [appliedRules, setAppliedRules] = createSignal<Rule[]>([]);
  const [appliedSuccess, setAppliedSuccess] = createSignal('all');

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelDebounce = () => {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
  };
  const schedule = () => {
    cancelDebounce();
    debounceTimer = setTimeout(() => {
      setAppliedRules(rules());
      setAppliedSuccess(successFilter());
    }, 200);
  };
  onCleanup(cancelDebounce);

  // When the user switches to a different archetype/tournament without the
  // component unmounting (e.g. tab stays on `advanced`), reset rule state and
  // cancel any pending debounce so a stale apply doesn't fire onto the new
  // archetype's signals.
  createEffect(
    on(
      [() => props.slug, () => props.tournament],
      () => {
        cancelDebounce();
        setRules([]);
        setSuccessFilter('all');
        setAppliedRules([]);
        setAppliedSuccess('all');
      },
      { defer: true }
    )
  );

  function updateRules(updater: (prev: Rule[]) => Rule[]) {
    setRules(updater);
    schedule();
  }

  function updateSuccess(v: string) {
    setSuccessFilter(v);
    schedule();
  }

  function reset() {
    setRules([]);
    setSuccessFilter('all');
    setThreshold(60);
    setAppliedRules([]);
    setAppliedSuccess('all');
  }

  function applyNow() {
    if (debounceTimer !== undefined) {
      window.clearTimeout(debounceTimer);
    }
    setAppliedRules(rules());
    setAppliedSuccess(successFilter());
  }

  // ----- Search/autocomplete -----

  const candidates = createMemo<CardItem[]>(() => {
    const q = search().trim().toLowerCase();
    if (!q) {
      return [];
    }
    const taken = new Set(rules().map(r => r.cardId));
    const items = props.report.items.filter(i => {
      if (!i.set || i.number === undefined) {
        return false;
      }
      const cardId = buildCardId(i.set, i.number);
      if (taken.has(cardId)) {
        return false;
      }
      return i.name.toLowerCase().includes(q);
    });
    return items.slice(0, 8);
  });

  function addRuleFromItem(item: CardItem) {
    if (!item.set || item.number === undefined) {
      return;
    }
    const cardId = buildCardId(item.set, item.number);
    const rule: Rule = {
      id: nextRuleId(),
      cardId,
      name: item.name,
      set: item.set,
      number: item.number,
      mode: 'include',
      countOp: '>=',
      count: 1
    };
    updateRules(prev => [...prev, rule]);
    setSearch('');
    setPopoverOpen(false);
    setHighlighted(0);
  }

  function removeRule(id: number) {
    updateRules(prev => prev.filter(r => r.id !== id));
  }

  function toggleMode(id: number) {
    updateRules(prev =>
      prev.map(r => (r.id === id ? { ...r, mode: r.mode === 'include' ? 'exclude' : 'include' } : r))
    );
  }

  function cycleOp(id: number) {
    updateRules(prev => prev.map(r => (r.id === id ? { ...r, countOp: OP_CYCLE[r.countOp] } : r)));
  }

  function setCount(id: number, raw: string) {
    if (raw.trim() === '') {
      // Hold the rule in an "incomplete" state instead of forcing the value to 0.
      // Otherwise the field re-renders to "0" mid-typing, blocking the user from
      // clearing the field to type a new number.
      updateRules(prev => prev.map(r => (r.id === id ? { ...r, count: Number.NaN } : r)));
      return;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) {
      return;
    }
    updateRules(prev => prev.map(r => (r.id === id ? { ...r, count: n } : r)));
  }

  function onSearchKey(e: KeyboardEvent) {
    const list = candidates();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(h => Math.min(list.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = list[highlighted()];
      if (item) {
        addRuleFromItem(item);
      }
    } else if (e.key === 'Escape') {
      setPopoverOpen(false);
    }
  }

  // ----- Filter math -----

  const activeFilters = createMemo(() =>
    appliedRules()
      // Skip rules whose count is mid-edit (NaN). Otherwise the aggregator would
      // compare against NaN and silently match zero decks.
      .filter(r => r.mode === 'exclude' || Number.isFinite(r.count))
      .map(r => ({
        cardId: r.cardId,
        operator: r.mode === 'exclude' ? ('' as const) : (r.countOp as '>=' | '=' | '<='),
        count: r.mode === 'exclude' ? null : r.count
      }))
  );

  const filteredReport = createMemo(() => {
    const d = canonicalDecks();
    if (!d) {
      return null;
    }
    const successed = appliedSuccess() === 'all' ? d : filterDecksBySuccess(d, appliedSuccess());
    return generateReportForFilters(successed, props.slug, activeFilters());
  });

  const matchCount = createMemo(() => filteredReport()?.deckTotal ?? 0);
  const sharePct = createMemo(() => {
    const total = props.report.deckTotal;
    if (!total) {
      return 0;
    }
    return (matchCount() / total) * 100;
  });

  const displayedItems = createMemo<CardListItem[]>(() => {
    const r = filteredReport();
    if (!r) {
      return [];
    }
    const t = threshold();
    return (r.items as unknown as CardListItem[]).filter(i => (i.pct ?? 0) >= t);
  });

  // ----- Render -----

  return (
    <div class='advanced-panel'>
      <div class='fb-frame'>
        <div class='fb-title'>Filter {props.label} decks</div>

        <div class='fb-controls'>
          <label class='fb-field'>
            <span class='fb-field-label'>Tournament finish</span>
            <select class='fb-select' value={successFilter()} onChange={e => updateSuccess(e.currentTarget.value)}>
              <For each={SUCCESS_OPTIONS}>{opt => <option value={opt.value}>{opt.label}</option>}</For>
            </select>
          </label>

          <label class='fb-field'>
            <span class='fb-field-label'>
              Inclusion threshold <output class='fb-threshold-out'>{threshold()}%</output>
            </span>
            <input
              type='range'
              min='0'
              max='100'
              step='5'
              value={threshold()}
              onInput={e => setThreshold(Number(e.currentTarget.value))}
              class='fb-range'
            />
          </label>
        </div>

        <div class='fb-b-search' style={{ position: 'relative' }}>
          <span class='fb-b-search-icon'>+</span>
          <input
            type='text'
            placeholder='Search a card to add a rule…'
            value={search()}
            onInput={e => {
              setSearch(e.currentTarget.value);
              setPopoverOpen(true);
              setHighlighted(0);
            }}
            onFocus={() => setPopoverOpen(true)}
            onBlur={() => window.setTimeout(() => setPopoverOpen(false), 120)}
            onKeyDown={onSearchKey}
          />
          <Show when={popoverOpen() && candidates().length > 0}>
            <div class='fb-b-popover'>
              <For each={candidates()}>
                {(item, idx) => (
                  <div
                    class={`item ${idx() === highlighted() ? 'highlighted' : ''}`}
                    onMouseDown={e => {
                      e.preventDefault();
                      addRuleFromItem(item);
                    }}
                    onMouseEnter={() => setHighlighted(idx())}
                  >
                    <span class='name'>{item.name}</span>
                    <span class='meta'>
                      {item.set}/{item.number} · {(item.pct ?? 0).toFixed(1)}%
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        <Show when={rules().length > 0}>
          <div class='fb-b-rules-head'>
            Active rules · <b>{rules().length}</b>
          </div>
          <For each={rules()}>
            {rule => (
              <div class='fb-b-row'>
                <span class='card-name'>{rule.name}</span>
                <button
                  type='button'
                  class={`op-select ${rule.mode}`}
                  onClick={() => toggleMode(rule.id)}
                  title='Toggle include/exclude'
                >
                  {rule.mode === 'include' ? '+ Must include' : '− Must exclude'}
                </button>
                <div class={`count-input ${rule.mode === 'exclude' ? 'disabled' : ''}`}>
                  <button
                    type='button'
                    class='op-label'
                    onClick={() => cycleOp(rule.id)}
                    disabled={rule.mode === 'exclude'}
                    title='Cycle operator'
                  >
                    {rule.mode === 'exclude' ? '—' : OP_LABEL[rule.countOp]}
                  </button>
                  <input
                    type='number'
                    min='0'
                    max='60'
                    value={rule.mode === 'exclude' || !Number.isFinite(rule.count) ? '' : rule.count}
                    disabled={rule.mode === 'exclude'}
                    onInput={e => setCount(rule.id, e.currentTarget.value)}
                  />
                </div>
                <button class='remove' onClick={() => removeRule(rule.id)} aria-label='Remove rule'>
                  ✕
                </button>
              </div>
            )}
          </For>
        </Show>

        <div class='fb-foot'>
          <Show
            when={!decks.loading && decks() !== null}
            fallback={
              <span class='fb-count fb-count-muted'>
                <Show when={decks.loading} fallback={<>Decks unavailable for this archetype.</>}>
                  Loading deck data…
                </Show>
              </span>
            }
          >
            <span class='fb-count'>
              <b>{matchCount().toLocaleString()}</b> {matchCount() === 1 ? 'deck' : 'decks'} match
              <Show when={props.report.deckTotal > 0}>
                {' '}
                · {sharePct().toFixed(1)}% of {props.label} lists
              </Show>
            </span>
          </Show>
          <div class='fb-actions'>
            <button class='btn btn-ghost' type='button' onClick={reset}>
              Reset
            </button>
            <button class='btn btn-primary' type='button' onClick={applyNow}>
              Apply filter →
            </button>
          </div>
        </div>
      </div>

      <Show
        when={decks() !== null && !decks.loading}
        fallback={
          <Show when={decks.loading} fallback={<EmptyState title='No per-deck data for this archetype yet.' />}>
            <div style={{ 'margin-top': '24px' }}>
              <Skeleton height='320px' />
            </div>
          </Show>
        }
      >
        <div style={{ 'margin-top': '24px' }}>
          <CardList
            title={appliedRules().length || appliedSuccess() !== 'all' ? 'Filtered cards' : 'All cards'}
            items={displayedItems()}
            viewMode={props.viewMode}
            emptyMessage={
              matchCount() === 0
                ? 'No decks match these filters.'
                : `No cards above ${threshold()}% in the filtered subset.`
            }
            rightSlot={`${displayedItems().length.toLocaleString()} cards · ≥ ${threshold()}%`}
            hideEmptyBuckets={appliedRules().length > 0}
          />
        </div>
      </Show>
    </div>
  );
}

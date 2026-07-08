import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import type { ArchetypeReport, CardItem, Deck, DeckCard } from '../types';
import { fetchArchetypeDecks } from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import { filterDecks, filterDecksBySuccess, generateReportAndCooccurrence } from '../utils/clientSideFiltering';
import { getSynonymDatabase } from '../utils/cardSynonyms';
import { buildCardId, canonicalizeDeckCard } from '../utils/deckCardId';
import {
  buildCooccurrence,
  type CardRef,
  type ComplementSuggestion,
  findComplements,
  findSubstituteQuestions,
  type SubstituteQuestion
} from '../utils/cardCooccurrence';
import { buildPtcglDeck, type PtcglEntry } from '../utils/ptcglExport';
import { averageCopiesValue, roundedCopies } from '../lib/cardStats';
import {
  type CountOp,
  decodeBuildState,
  DEFAULT_SUCCESS,
  DEFAULT_THRESHOLD,
  encodeBuildState,
  type PersistedRule,
  type Rule
} from '../utils/buildState';
import { CardList, type CardListItem, type ViewMode } from './CardList';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';

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

const DECK_TARGET = 60;

let ruleIdSeq = 0;
const nextRuleId = () => ++ruleIdSeq;

// Router params can be repeated (string[]); collapse to the first value.
const firstParam = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

// Cheap deep-enough equality for the reconciliation in `displayedItems` below.
// Both candidates are report items for the SAME cardId, so identity fields
// (name/set/number) can't differ — only the aggregated stats can. Comparing
// those directly is far cheaper than the JSON round-trip this used to do,
// which showed up hot when the threshold slider re-ran the reconciliation.
function shallowEqualCardItem(a: CardListItem, b: CardListItem): boolean {
  if (a.pct !== b.pct || a.found !== b.found || a.total !== b.total || a.rank !== b.rank) {
    return false;
  }
  const distA = a.dist ?? [];
  const distB = b.dist ?? [];
  if (distA.length !== distB.length) {
    return false;
  }
  for (let i = 0; i < distA.length; i++) {
    if (
      distA[i].copies !== distB[i].copies ||
      distA[i].players !== distB[i].players ||
      distA[i].percent !== distB[i].percent
    ) {
      return false;
    }
  }
  return true;
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
    // Wait for BOTH the decks and the synonym DB before canonicalizing. If we
    // returned the raw decks while the DB is still pending, downstream memos
    // would run once against raw deck objects (populating the identity-keyed
    // deckCardCountsCache in clientSideFiltering for those objects) and then a
    // second time once the DB resolves and every deck is cloned — throwing away
    // that cache and doubling the aggregation work. `getSynonymDatabase` always
    // resolves (falls back to an empty DB on failure), so this never stalls.
    if (!db) {
      return undefined;
    }
    return raw.map(deck => ({
      ...deck,
      cards: (deck.cards ?? []).map(card => canonicalizeDeckCard(card as DeckCard, db))
    })) as Deck[];
  });

  // Look up a report card by the SET~NUMBER id rules/decks use, so a shared
  // build (which only carries cardIds) can be re-hydrated with display fields.
  const itemByCardId = createMemo(() => {
    const map = new Map<string, CardItem>();
    for (const item of props.report.items as CardItem[]) {
      if (item.set && item.number !== undefined && item.number !== null) {
        map.set(buildCardId(item.set, item.number), item);
      }
    }
    return map;
  });

  // Archetype-wide inclusion rate per card (cardId → fraction), derived from a
  // co-occurrence over ALL canonicalized decks. Built the same way the filtered
  // context is, so the cardIds line up exactly (deriving the baseline from the
  // report instead mis-keys energy/reprints and the niche math silently fails).
  const baselinePct = createMemo(() => {
    const d = canonicalDecks();
    const map = new Map<string, number>();
    if (!d || !d.length) {
      return map;
    }
    const full = buildCooccurrence(d, props.report.items);
    if (!full.totalDecks) {
      return map;
    }
    for (const [cardId, entry] of full.presence) {
      map.set(cardId, entry.count / full.totalDecks);
    }
    return map;
  });

  function rulesFromPersisted(persisted: PersistedRule[]): Rule[] {
    const map = itemByCardId();
    const out: Rule[] = [];
    for (const p of persisted) {
      const item = map.get(p.cardId);
      if (!item) {
        // Drop cardIds that aren't in this archetype (e.g. a rotated list).
        continue;
      }
      out.push({
        id: nextRuleId(),
        cardId: p.cardId,
        name: item.name,
        set: item.set,
        number: item.number,
        mode: p.mode,
        countOp: p.countOp,
        count: p.count
      });
    }
    return out;
  }

  const [searchParams, setSearchParams] = useSearchParams();
  const { tournament: selectedTournament } = useTournament();

  // Hydrate the initial build from the URL (shareable + survives reload).
  const initial = decodeBuildState({
    b: firstParam(searchParams.b),
    s: firstParam(searchParams.s),
    t: firstParam(searchParams.t)
  });
  // eslint-disable-next-line solid/reactivity -- intentional one-shot hydration of the initial build from the URL; later URL changes flow through setSearchParams, not back into this seed
  const initialRules = rulesFromPersisted(initial.rules);
  const initialSuccess = initial.successFilter ?? DEFAULT_SUCCESS;
  const initialThreshold = initial.threshold ?? DEFAULT_THRESHOLD;

  const [rules, setRules] = createSignal<Rule[]>(initialRules);
  const [search, setSearch] = createSignal('');
  const [successFilter, setSuccessFilter] = createSignal(initialSuccess);
  const [threshold, setThreshold] = createSignal(initialThreshold);
  const [popoverOpen, setPopoverOpen] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal(0);

  // Build-toward-60 tooling state.
  const [questionsOpen, setQuestionsOpen] = createSignal(false);
  const [skipped, setSkipped] = createSignal<Set<string>>(new Set());
  const [copyMsg, setCopyMsg] = createSignal('');

  // Debounced applied state — separate signal so filtering only re-runs after
  // the user stops fiddling for a beat.
  const [appliedRules, setAppliedRules] = createSignal<Rule[]>(initialRules);
  const [appliedSuccess, setAppliedSuccess] = createSignal(initialSuccess);
  const [appliedThreshold, setAppliedThreshold] = createSignal(initialThreshold);

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
      setAppliedThreshold(threshold());
    }, 200);
  };
  onCleanup(cancelDebounce);

  // The threshold slider fires setThreshold on every input event while dragging.
  // The visual `{threshold()}%` output stays instant (it reads the signal
  // directly), but the URL write is debounced so the router isn't hammered with
  // a setSearchParams per tick. Rules/bracket are already debounced upstream, so
  // this only really throttles the slider.
  let urlWriteTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelUrlWrite = () => {
    if (urlWriteTimer !== undefined) {
      clearTimeout(urlWriteTimer);
      urlWriteTimer = undefined;
    }
  };
  onCleanup(cancelUrlWrite);

  // Mirror the applied build into the URL so it can be shared / survives a
  // reload. Runs once on mount re-writing the hydrated params (idempotent), and
  // again whenever the applied rules / bracket / threshold change. `replace`
  // keeps build tweaks out of the history stack. The effect tracks the signals
  // synchronously but defers the actual write ~300ms.
  createEffect(() => {
    const params = encodeBuildState({
      rules: appliedRules(),
      successFilter: appliedSuccess(),
      threshold: threshold()
    });
    cancelUrlWrite();
    urlWriteTimer = setTimeout(() => {
      urlWriteTimer = undefined;
      setSearchParams({ b: params.b, s: params.s, t: params.t }, { replace: true });
    }, 300);
  });

  // When the user switches to a different archetype/tournament without the
  // component unmounting (e.g. tab stays on `advanced`), reset all build state
  // and cancel any pending debounce so a stale apply doesn't fire onto the new
  // archetype's signals. The URL effect above then clears the stale params.
  createEffect(
    on(
      [() => props.slug, () => props.tournament],
      () => {
        cancelDebounce();
        cancelUrlWrite();
        setRules([]);
        setSuccessFilter(DEFAULT_SUCCESS);
        setThreshold(DEFAULT_THRESHOLD);
        setAppliedRules([]);
        setAppliedSuccess(DEFAULT_SUCCESS);
        setSkipped(new Set<string>());
        setQuestionsOpen(false);
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
    setSuccessFilter(DEFAULT_SUCCESS);
    setThreshold(DEFAULT_THRESHOLD);
    setAppliedRules([]);
    setAppliedSuccess(DEFAULT_SUCCESS);
    setSkipped(new Set<string>());
    setQuestionsOpen(false);
  }

  function applyNow() {
    cancelDebounce();
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

  function ruleFromCard(card: { name: string; set?: string; number?: string | number }): Rule {
    return {
      id: nextRuleId(),
      cardId: buildCardId(card.set as string, card.number),
      name: card.name,
      set: card.set,
      number: card.number,
      mode: 'include',
      countOp: '>=',
      count: 1
    };
  }

  function addRuleFromItem(item: CardItem) {
    if (!item.set || item.number === undefined) {
      return;
    }
    updateRules(prev => [...prev, ruleFromCard(item)]);
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

  // Decks matching the current bracket + rules — the subset the report and the
  // co-occurrence analysis are built from.
  const filteredDecks = createMemo<Deck[] | null>(() => {
    const d = canonicalDecks();
    if (!d) {
      return null;
    }
    const successed = appliedSuccess() === 'all' ? d : filterDecksBySuccess(d, appliedSuccess());
    return filterDecks(successed, props.slug, activeFilters());
  });

  // Aggregate the report and the co-occurrence presence index in ONE pass over
  // the filtered subset. Deriving them separately (generateReportForFilters +
  // buildCooccurrence) walks every (deck × card) twice on each apply.
  const filteredAnalysis = createMemo(() => {
    const d = filteredDecks();
    if (!d) {
      return null;
    }
    return generateReportAndCooccurrence(d, props.slug, []);
  });

  const filteredReport = createMemo(() => filteredAnalysis()?.report ?? null);

  const matchCount = createMemo(() => filteredReport()?.deckTotal ?? 0);
  const sharePct = createMemo(() => {
    const total = props.report.deckTotal;
    if (!total) {
      return 0;
    }
    return (matchCount() / total) * 100;
  });

  // `filteredReport()` is rebuilt from scratch on every apply (generateReportAndCooccurrence
  // creates brand-new item objects), so CardList's <For each> — which is reference-keyed —
  // would tear down and remount every CardTile (including its CardImage) on each filter
  // change even when a card's numbers didn't move. Reconcile by cardId here: reuse the
  // previous item object whenever its content is unchanged, so <For> sees the same
  // reference and leaves that tile mounted.
  let prevItemsById = new Map<string, CardListItem>();
  const displayedItems = createMemo<CardListItem[]>(() => {
    const r = filteredReport();
    if (!r) {
      prevItemsById = new Map();
      return [];
    }
    // Debounced (see `schedule`): the slider fires per drag tick, and this memo
    // re-filters + reconciles the whole report — the readout stays on the raw
    // `threshold()` so the % label still tracks the thumb instantly.
    const t = appliedThreshold();
    const filtered = (r.items as unknown as CardListItem[]).filter(i => (i.pct ?? 0) >= t);
    const nextItemsById = new Map<string, CardListItem>();
    const reconciled = filtered.map(item => {
      const cardId = item.set && item.number !== undefined ? buildCardId(item.set, item.number) : undefined;
      if (cardId) {
        const prev = prevItemsById.get(cardId);
        if (prev && shallowEqualCardItem(prev, item)) {
          nextItemsById.set(cardId, prev);
          return prev;
        }
        nextItemsById.set(cardId, item);
      }
      return item;
    });
    prevItemsById = nextItemsById;
    return reconciled;
  });

  // ----- Build-toward-60 derived state -----

  const poolTotal = createMemo(() =>
    displayedItems().reduce((sum, item) => {
      const avg = averageCopiesValue(item);
      return avg === null ? sum : sum + roundedCopies(item, avg);
    }, 0)
  );

  const cooccurrence = createMemo(() => filteredAnalysis()?.cooccurrence ?? null);

  const activeRuleIds = createMemo(() => new Set(rules().map(r => r.cardId)));
  const includeRuleIds = createMemo(() =>
    rules()
      .filter(r => r.mode === 'include')
      .map(r => r.cardId)
  );
  const excludeRuleIds = createMemo(
    () =>
      new Set(
        rules()
          .filter(r => r.mode === 'exclude')
          .map(r => r.cardId)
      )
  );

  const questions = createMemo<SubstituteQuestion[]>(() => {
    const ctx = cooccurrence();
    if (!ctx || matchCount() < 8) {
      return [];
    }
    return findSubstituteQuestions(ctx, { excludeCardIds: activeRuleIds() }).filter(q => !skipped().has(q.id));
  });

  const complements = createMemo<ComplementSuggestion[]>(() => {
    const ctx = cooccurrence();
    const picks = includeRuleIds();
    if (!ctx || !picks.length) {
      return [];
    }
    const excluded = excludeRuleIds();
    return findComplements(ctx, picks, { baselinePct: baselinePct() }).filter(c => !excluded.has(c.ref.cardId));
  });

  function optionPct(opt: CardRef): string {
    const ctx = cooccurrence();
    const entry = ctx?.presence.get(opt.cardId);
    if (!ctx || !entry || !ctx.totalDecks) {
      return '0';
    }
    return ((entry.count / ctx.totalDecks) * 100).toFixed(0);
  }

  // Answering instantly re-derives questions()[0] into the same spot, so the
  // second click of a stray double-click would land on (and commit) the *next*
  // question. Briefly lock every quiz action after each one to absorb it.
  const [answerLocked, setAnswerLocked] = createSignal(false);
  let answerLockTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (answerLockTimer !== undefined) {
      clearTimeout(answerLockTimer);
    }
  });
  function withAnswerLock(apply: () => void) {
    if (answerLocked()) {
      return;
    }
    setAnswerLocked(true);
    apply();
    if (answerLockTimer !== undefined) {
      clearTimeout(answerLockTimer);
    }
    answerLockTimer = setTimeout(() => setAnswerLocked(false), 400);
  }

  function excludeRuleFor(opt: CardRef): Rule {
    return {
      id: nextRuleId(),
      cardId: opt.cardId,
      name: opt.name,
      set: opt.set,
      number: opt.number,
      mode: 'exclude',
      countOp: '>=',
      count: 0
    };
  }

  function answerQuestion(q: SubstituteQuestion, chosen: CardRef) {
    withAnswerLock(() =>
      updateRules(prev => {
        const next = [...prev];
        if (!next.some(r => r.cardId === chosen.cardId)) {
          next.push(ruleFromCard(chosen));
        }
        for (const opt of q.options) {
          if (opt.cardId === chosen.cardId || next.some(r => r.cardId === opt.cardId)) {
            continue;
          }
          next.push(excludeRuleFor(opt));
        }
        return next;
      })
    );
  }

  // Run every option in this slot…
  function answerBoth(q: SubstituteQuestion) {
    withAnswerLock(() =>
      updateRules(prev => {
        const next = [...prev];
        for (const opt of q.options) {
          if (!next.some(r => r.cardId === opt.cardId)) {
            next.push(ruleFromCard(opt));
          }
        }
        return next;
      })
    );
  }

  // …or none of them.
  function answerNeither(q: SubstituteQuestion) {
    withAnswerLock(() =>
      updateRules(prev => {
        const next = [...prev];
        for (const opt of q.options) {
          if (!next.some(r => r.cardId === opt.cardId)) {
            next.push(excludeRuleFor(opt));
          }
        }
        return next;
      })
    );
  }

  function skipQuestion(id: string) {
    withAnswerLock(() =>
      setSkipped(prev => {
        const next = new Set(prev);
        next.add(id);
        return next;
      })
    );
  }

  function addComplement(ref: CardRef) {
    updateRules(prev => (prev.some(r => r.cardId === ref.cardId) ? prev : [...prev, ruleFromCard(ref)]));
  }

  // ----- PTCGL export -----

  function ptcglEntries(): PtcglEntry[] {
    return displayedItems().reduce<PtcglEntry[]>((acc, item) => {
      const avg = averageCopiesValue(item);
      if (avg === null) {
        return acc;
      }
      acc.push({
        name: item.name,
        set: item.set,
        number: item.number,
        category: item.category,
        supertype: item.supertype,
        count: roundedCopies(item, avg)
      });
      return acc;
    }, []);
  }

  let copyMsgTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (copyMsgTimer !== undefined) {
      clearTimeout(copyMsgTimer);
    }
  });
  function flashCopyMsg(msg: string) {
    setCopyMsg(msg);
    if (copyMsgTimer !== undefined) {
      clearTimeout(copyMsgTimer);
    }
    copyMsgTimer = setTimeout(() => setCopyMsg(''), 2500);
  }

  async function copyPtcgl() {
    const { text } = buildPtcglDeck(ptcglEntries());
    try {
      await navigator.clipboard.writeText(text);
      flashCopyMsg('List copied!');
    } catch {
      flashCopyMsg('Copy failed');
    }
  }

  // Copy a link that reproduces this exact view — archetype (path), tournament
  // (the `tour` param), and every filter/threshold/bracket (the build params the
  // URL effect already maintains).
  async function shareLink() {
    const url = new URL(window.location.href);
    url.searchParams.set('tour', selectedTournament());
    try {
      await navigator.clipboard.writeText(url.toString());
      flashCopyMsg('Link copied!');
    } catch {
      flashCopyMsg('Copy failed');
    }
  }

  // ----- Render -----

  return (
    <div class='advanced-panel'>
      <div class='fb-frame'>
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
              onInput={e => {
                setThreshold(Number(e.currentTarget.value));
                schedule();
              }}
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

        <Show when={questions().length > 0}>
          <div class='fb-quiz-section'>
            <button class='fb-narrow' type='button' onClick={() => setQuestionsOpen(o => !o)}>
              {questionsOpen() ? 'Hide choices' : `Help me choose · ${questions().length} either/or →`}
            </button>
            <Show when={questionsOpen() ? questions()[0] : undefined}>
              {q => (
                <div class='fb-quiz'>
                  <div class='fb-quiz-head'>Which do you run?</div>
                  <div class='fb-quiz-options'>
                    <For each={q().options}>
                      {opt => (
                        <button class='fb-quiz-opt' type='button' onClick={() => answerQuestion(q(), opt)}>
                          <span class='name'>{opt.name}</span>
                          <span class='pct'>{optionPct(opt)}%</span>
                        </button>
                      )}
                    </For>
                  </div>
                  <div class='fb-quiz-foot'>
                    <button type='button' onClick={() => answerBoth(q())}>
                      {q().options.length > 2 ? 'All' : 'Both'}
                    </button>
                    <button type='button' onClick={() => answerNeither(q())}>
                      Neither
                    </button>
                    <button type='button' onClick={() => skipQuestion(q().id)}>
                      Skip
                    </button>
                  </div>
                </div>
              )}
            </Show>
          </div>
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
        <div class='fb-build' style={{ 'margin-top': '24px' }}>
          <div class='fb-bar'>
            <div
              class='fb-bar-meter'
              title='Cards counted by their average number of copies — a guide toward a full 60, not a hard limit.'
            >
              <span class='fb-bar-count'>
                <b>{poolTotal()}</b> / {DECK_TARGET} cards
              </span>
              <div
                class={`fb-bar-track ${poolTotal() === DECK_TARGET ? 'is-complete' : poolTotal() > DECK_TARGET ? 'is-over' : ''}`}
              >
                <div class='fb-bar-fill' style={{ width: `${Math.min(100, (poolTotal() / DECK_TARGET) * 100)}%` }} />
              </div>
              <Show when={poolTotal() > DECK_TARGET}>
                <span class='fb-bar-over'>{poolTotal() - DECK_TARGET} over</span>
              </Show>
            </div>
            <div class='fb-bar-actions'>
              <Show when={copyMsg()}>
                <span class='fb-bar-msg'>{copyMsg()}</span>
              </Show>
              <button
                class='fb-bar-btn'
                type='button'
                onClick={copyPtcgl}
                disabled={poolTotal() === 0}
                title='Copy this pool as a PTCGL decklist'
              >
                Copy list
              </button>
              <button class='fb-bar-btn' type='button' onClick={shareLink} title='Copy a link that restores this view'>
                Share
              </button>
            </div>
          </div>

          <Show when={complements().length > 0}>
            <div class='fb-suggest'>
              <span class='fb-suggest-label'>Niche partners</span>
              <For each={complements()}>
                {c => (
                  <button
                    class='fb-suggest-chip'
                    type='button'
                    onClick={() => addComplement(c.ref)}
                    title={
                      c.basePct !== undefined
                        ? `${c.ref.name}: ${(c.coPct * 100).toFixed(0)}% of these decks vs ${(c.basePct * 100).toFixed(0)}% archetype-wide`
                        : `${(c.coPct * 100).toFixed(0)}% of these decks also run ${c.ref.name}`
                    }
                  >
                    <span class='name'>{c.ref.name}</span>
                    <span class='pct'>{(c.coPct * 100).toFixed(0)}%</span>
                    <span class='plus'>+</span>
                  </button>
                )}
              </For>
            </div>
          </Show>

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

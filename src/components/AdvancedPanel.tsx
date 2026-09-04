import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import type { ArchetypeReport, CardItem, Deck } from '../types';
import { fetchArchetypeDecks } from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import { generateReportAndCooccurrence } from '../../shared/clientSideFiltering';
import { getSynonymDatabase } from '../utils/cardSynonyms';
import { buildCanonicalCardId, buildCardId } from '../../shared/deckCardId';
import {
  type CardRef,
  type ComplementSuggestion,
  findComplements,
  findSubstituteQuestions,
  type SubstituteQuestion
} from '../../shared/cardCooccurrence';
import {
  applyFilters,
  buildBaselinePct,
  canonicalizeDecks,
  inclusionPct,
  indexItemsByCardId,
  reconcileDisplayedItems,
  rulesFromPersisted as rulesFromPersistedPure,
  rulesToFilters,
  searchCandidates
} from './advancedPanel/model';
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

interface AdvancedPanelProps {
  slug: string;
  label: string;
  tournament: string;
  report: ArchetypeReport;
  viewMode: ViewMode;
}

function useAdvancedPanel(props: AdvancedPanelProps) {
  const [decks] = createResource(
    () => ({ t: props.tournament, slug: props.slug }),
    ({ t, slug }) => fetchArchetypeDecks(t, slug)
  );
  const [synonymDb] = createResource(() => getSynonymDatabase());

  // Defer cached-data aggregation until after the shell's first paint.
  const [painted, setPainted] = createSignal(false);
  requestAnimationFrame(() => {
    setTimeout(() => setPainted(true), 0);
  });

  // Reports and decklists must use the same canonical printing before filtering.
  const canonicalDecks = createMemo(() => {
    if (!painted()) {
      return undefined;
    }
    const raw = decks();
    const db = synonymDb();
    if (!raw) {
      return raw;
    }
    // Waiting for both avoids populating deck caches twice under different objects.
    if (!db) {
      return undefined;
    }
    return canonicalizeDecks(raw, db);
  });

  // Index by the global match key used by persisted rules and canonical decks.
  const itemByCardId = createMemo(() => indexItemsByCardId(props.report.items as CardItem[], synonymDb() ?? null));

  // Derive the baseline from canonical decks so match keys remain aligned.
  const baselinePct = createMemo(() => buildBaselinePct(canonicalDecks() ?? [], props.report.items));

  function rulesFromPersisted(persisted: PersistedRule[]): Rule[] {
    return rulesFromPersistedPure(persisted, itemByCardId(), nextRuleId);
  }

  const [searchParams, setSearchParams] = useSearchParams();
  const { tournament: selectedTournament } = useTournament();

  const initial = decodeBuildState({
    b: firstParam(searchParams.b),
    s: firstParam(searchParams.s),
    t: firstParam(searchParams.t)
  });
  // eslint-disable-next-line solid/reactivity -- intentional one-shot hydration of the initial build from the URL; later URL changes flow through setSearchParams, not back into this seed
  const initialRules = rulesFromPersisted(initial.rules);
  // Keep malformed shared links from reaching the strict success filter.
  const initialSuccess =
    initial.successFilter && SUCCESS_OPTIONS.some(o => o.value === initial.successFilter)
      ? initial.successFilter
      : DEFAULT_SUCCESS;
  const initialThreshold = initial.threshold ?? DEFAULT_THRESHOLD;

  const [rules, setRules] = createSignal<Rule[]>(initialRules);
  const [search, setSearch] = createSignal('');
  const [successFilter, setSuccessFilter] = createSignal(initialSuccess);
  const [threshold, setThreshold] = createSignal(initialThreshold);
  const [popoverOpen, setPopoverOpen] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal(0);

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

  // Keep the slider responsive while debouncing URL and aggregation work.
  let urlWriteTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelUrlWrite = () => {
    if (urlWriteTimer !== undefined) {
      clearTimeout(urlWriteTimer);
      urlWriteTimer = undefined;
    }
  };
  onCleanup(cancelUrlWrite);

  // Mirror applied state into a replace-only, shareable URL.
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

  // Reset when the resource identity changes without an unmount.
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
        setAppliedThreshold(DEFAULT_THRESHOLD);
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
    // Cancel any pending debounce so a stale apply can't resurrect the old
    // threshold/rules onto the freshly-reset state.
    cancelDebounce();
    setRules([]);
    setSuccessFilter(DEFAULT_SUCCESS);
    setThreshold(DEFAULT_THRESHOLD);
    setAppliedRules([]);
    setAppliedSuccess(DEFAULT_SUCCESS);
    setAppliedThreshold(DEFAULT_THRESHOLD);
    setSkipped(new Set<string>());
    setQuestionsOpen(false);
  }

  function applyNow() {
    cancelDebounce();
    setAppliedRules(rules());
    setAppliedSuccess(successFilter());
    setAppliedThreshold(threshold());
  }

  // ----- Search/autocomplete -----

  const candidates = createMemo<CardItem[]>(() =>
    searchCandidates(props.report.items, search(), new Set(rules().map(r => r.cardId)), synonymDb() ?? null)
  );

  function ruleFromCard(card: { name: string; set?: string; number?: string | number }): Rule {
    return {
      id: nextRuleId(),
      cardId: buildCanonicalCardId(card, synonymDb() ?? null) ?? buildCardId(card.set as string, card.number),
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

  const activeFilters = createMemo(() => rulesToFilters(appliedRules()));

  // Decks matching the current bracket + rules — the subset the report and the
  // co-occurrence analysis are built from.
  const filteredDecks = createMemo<Deck[] | null>(() => {
    const d = canonicalDecks();
    if (!d) {
      return null;
    }
    return applyFilters(d, props.slug, appliedSuccess(), activeFilters());
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

  // Preserve unchanged item identities so CardList does not remount every tile.
  let prevItemsById: ReadonlyMap<string, CardListItem> = new Map();
  const displayedItems = createMemo<CardListItem[]>(() => {
    const r = filteredReport();
    if (!r) {
      prevItemsById = new Map();
      return [];
    }
    const next = reconcileDisplayedItems(r.items as unknown as CardListItem[], appliedThreshold(), prevItemsById);
    prevItemsById = next.byCardId;
    return next.items;
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
    return inclusionPct(cooccurrence(), opt.cardId);
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

  return {
    addComplement,
    addRuleFromItem,
    answerBoth,
    answerNeither,
    answerQuestion,
    appliedRules,
    appliedSuccess,
    applyNow,
    candidates,
    complements,
    copyMsg,
    copyPtcgl,
    cycleOp,
    decks,
    displayedItems,
    highlighted,
    matchCount,
    onSearchKey,
    optionPct,
    poolTotal,
    popoverOpen,
    questions,
    questionsOpen,
    removeRule,
    reset,
    rules,
    schedule,
    search,
    setCount,
    setHighlighted,
    setPopoverOpen,
    setQuestionsOpen,
    setSearch,
    setThreshold,
    shareLink,
    sharePct,
    skipQuestion,
    successFilter,
    threshold,
    toggleMode,
    updateSuccess
  };
}

export function AdvancedPanel(props: AdvancedPanelProps) {
  const model = useAdvancedPanel(props);

  return (
    <div class='advanced-panel'>
      <div class='fb-frame'>
        <div class='fb-controls'>
          <label class='fb-field'>
            <span class='fb-field-label'>Tournament finish</span>
            <select
              class='fb-select'
              value={model.successFilter()}
              onChange={e => model.updateSuccess(e.currentTarget.value)}
            >
              <For each={SUCCESS_OPTIONS}>{opt => <option value={opt.value}>{opt.label}</option>}</For>
            </select>
          </label>

          <label class='fb-field'>
            <span class='fb-field-label'>
              Inclusion threshold <output class='fb-threshold-out'>{model.threshold()}%</output>
            </span>
            <input
              type='range'
              min='0'
              max='100'
              step='5'
              value={model.threshold()}
              onInput={e => {
                model.setThreshold(Number(e.currentTarget.value));
                model.schedule();
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
            value={model.search()}
            onInput={e => {
              model.setSearch(e.currentTarget.value);
              model.setPopoverOpen(true);
              model.setHighlighted(0);
            }}
            onFocus={() => model.setPopoverOpen(true)}
            onBlur={() => window.setTimeout(() => model.setPopoverOpen(false), 120)}
            onKeyDown={model.onSearchKey}
          />
          <Show when={model.popoverOpen() && model.candidates().length > 0}>
            <div class='fb-b-popover'>
              <For each={model.candidates()}>
                {(item, idx) => (
                  <div
                    class={`item ${idx() === model.highlighted() ? 'highlighted' : ''}`}
                    onMouseDown={e => {
                      e.preventDefault();
                      model.addRuleFromItem(item);
                    }}
                    onMouseEnter={() => model.setHighlighted(idx())}
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

        <Show when={model.rules().length > 0}>
          <div class='fb-b-rules-head'>
            Active rules · <b>{model.rules().length}</b>
          </div>
          <For each={model.rules()}>
            {rule => (
              <div class='fb-b-row'>
                <span class='card-name'>{rule.name}</span>
                <button
                  type='button'
                  class={`op-select ${rule.mode}`}
                  onClick={() => model.toggleMode(rule.id)}
                  title='Toggle include/exclude'
                >
                  {rule.mode === 'include' ? '+ Must include' : '− Must exclude'}
                </button>
                <div class={`count-input ${rule.mode === 'exclude' ? 'disabled' : ''}`}>
                  <button
                    type='button'
                    class='op-label'
                    onClick={() => model.cycleOp(rule.id)}
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
                    onInput={e => model.setCount(rule.id, e.currentTarget.value)}
                  />
                </div>
                <button class='remove' onClick={() => model.removeRule(rule.id)} aria-label='Remove rule'>
                  ✕
                </button>
              </div>
            )}
          </For>
        </Show>

        <Show when={model.questions().length > 0}>
          <div class='fb-quiz-section'>
            <button class='fb-narrow' type='button' onClick={() => model.setQuestionsOpen(o => !o)}>
              {model.questionsOpen() ? 'Hide choices' : `Help me choose · ${model.questions().length} either/or →`}
            </button>
            <Show when={model.questionsOpen() ? model.questions()[0] : undefined}>
              {q => (
                <div class='fb-quiz'>
                  <div class='fb-quiz-head'>Which do you run?</div>
                  <div class='fb-quiz-options'>
                    <For each={q().options}>
                      {opt => (
                        <button class='fb-quiz-opt' type='button' onClick={() => model.answerQuestion(q(), opt)}>
                          <span class='name'>{opt.name}</span>
                          <span class='pct'>{model.optionPct(opt)}%</span>
                        </button>
                      )}
                    </For>
                  </div>
                  <div class='fb-quiz-foot'>
                    <button type='button' onClick={() => model.answerBoth(q())}>
                      {q().options.length > 2 ? 'All' : 'Both'}
                    </button>
                    <button type='button' onClick={() => model.answerNeither(q())}>
                      Neither
                    </button>
                    <button type='button' onClick={() => model.skipQuestion(q().id)}>
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
            when={!model.decks.loading && model.decks() !== null}
            fallback={
              <span class='fb-count fb-count-muted'>
                <Show when={model.decks.loading} fallback={<>Decks unavailable for this archetype.</>}>
                  Loading deck data…
                </Show>
              </span>
            }
          >
            <span class='fb-count'>
              <b>{model.matchCount().toLocaleString()}</b> {model.matchCount() === 1 ? 'deck' : 'decks'} match
              <Show when={props.report.deckTotal > 0}>
                {' '}
                · {model.sharePct().toFixed(1)}% of {props.label} lists
              </Show>
            </span>
          </Show>
          <div class='fb-actions'>
            <button class='btn btn-ghost' type='button' onClick={model.reset}>
              Reset
            </button>
            <button class='btn btn-primary' type='button' onClick={model.applyNow}>
              Apply filter →
            </button>
          </div>
        </div>
      </div>

      <Show
        when={model.decks() !== null && !model.decks.loading}
        fallback={
          <Show when={model.decks.loading} fallback={<EmptyState title='No per-deck data for this archetype yet.' />}>
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
                <b>{model.poolTotal()}</b> / {DECK_TARGET} cards
              </span>
              <div
                class={`fb-bar-track ${model.poolTotal() === DECK_TARGET ? 'is-complete' : model.poolTotal() > DECK_TARGET ? 'is-over' : ''}`}
              >
                <div
                  class='fb-bar-fill'
                  style={{ width: `${Math.min(100, (model.poolTotal() / DECK_TARGET) * 100)}%` }}
                />
              </div>
              <Show when={model.poolTotal() > DECK_TARGET}>
                <span class='fb-bar-over'>{model.poolTotal() - DECK_TARGET} over</span>
              </Show>
            </div>
            <div class='fb-bar-actions'>
              <Show when={model.copyMsg()}>
                <span class='fb-bar-msg'>{model.copyMsg()}</span>
              </Show>
              <button
                class='fb-bar-btn'
                type='button'
                onClick={model.copyPtcgl}
                disabled={model.poolTotal() === 0}
                title='Copy this pool as a PTCGL decklist'
              >
                Copy list
              </button>
              <button
                class='fb-bar-btn'
                type='button'
                onClick={model.shareLink}
                title='Copy a link that restores this view'
              >
                Share
              </button>
            </div>
          </div>

          <Show when={model.complements().length > 0}>
            <div class='fb-suggest'>
              <span class='fb-suggest-label'>Niche partners</span>
              <For each={model.complements()}>
                {c => (
                  <button
                    class='fb-suggest-chip'
                    type='button'
                    onClick={() => model.addComplement(c.ref)}
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
            title={model.appliedRules().length || model.appliedSuccess() !== 'all' ? 'Filtered cards' : 'All cards'}
            items={model.displayedItems()}
            viewMode={props.viewMode}
            emptyMessage={
              model.matchCount() === 0
                ? 'No decks match these filters.'
                : `No cards above ${model.threshold()}% in the filtered subset.`
            }
            rightSlot={`${model.displayedItems().length.toLocaleString()} cards · ≥ ${model.threshold()}%`}
            hideEmptyBuckets={model.appliedRules().length > 0}
          />
        </div>
      </Show>
    </div>
  );
}

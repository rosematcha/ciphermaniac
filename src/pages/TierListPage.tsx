/**
 * Tier List Maker.
 *
 * Rank the archetypes of an event, or the distinct arts of one card, and export
 * the result as a JPG. The card-art tab is the reason the art-grouping pipeline
 * exists: Rare Candy has twenty-two printings but fourteen distinct
 * illustrations, and ranking the same picture six times is not a tier list.
 *
 * The structural rule the whole page follows: **the board is the document.**
 * The exported image and the on-screen board are the same node, so every
 * control lives outside it or sits inside it at opacity 0. Export is one call
 * on that node with nothing to strip first.
 * @module pages/TierListPage
 */

import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { CardImage } from '../components/CardImage';
import {
  fetchArchetypes,
  fetchTournamentsList,
  getArchetypeIconMap,
  prettyTournamentName,
  resolveArchetypeIcons
} from '../lib/data';
import { type ArtCard, fetchArtCards } from '../lib/data/artGroups';
import { ONLINE_META_NAME } from '../lib/constants';
import { latestValue } from '../lib/resource';
import { installItemSortable, type ItemDrop } from '../lib/tierList/itemSortable';
import { installRowSortable } from '../lib/tierList/rowSortable';
import { getSynonymDatabase } from '../utils/cardSynonyms';
import { interEmbedCss } from '../utils/fontEmbed';
import { Combo, splitMatch } from './tierList/Combo';
import { type CanonicalOption, Editor, type EditorTarget, type SpriteOption } from './tierList/Editor';
import { TierBoard } from './tierList/TierBoard';
import {
  type CustomArchetype,
  decodeShare,
  defaultTiers,
  distribute,
  encodeShare,
  type Tier,
  type TierItem,
  type TierMode,
  withAddedTier,
  withDeletedTier,
  withDroppedItem,
  withEditedTier,
  withMovedTier,
  withRenamedPlacement,
  withTierOrder
} from './tierList/model';
import '../styles/pages/tier-list.css';

/**
 * Labels default per view because the views need different things: a bare
 * sprite is not identifiable, while a wall of card art reads fine without a
 * caption under every tile. Once the user chooses, their choice wins in every
 * view — an explicit decision outranks our guess everywhere, not only where it
 * was made.
 */
const LABEL_DEFAULT: Record<TierMode, boolean> = { icons: true, previews: false, arts: false };

/**
 * What the editor popover is open on, by id.
 *
 * Ids, not objects: editing a tier replaces its object, and a popover holding
 * the old one goes stale — so the target it renders from is derived fresh from
 * `tiers()` and `custom()` instead. A null archetype id is a new one.
 */
type EditSubject = { kind: 'tier'; id: string } | { kind: 'archetype'; id: number | null };

/** How long a reordered row takes to travel. Long enough to follow, short enough to keep clicking. */
const ROW_MOVE_MS = 140;

const MODE_LABELS: { value: TierMode; label: string }[] = [
  { value: 'icons', label: 'Archetypes' },
  { value: 'arts', label: 'Card arts' }
];

/** Title-case a sprite slug: `arcanine-hisui` → `Arcanine (Hisui)`. */
function spriteLabel(slug: string): string {
  const [head, ...form] = slug.split('-');
  const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
  return cap(head ?? slug) + (form.length ? ` (${form.map(cap).join(' ')})` : '');
}

/**
 * Only slugs we have mirrored to R2 — the same committed map the mirror script
 * reads. Anything outside it loads from the LimitlessTCG CDN, and a
 * cross-origin sprite cannot be inlined into the exported JPG: it would leave a
 * hole in the image the user posts.
 */
const SPRITES: SpriteOption[] = [...new Set([...getArchetypeIconMap().values()].flat())]
  .sort()
  .map(slug => ({ slug, label: spriteLabel(slug) }));

export function TierListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tournaments] = createResource(fetchTournamentsList);
  const [artCards] = createResource(fetchArtCards);
  const [synonyms] = createResource(getSynonymDatabase);

  const [mode, setMode] = createSignal<TierMode>('icons');
  const [labelChoice, setLabelChoice] = createSignal<boolean | null>(null);
  const [tiers, setTiers] = createSignal<Tier[]>(defaultTiers());
  const [placement, setPlacement] = createSignal<Map<string, string[]>>(new Map());
  const [custom, setCustom] = createSignal<CustomArchetype[]>([]);
  const [cardName, setCardName] = createSignal('');
  const [title, setTitle] = createSignal('');
  const [editing, setEditing] = createSignal<EditSubject | null>(null);
  const [resetArmed, setResetArmed] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let board: HTMLDivElement | undefined;
  let nextCustomId = 1;

  const tournament = (): string =>
    typeof searchParams.t === 'string' && searchParams.t ? searchParams.t : ONLINE_META_NAME;
  const [archetypes] = createResource(tournament, fetchArchetypes);

  const labels = (): boolean => labelChoice() ?? LABEL_DEFAULT[mode()];
  const cards = (): ArtCard[] => latestValue(artCards) ?? [];
  const activeCard = (): ArtCard | undefined => cards().find(c => c.name === cardName()) ?? cards()[0];

  onMount(() => {
    document.title = 'Tier List Maker — Tools — Ciphermaniac';
    restoreFromHash();
    onCleanup(installItemSortable({ onDrop: applyDrop }));
    onCleanup(installRowSortable({ onReorder: ids => setTiers(list => withTierOrder(list, ids)) }));
  });

  createEffect(() => {
    document.body.classList.toggle('tl-labels', labels());
  });
  onCleanup(() => {
    document.body.classList.remove('tl-labels');
    document.body.style.removeProperty('--tl-item-h');
  });

  // Re-measure whenever what a tile looks like changes.
  createEffect(() => {
    void mode();
    void labels();
    void split();
    measureTile();
  });

  /** State is the authority; the sortable only proposes. */
  const applyDrop = (drop: ItemDrop): void => {
    setPlacement(map => withDroppedItem(map, drop.itemId, drop.zone, drop.index));
  };

  // -------------------------------------------------------------- content

  const items = createMemo<TierItem[]>(() => {
    if (mode() === 'arts') {
      return (activeCard()?.arts ?? []).map(art => ({
        id: art.ref,
        label: `${art.set} ${art.number}`,
        kind: 'art' as const,
        set: art.set,
        number: art.number
      }));
    }
    const kind = mode() === 'icons' ? ('icon' as const) : ('preview' as const);
    // The online-meta index ships no `icons`; only event indexes do. The shared
    // resolver falls back to the committed override map so sprites appear on
    // every view rather than only on tournaments that predate nothing.
    const iconMap = getArchetypeIconMap();
    const scraped: TierItem[] = (latestValue(archetypes) ?? []).map(entry => ({
      id: entry.name,
      label: entry.label || entry.name,
      kind,
      icons: resolveArchetypeIcons(entry, iconMap),
      thumbs: entry.thumbnails ?? []
    }));
    const invented: TierItem[] = custom().map(c => ({
      id: c.name,
      label: c.name,
      kind,
      icons: c.icons,
      thumbs: c.cards,
      customId: c.id
    }));
    return [...scraped, ...invented];
  });

  const split = createMemo(() => distribute(items(), tiers(), placement()));

  const editorTarget = createMemo<EditorTarget | null>(() => {
    const subject = editing();
    if (!subject) {
      return null;
    }
    if (subject.kind === 'tier') {
      const tier = tiers().find(t => t.id === subject.id);
      return tier ? { kind: 'tier', tier } : null;
    }
    return { kind: 'archetype', draft: custom().find(c => c.id === subject.id) ?? null };
  });

  const canonicals = createMemo<CanonicalOption[]>(() => {
    const database = latestValue(synonyms);
    if (!database?.canonicals) {
      return [];
    }
    return Object.entries(database.canonicals)
      .map(([name, uid]) => {
        const [, set, number] = uid.split('::');
        return set && number ? { name, set, number } : null;
      })
      .filter((c): c is CanonicalOption => c !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // -------------------------------------------------------------- state

  /**
   * Publish the height of a real tile so an empty tier reserves exactly the
   * room one will take, and the board does not jolt as the first tile lands.
   * Measured rather than hardcoded: it changes with the view, the label toggle,
   * and anything done to tile sizes later.
   *
   * Read on the next frame, not synchronously after a render — measuring
   * mid-layout under-reserves by a few pixels, which is the jolt this exists to
   * remove. Re-read once art lands, since a thumbnail with no intrinsic size
   * yet is shorter than the real thing.
   */
  function measureTile(): void {
    const apply = (): void => {
      const tiles = document.querySelectorAll<HTMLElement>('.tl-tray .tl-item, .tl-board .tl-item');
      if (tiles.length === 0) {
        return;
      }
      const tallest = Math.max(...[...tiles].map(t => t.getBoundingClientRect().height));
      document.body.style.setProperty('--tl-item-h', `${Math.ceil(tallest)}px`);
    };
    requestAnimationFrame(() => requestAnimationFrame(apply));
    const art = document.querySelector<HTMLImageElement>('.tl-tray .tl-item img, .tl-board .tl-item img');
    if (art && !art.complete) {
      art.addEventListener('load', () => requestAnimationFrame(apply), { once: true });
    }
  }

  /**
   * Reorder and delete move rows, and a row that teleports is hard to follow.
   * FLIP the board: measure, mutate, measure, then let the rows travel the
   * difference.
   */
  function animateRows(mutate: () => void): void {
    const before = new Map<string, number>();
    for (const row of document.querySelectorAll<HTMLElement>('.tl-board .tl-row[data-row]')) {
      before.set(row.dataset.row!, row.getBoundingClientRect().top);
    }
    mutate();
    queueMicrotask(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('.tl-board .tl-row[data-row]')];
      for (const row of rows) {
        const was = before.get(row.dataset.row!);
        const delta = was === undefined ? 0 : was - row.getBoundingClientRect().top;
        if (!delta) {
          continue;
        }
        row.style.transition = 'none';
        row.style.transform = `translateY(${delta}px)`;
      }
      requestAnimationFrame(() => {
        for (const row of rows) {
          row.style.transition = `transform ${ROW_MOVE_MS}ms var(--ease-base)`;
          row.style.transform = '';
        }
      });
    });
  }

  /** The row collapses first, so the rows below have something to follow. */
  function deleteTier(id: string): void {
    const row = document.querySelector<HTMLElement>(`.tl-board .tl-row[data-row="${id}"]`);
    const commit = (): void => {
      const next = withDeletedTier(tiers(), placement(), id);
      setTiers(next.tiers);
      setPlacement(next.placement);
    };
    setEditing(null);
    if (!row) {
      commit();
      return;
    }
    row.style.overflow = 'hidden';
    row.style.height = `${row.getBoundingClientRect().height}px`;
    requestAnimationFrame(() => {
      row.style.transition = `height ${ROW_MOVE_MS}ms var(--ease-base), opacity ${ROW_MOVE_MS}ms var(--ease-base)`;
      row.style.height = '0px';
      row.style.opacity = '0';
    });
    setTimeout(commit, ROW_MOVE_MS);
  }

  function saveArchetype(draft: CustomArchetype): void {
    const existing = draft.id ? custom().find(c => c.id === draft.id) : null;
    if (existing) {
      setPlacement(map => withRenamedPlacement(map, existing.name, draft.name));
      setCustom(list => list.map(c => (c.id === draft.id ? { ...draft } : c)));
    } else {
      nextCustomId += 1;
      setCustom(list => [...list, { ...draft, id: nextCustomId }]);
    }
    setEditing(null);
  }

  function deleteArchetype(id: number): void {
    const gone = custom().find(c => c.id === id);
    if (gone) {
      setPlacement(map => {
        const next = new Map(map);
        next.delete(gone.name);
        return next;
      });
      setCustom(list => list.filter(c => c.id !== id));
    }
    setEditing(null);
  }

  function resetAll(): void {
    setPlacement(new Map());
    setTiers(defaultTiers());
    setEditing(null);
    setResetArmed(false);
  }

  // -------------------------------------------------------------- sharing

  function restoreFromHash(): void {
    const encoded = window.location.hash.replace(/^#l=/, '');
    if (!encoded || encoded === window.location.hash) {
      return;
    }
    const state = decodeShare(encoded);
    if (!state) {
      return;
    }
    setMode(state.mode);
    setTitle(state.title);
    setTiers(state.tiers);
    setPlacement(state.placement);
    setCustom(state.custom);
    nextCustomId = Math.max(0, ...state.custom.map(c => c.id));
    if (state.mode === 'arts') {
      setCardName(state.subject);
    } else if (state.subject) {
      setSearchParams({ t: state.subject });
    }
  }

  async function share(): Promise<void> {
    const encoded = encodeShare({
      mode: mode(),
      subject: mode() === 'arts' ? (activeCard()?.name ?? '') : tournament(),
      title: title(),
      tiers: tiers(),
      placement: placement(),
      custom: custom()
    });
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#l=${encoded}`;
    window.history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard denied: the URL is in the address bar either way.
    }
  }

  // -------------------------------------------------------------- export

  function exportName(): string {
    const subject = mode() === 'arts' ? (activeCard()?.name ?? 'cards') : prettyTournamentName(tournament());
    const slug = (title() || subject)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    return `${slug || 'tier-list'}-tiers.jpg`;
  }

  async function exportJpg(): Promise<void> {
    if (!board) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Wait for in-flight art before snapshotting, or the rasteriser races a
      // half-decoded thumbnail and bakes a blank tile into the image.
      await Promise.all(
        [...board.querySelectorAll('img')].map(img =>
          img.complete && img.naturalWidth > 0
            ? Promise.resolve()
            : new Promise<void>(resolve => {
                img.addEventListener('load', () => resolve(), { once: true });
                img.addEventListener('error', () => resolve(), { once: true });
              })
        )
      );
      const [{ domToJpeg }, fontCssText] = await Promise.all([import('modern-screenshot'), interEmbedCss()]);
      const dark = document.body.dataset.mode === 'dark';
      const dataUrl = await domToJpeg(board, {
        scale: 2,
        quality: 0.92,
        backgroundColor: dark ? '#25221f' : '#fbf5e6',
        font: { cssText: fontCssText }
      });
      const link = document.createElement('a');
      link.download = exportName();
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  }

  // -------------------------------------------------------------- render

  return (
    <>
      <section class='hero'>
        <h1>Tier List Maker</h1>
        <div class='hero-meta'>
          <span>Rank an event's archetypes, or one card's distinct arts, and save it as an image</span>
        </div>
      </section>

      <section class='tl-page'>
        <div class='tl-conf'>
          <Show
            when={mode() === 'arts'}
            fallback={
              <select
                class='sel'
                value={tournament()}
                onChange={e => setSearchParams({ t: e.currentTarget.value })}
                aria-label='Tournament'
              >
                {/* The fetched list already leads with the online meta, so it is only
                    a fallback for the frame before the list arrives. */}
                <For each={latestValue(tournaments) ?? [ONLINE_META_NAME]}>
                  {name => <option value={name}>{prettyTournamentName(name)}</option>}
                </For>
              </select>
            }
          >
            <Show when={activeCard()}>
              {card => (
                <span class='tl-current'>
                  <CardImage set={card().arts[0]!.set} number={card().arts[0]!.number} size='xs' lazy skipR2 />
                  {card().name} <span>{card().arts.length} arts</span>
                </span>
              )}
            </Show>
            <Combo
              placeholder='Search cards by name...'
              options={cards()}
              label={c => c.name}
              weight={c => c.arts.length}
              width='260px'
              onPick={c => setCardName(c.name)}
            >
              {(card, query) => {
                const [before, hit, after] = splitMatch(card.name, query);
                return (
                  <>
                    <CardImage set={card.arts[0]!.set} number={card.arts[0]!.number} size='xs' lazy skipR2 />
                    <b>
                      {before}
                      <mark>{hit}</mark>
                      {after}
                    </b>
                    <span>{card.arts.length} arts</span>
                  </>
                );
              }}
            </Combo>
          </Show>

          <div class='segmented' role='tablist' aria-label='Subject'>
            <For each={MODE_LABELS}>
              {option => (
                <button
                  type='button'
                  role='tab'
                  class={mode() === option.value || (option.value === 'icons' && mode() === 'previews') ? 'active' : ''}
                  aria-selected={mode() === option.value || (option.value === 'icons' && mode() === 'previews')}
                  onClick={() => setMode(option.value)}
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>

          <Show when={mode() !== 'arts'}>
            <div class='segmented' role='tablist' aria-label='Archetype artwork'>
              <button
                type='button'
                role='tab'
                class={mode() === 'icons' ? 'active' : ''}
                aria-selected={mode() === 'icons'}
                onClick={() => setMode('icons')}
              >
                Icons
              </button>
              <button
                type='button'
                role='tab'
                class={mode() === 'previews' ? 'active' : ''}
                aria-selected={mode() === 'previews'}
                onClick={() => setMode('previews')}
              >
                Previews
              </button>
            </div>
          </Show>

          <button type='button' class='tl-toggle' aria-pressed={labels()} onClick={() => setLabelChoice(!labels())}>
            Labels
          </button>

          <span class='grow' />

          <div class='tl-actions'>
            <button
              type='button'
              class='tl-btn'
              classList={{ warn: resetArmed() }}
              onClick={() => (resetArmed() ? resetAll() : setResetArmed(true))}
              onBlur={() => setResetArmed(false)}
            >
              {resetArmed() ? 'Reset everything?' : 'Reset'}
            </button>
            <button type='button' class='tl-btn' onClick={() => void share()}>
              Share
            </button>
            <button type='button' class='tl-btn primary' disabled={busy()} onClick={() => void exportJpg()}>
              {busy() ? 'Rendering…' : 'Export JPG'}
            </button>
          </div>
        </div>

        <Show when={error()}>{message => <p class='tl-error'>{message()}</p>}</Show>

        <Show
          when={mode() !== 'arts' || cards().length > 0}
          fallback={
            <Show when={!artCards.loading} fallback={<Skeleton height='320px' />}>
              <EmptyState
                title='Card arts are not ready yet'
                description='The art-grouping job has not published its results. Archetype tier lists still work.'
              />
            </Show>
          }
        >
          <TierBoard
            tiers={tiers()}
            buckets={split().buckets}
            tray={split().tray}
            title={title()}
            boardRef={el => {
              board = el;
            }}
            onTitle={setTitle}
            onMove={(id, step) => animateRows(() => setTiers(list => withMovedTier(list, id, step)))}
            onDelete={deleteTier}
            onEditTier={id => setEditing({ kind: 'tier', id })}
            onEditItem={id => setEditing({ kind: 'archetype', id })}
            onAddTier={() => setTiers(withAddedTier)}
            onAddArchetype={mode() === 'arts' ? undefined : () => setEditing({ kind: 'archetype', id: null })}
          />
        </Show>
      </section>

      {/* Unkeyed: the popover stays mounted across edits to its subject, so a
          rename does not tear down the input the user is typing into. */}
      <Show when={editorTarget()}>
        {target => (
          <Editor
            target={target()}
            sprites={SPRITES}
            canonicals={canonicals()}
            onTierChange={patch => {
              const subject = editing();
              if (subject?.kind === 'tier') {
                setTiers(list => withEditedTier(list, subject.id, patch));
              }
            }}
            onArchetypeSave={saveArchetype}
            onArchetypeDelete={deleteArchetype}
            onClose={() => setEditing(null)}
          />
        )}
      </Show>
    </>
  );
}

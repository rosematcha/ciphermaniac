/**
 * The editor popover, shared by tiers and custom archetypes.
 *
 * A floating module rather than a modal, deliberately: the board stays visible
 * and updates live underneath, so a colour is judged against the tiles it will
 * sit with instead of against a dialog. It anchors under whatever opened it and
 * clamps itself inside the viewport.
 *
 * The target names what is being edited; it never carries the node it hangs
 * from. Editing a tier replaces that tier's object, so the board rebuilds its
 * row, so a held-on-to anchor is detached by the time the next placement runs —
 * and a detached node measures 0×0, which sent the panel to the top-left
 * corner on the first keystroke. The anchor is re-queried instead.
 * @module pages/tierList/Editor
 */

import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { CardImage } from '../../components/CardImage';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { Combo, splitMatch } from './Combo';
import { Icon } from './icons';
import { SWATCHES, type SwatchTone } from './palette';
import type { CustomArchetype, Tier } from './model';

/** A Pokémon sprite the mirror actually holds. */
export interface SpriteOption {
  slug: string;
  label: string;
}

/** A card identity, from the synonym database's canonical map. */
export interface CanonicalOption {
  name: string;
  set: string;
  number: string;
}

/** What the popover is editing. Derived state, rebuilt whenever the subject changes. */
export type EditorTarget = { kind: 'tier'; tier: Tier } | { kind: 'archetype'; draft: CustomArchetype | null };

/** Live lookup of the control the popover hangs from. Null means leave it be. */
function anchorFor(target: EditorTarget): HTMLElement | null {
  if (target.kind === 'tier') {
    return document.querySelector(`[data-tier-id="${target.tier.id}"]`);
  }
  return document.querySelector(target.draft ? `[data-edit="${target.draft.id}"]` : '[data-addarch]');
}

interface EditorProps {
  target: EditorTarget;
  sprites: readonly SpriteOption[];
  canonicals: readonly CanonicalOption[];
  onTierChange: (patch: Partial<Omit<Tier, 'id'>>) => void;
  onArchetypeSave: (draft: CustomArchetype) => void;
  onArchetypeDelete: (id: number) => void;
  onClose: () => void;
}

const TONES: { tone: SwatchTone; label: string }[] = [
  { tone: 'vivid', label: 'Vivid' },
  { tone: 'soft', label: 'Soft' },
  { tone: 'deep', label: 'Deep' },
  { tone: 'neutral', label: 'Neutral' }
];

/** At most two of each: what an icon pair and a card stack can show legibly. */
const MAX_PICKS = 2;

export function Editor(props: EditorProps): JSX.Element {
  let panel: HTMLDivElement | undefined;

  const place = (): void => {
    const anchor = anchorFor(props.target);
    if (!panel || !anchor) {
      return;
    }
    const box = panel.getBoundingClientRect();
    const at = anchor.getBoundingClientRect();
    const left = Math.max(10, Math.min(at.left, window.innerWidth - box.width - 10));
    const top = Math.max(10, Math.min(at.bottom + 8, window.innerHeight - box.height - 10));
    panel.style.left = `${left}px`;
    panel.style.top = `${top + window.scrollY}px`;
  };

  onMount(() => {
    place();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        props.onClose();
      }
    };
    const onOutside = (e: PointerEvent): void => {
      const target = e.target as Element | null;
      if (!target?.closest('.tl-pop, [data-tier-id], [data-edit], [data-addarch]')) {
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', place);
    onCleanup(() => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('resize', place);
    });
  });

  createEffect(() => {
    // Re-anchor when the subject changes — not on every edit to it. A rename
    // replaces the tier object on each keystroke and moves nothing.
    void (props.target.kind === 'tier' ? props.target.tier.id : props.target.draft?.id);
    queueMicrotask(place);
  });

  return (
    <div class='tl-pop' role='dialog' aria-label='Editor' ref={panel}>
      {/* Unkeyed on purpose: the tier's object is replaced on every keystroke of
          a rename, and remounting the fields there would take the focused input
          with it. */}
      <Show when={props.target.kind === 'tier'}>
        <TierFields
          tier={() => (props.target.kind === 'tier' ? props.target.tier : null)}
          onChange={props.onTierChange}
          onClose={props.onClose}
        />
      </Show>
      <Show when={props.target.kind === 'archetype' ? props.target : null} keyed>
        {target => (
          <ArchetypeFields
            existing={target.draft}
            sprites={props.sprites}
            canonicals={props.canonicals}
            onSave={props.onArchetypeSave}
            onDelete={props.onArchetypeDelete}
            onClose={props.onClose}
          />
        )}
      </Show>
    </div>
  );
}

function Header(props: { title: string; onClose: () => void }): JSX.Element {
  return (
    <header>
      <b>{props.title}</b>
      <button type='button' class='x' aria-label='Close' onClick={() => props.onClose()}>
        <Icon name='close' />
      </button>
    </header>
  );
}

function TierFields(props: {
  /** Null once the tier is gone, which only happens as the popover closes. */
  tier: () => Tier | null;
  onChange: (patch: Partial<Omit<Tier, 'id'>>) => void;
  onClose: () => void;
}): JSX.Element {
  let field: HTMLInputElement | undefined;
  const selected = (): string | undefined => props.tier()?.swatch;

  // The name is pushed into the field only when the two actually disagree,
  // which happens when the popover moves to a different tier — never on the
  // user's own keystrokes. Binding `value` outright instead re-assigns the
  // string the user is halfway through typing, and some browsers answer that
  // by parking the caret at the end of the field.
  createEffect(() => {
    const name = props.tier()?.name ?? '';
    if (field && field.value !== name) {
      field.value = name;
    }
  });

  return (
    <>
      <Header title='Tier' onClose={props.onClose} />
      <div class='tl-field'>
        <span class='tl-legend'>Name</span>
        <input
          ref={field}
          type='text'
          class='search'
          maxLength={24}
          spellcheck={false}
          onInput={e => props.onChange({ name: e.currentTarget.value })}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              props.onClose();
            }
          }}
        />
      </div>
      <div class='tl-field'>
        <span class='tl-legend'>Colour</span>
        <div class='tl-swatches'>
          <For each={TONES}>
            {row => (
              <div class='sw-row'>
                <For each={SWATCHES.filter(s => s.tone === row.tone)}>
                  {sw => (
                    <button
                      type='button'
                      class='sw'
                      classList={{ on: sw.id === selected() }}
                      style={{ background: sw.hex }}
                      aria-label={`${row.label} ${sw.id.split('-')[1]}`}
                      aria-pressed={sw.id === selected()}
                      onClick={() => props.onChange({ swatch: sw.id })}
                    />
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </>
  );
}

/**
 * A custom archetype carries BOTH representations, always. Capturing only the
 * active view's meant an archetype invented under icons had nothing to show
 * under previews, and switching views left a hole where a tile should be.
 */
function ArchetypeFields(props: {
  existing: CustomArchetype | null;
  sprites: readonly SpriteOption[];
  canonicals: readonly CanonicalOption[];
  onSave: (draft: CustomArchetype) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}): JSX.Element {
  // Read once, untracked, on purpose: the parent renders this behind a `keyed`
  // Show, so opening a different archetype recreates the component rather than
  // reusing it. A tracked read here would fight that and re-seed the fields
  // mid-edit.
  /* eslint-disable solid/reactivity */
  const [name, setName] = createSignal(props.existing?.name ?? '');
  const [icons, setIcons] = createSignal<string[]>([...(props.existing?.icons ?? [])]);
  const [cards, setCards] = createSignal<string[]>([...(props.existing?.cards ?? [])]);
  /* eslint-enable solid/reactivity */

  const save = (): void => {
    const trimmed = name().trim();
    if (!trimmed) {
      return;
    }
    props.onSave({ id: props.existing?.id ?? 0, name: trimmed, icons: icons(), cards: cards() });
  };

  return (
    <>
      <Header title={props.existing ? 'Edit archetype' : 'New archetype'} onClose={props.onClose} />
      <div class='tl-field'>
        <span class='tl-legend'>Name</span>
        <input
          type='text'
          class='search'
          placeholder='Archetype name'
          spellcheck={false}
          value={name()}
          onInput={e => setName(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              save();
            }
          }}
        />
      </div>

      <div class='tl-field'>
        <span class='tl-legend'>Icons</span>
        <div class='tl-picks'>
          <For each={icons()}>
            {(slug, i) => (
              <span class='tl-pick'>
                <ArchetypeIcons slugs={[slug]} size={22} />
                {props.sprites.find(s => s.slug === slug)?.label ?? slug}
                <button
                  type='button'
                  aria-label={`Remove ${slug}`}
                  onClick={() => setIcons(list => list.filter((_, k) => k !== i()))}
                >
                  ×
                </button>
              </span>
            )}
          </For>
          <Show when={icons().length < MAX_PICKS}>
            <Combo
              placeholder='Search Pokémon by name...'
              options={props.sprites}
              label={s => s.label}
              width='200px'
              onPick={s => setIcons(list => (list.includes(s.slug) ? list : [...list, s.slug]))}
            >
              {(sprite, query) => {
                const [before, hit, after] = splitMatch(sprite.label, query);
                return (
                  <>
                    <ArchetypeIcons slugs={[sprite.slug]} size={26} />
                    <b>
                      {before}
                      <mark>{hit}</mark>
                      {after}
                    </b>
                    <span />
                  </>
                );
              }}
            </Combo>
          </Show>
        </div>
      </div>

      <div class='tl-field'>
        <span class='tl-legend'>Cards</span>
        <div class='tl-picks'>
          <For each={cards()}>
            {(ref, i) => {
              const [set, number] = ref.split('/');
              return (
                <span class='tl-pick'>
                  <CardImage set={set ?? ''} number={number ?? ''} size='xs' lazy skipR2 />
                  {props.canonicals.find(c => `${c.set}/${c.number}` === ref)?.name ?? ref}
                  <button
                    type='button'
                    aria-label={`Remove ${ref}`}
                    onClick={() => setCards(list => list.filter((_, k) => k !== i()))}
                  >
                    ×
                  </button>
                </span>
              );
            }}
          </For>
          <Show when={cards().length < MAX_PICKS}>
            <Combo
              placeholder='Search cards by name...'
              options={props.canonicals}
              label={c => c.name}
              width='200px'
              onPick={c => {
                const ref = `${c.set}/${c.number}`;
                setCards(list => (list.includes(ref) ? list : [...list, ref]));
              }}
            >
              {(card, query) => {
                const [before, hit, after] = splitMatch(card.name, query);
                return (
                  <>
                    <CardImage set={card.set} number={card.number} size='xs' lazy skipR2 />
                    <b>
                      {before}
                      <mark>{hit}</mark>
                      {after}
                    </b>
                    <span>
                      {card.set} {card.number}
                    </span>
                  </>
                );
              }}
            </Combo>
          </Show>
        </div>
      </div>

      <footer>
        <Show when={props.existing}>
          {existing => (
            <button type='button' class='tl-btn danger' onClick={() => props.onDelete(existing().id)}>
              Delete
            </button>
          )}
        </Show>
        <span class='grow' />
        <button type='button' class='tl-btn' onClick={() => props.onClose()}>
          Cancel
        </button>
        <button type='button' class='tl-btn primary' disabled={!name().trim()} onClick={save}>
          {props.existing ? 'Save' : 'Add'}
        </button>
      </footer>
    </>
  );
}

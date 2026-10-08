/**
 * A profile's badges (shared/accounts/achievements.ts) in a row under its
 * name: the ones it holds outright, a rule, then the counted ones, each in
 * its tier's color. The first SHOWN sit in the row; the rest wait behind a
 * "+N" that opens them as a list. Each names itself on hover, focus, or tap.
 */

import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { Badge } from '../../../shared/accounts/achievements';
import { InfoTip } from '../../components/InfoTip';
import { BadgeArt } from './badgeArt';
import '../../styles/pages/tournament-badges.css';

/** How many badges the row shows before the rest go behind "+N". */
const SHOWN = 6;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const LABELS: Record<Badge['key'], (n: number) => string> = {
  creator: () => 'Developer',
  beta: () => 'Beta tester',
  early: () => 'Early adopter',
  played: n => `Played ${plural(n, 'event')}`,
  won: n => `Won ${plural(n, 'event')}`,
  organized: n => `Organized ${plural(n, 'event')}`,
  staffed: n => `Staffed ${plural(n, 'event')}`,
  traveler: n => `Played in ${plural(n, 'city', 'cities')}`,
  bug: n => plural(n, 'accepted issue'),
  developer: n => plural(n, 'accepted pull request')
};

/** What a badge is called where it is named. */
export const badgeLabel = (badge: Badge) => LABELS[badge.key]('count' in badge ? badge.count : 1);

/** The color a badge takes: its tier's, or the accent for one held outright. */
const tierOf = (badge: Badge) => ('tier' in badge ? `tier-${badge.tier}` : 'special');

function BadgeIcon(props: { badge: Badge }) {
  return (
    <InfoTip
      class={`tm-badge tm-badge-${tierOf(props.badge)}`}
      label={badgeLabel(props.badge)}
      marker={<BadgeArt badge={props.badge.key} />}
    >
      {badgeLabel(props.badge)}
    </InfoTip>
  );
}

function More(props: { badges: Badge[] }) {
  const [open, setOpen] = createSignal(false);
  let root: HTMLSpanElement | undefined;
  onMount(() => {
    const away = (event: Event) => {
      if (root && !root.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open()) {
        setOpen(false);
        root?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    onCleanup(() => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    });
  });
  return (
    <span class='tm-badge-more' ref={root}>
      <button
        type='button'
        aria-expanded={open()}
        aria-label={`${props.badges.length} more badges`}
        onClick={() => setOpen(!open())}
      >
        +{props.badges.length}
      </button>
      <Show when={open()}>
        <ul class='tm-badge-list'>
          <For each={props.badges}>
            {badge => (
              <li class={`tm-badge-${tierOf(badge)}`}>
                <BadgeArt badge={badge.key} />
                {badgeLabel(badge)}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </span>
  );
}

export function Badges(props: { badges: Badge[] }) {
  const shown = () => props.badges.slice(0, SHOWN);
  const held = () => shown().filter(badge => !('tier' in badge));
  const counted = () => shown().filter(badge => 'tier' in badge);
  const rest = () => props.badges.slice(SHOWN);
  return (
    <Show when={props.badges.length > 0}>
      <div class='tm-badges'>
        <For each={held()}>{badge => <BadgeIcon badge={badge} />}</For>
        <Show when={held().length > 0 && counted().length > 0}>
          <span class='tm-badge-rule' aria-hidden='true' />
        </Show>
        <For each={counted()}>{badge => <BadgeIcon badge={badge} />}</For>
        <Show when={rest().length > 0}>
          <More badges={rest()} />
        </Show>
      </div>
    </Show>
  );
}

import { A } from '@solidjs/router';
import type { ArchetypeIndexEntry } from '../types';
import { Trend, type TrendDirection } from './Trend';
import { CardStack } from './CardImage';
import { formatPercent } from '../lib/format';
import { prefetchArchetypePage } from '../lib/prefetch';
import '../styles/pages/archetype.css';

interface ArchetypeCardProps {
  entry: ArchetypeIndexEntry;
  /** Online-meta entry for the same archetype, used as an image fallback when
   * the event entry ships without thumbnails/signature cards. */
  online?: ArchetypeIndexEntry;
  rank?: number;
  trend?: { direction: TrendDirection; delta?: string };
  /** Eager-load the thumbnail images (above-the-fold tiles). */
  eagerImage?: boolean;
}

function entryThumbnails(entry: ArchetypeIndexEntry | undefined): string[] {
  return entry?.thumbnails ?? [];
}

/**
 * Archetype gallery card. Click → /archetypes/[slug].
 * Uses real card images via CardStack from the index's thumbnails list, falling
 * back to the online entry's thumbnails for event views that ship without them.
 */
/**
 * Placeholder with the same box model as a real card.
 *
 * A flat `<Skeleton height='220px'>` was ~65px short of the card it stood in
 * for, and wrong by a different amount at every breakpoint — the thumbnail is
 * a 4:3 box, so a card's height tracks its column width. Reusing the card's
 * own classes keeps the two in step for free.
 */
export function ArchetypeCardSkeleton() {
  return (
    <div class='arche arche-skeleton' aria-hidden='true'>
      <div class='arche-thumb' />
      {/* The real classes wrap each bar so the placeholder inherits the type
          metrics that set each row's height — `.arche-share` is 22px type and
          drives the stats row on its own. */}
      <div class='arche-name'>
        <span class='skeleton skeleton-block' style={{ width: '70%', height: '0.8em' }} />
      </div>
      <div class='arche-stats'>
        <span class='arche-share'>
          <span class='skeleton skeleton-block' style={{ width: '52px', height: '0.7em' }} />
        </span>
        <span class='arche-decks'>
          <span class='skeleton skeleton-block' style={{ width: '64px', height: '0.9em' }} />
        </span>
      </div>
    </div>
  );
}

export function ArchetypeCard(props: ArchetypeCardProps) {
  const slug = () => props.entry.name;

  const thumbnails = (): string[] => {
    const own = entryThumbnails(props.entry);
    return own.length > 0 ? own : entryThumbnails(props.online);
  };

  const share = () => formatPercent(props.entry.percent);

  const decks = () => {
    const n = props.entry.deckCount;
    if (n === null || n === undefined) {
      return null;
    }
    return n.toLocaleString();
  };

  return (
    <A
      class='arche'
      href={`/archetypes/${encodeURIComponent(slug())}`}
      onMouseEnter={prefetchArchetypePage}
      onFocus={prefetchArchetypePage}
    >
      <div class='arche-thumb' aria-hidden='true'>
        <CardStack thumbnails={thumbnails()} size='xs' lazy={!props.eagerImage} />
      </div>
      <div class='arche-name'>{props.entry.label || props.entry.name}</div>
      <div class='arche-stats'>
        <span class='arche-share'>{share()}</span>
        {decks() ? <span class='arche-decks'>{decks()} decks</span> : null}
        {props.trend ? <Trend direction={props.trend.direction} delta={props.trend.delta} /> : null}
      </div>
    </A>
  );
}

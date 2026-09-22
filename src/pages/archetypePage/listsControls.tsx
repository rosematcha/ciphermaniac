import { createMemo, createSignal, Show } from 'solid-js';
import { Segmented } from '../../components/Segmented';
import { FINISH_OPTIONS } from '../cardPage/playedInModel';
import type { ListCard } from '../../lib/data/lists';
import type { ListFilters } from './listsModel';

const VENUE_OPTIONS: { value: ListFilters['venue']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'In person' },
  { value: 'online', label: 'Online' }
];

/** The tab's filter state, owned by the archetype page so the toolbar can hold its controls. */
export function createListsState() {
  const [finish, setFinish] = createSignal('all');
  const [venue, setVenue] = createSignal<ListFilters['venue']>('all');
  // Picked techs keep their printing, so a pick stays on the strip (and can be
  // cleared) after a filter change takes it out of the candidate band.
  const [picked, setPicked] = createSignal<ReadonlyMap<string, ListCard>>(new Map());
  const techs = createMemo<ReadonlySet<string>>(() => new Set(picked().keys()));
  const [techsOpen, setTechsOpen] = createSignal(false);
  const toggleTech = (card: ListCard) =>
    setPicked(prev => {
      const next = new Map(prev);
      if (next.has(card.name)) {
        next.delete(card.name);
      } else {
        next.set(card.name, card);
      }
      return next;
    });
  const filters = (): ListFilters => ({ finish: finish(), venue: venue(), techs: techs() });
  return { finish, setFinish, venue, setVenue, techs, picked, toggleTech, techsOpen, setTechsOpen, filters };
}
export type ListsState = ReturnType<typeof createListsState>;

/** Finish tier, venue (when both are present) and the Techs toggle, for the page toolbar. */
export function ListsControls(props: { state: ListsState; bothVenues: boolean }) {
  const count = () => props.state.techs().size;
  return (
    <>
      <Segmented
        options={FINISH_OPTIONS}
        selected={props.state.finish()}
        onSelect={props.state.setFinish}
        ariaLabel='Finish'
      />
      <Show when={props.bothVenues}>
        <Segmented
          options={VENUE_OPTIONS}
          selected={props.state.venue()}
          onSelect={props.state.setVenue}
          ariaLabel='Venue'
        />
      </Show>
      <button
        type='button'
        class='btn btn-secondary lists-techs-btn'
        classList={{ 'is-on': props.state.techsOpen() || count() > 0 }}
        aria-expanded={props.state.techsOpen()}
        aria-controls='lists-techs'
        onClick={() => props.state.setTechsOpen(v => !v)}
      >
        {count() > 0 ? `Techs · ${count()}` : 'Techs'}
      </button>
    </>
  );
}

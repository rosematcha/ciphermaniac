/**
 * Starting a store's event from pokemon.com: the store's upcoming listings as
 * radio rows at the top of the setup, and Not listed here for one Pokedata
 * has not picked up yet. Picking a listing hands the setup what it fills in
 * (see listingFill); Not listed here hands it null, leaving the rows below to
 * fill by hand. Nothing shows while the store has nothing listed.
 */

import { createResource, For, Show } from 'solid-js';
import type { Listing } from '../../../shared/accounts/types';
import { clock, fetchListings, LISTING_KINDS, shortDay } from '../../lib/tournament/stores';
import { latestValue } from '../../lib/resource';
import '../../styles/pages/tournament-listings.css';

export function ListingPicker(props: {
  storeId: string;
  /** The sanction ID of the listing picked; '' for Not listed here. */
  picked: string;
  onPick: (listing: Listing | null) => void;
}) {
  // A failed read shows nothing: the setup below still takes the event by hand.
  const [listings] = createResource(
    () => props.storeId,
    id =>
      fetchListings(id).then(
        result => result.listings,
        () => [] as Listing[]
      )
  );
  const shown = () => latestValue(listings) ?? [];
  return (
    <Show when={shown().length > 0}>
      <fieldset class='tm-box tm-listings'>
        <legend class='tm-listings-head'>On pokemon.com</legend>
        <For each={shown()}>
          {listing => (
            <label class='tm-listing' classList={{ 'is-on': props.picked === listing.sanctionId }}>
              <input
                type='radio'
                name='setup-listing'
                value={listing.sanctionId}
                checked={props.picked === listing.sanctionId}
                onChange={() => props.onPick(listing)}
              />
              <span class='tm-listing-day tm-num'>{shortDay(listing.date)}</span>
              <span class='tm-listing-name'>
                <strong>{listing.name}</strong>
                <Show when={listing.time}>
                  <span class='muted tm-num'> {clock(listing.time)}</span>
                </Show>
              </span>
              <span class={`badge tm-listing-kind ${listing.kind}`}>{LISTING_KINDS[listing.kind]}</span>
            </label>
          )}
        </For>
        <label class='tm-listing' classList={{ 'is-on': props.picked === '' }}>
          <input
            type='radio'
            name='setup-listing'
            value=''
            checked={props.picked === ''}
            onChange={() => props.onPick(null)}
          />
          <span class='tm-listing-day' />
          <span class='tm-listing-name'>Not listed here</span>
        </label>
      </fieldset>
    </Show>
  );
}

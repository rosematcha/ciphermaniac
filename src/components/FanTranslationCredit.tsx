import { type Accessor, createContext, createMemo, type JSX, Show, useContext } from 'solid-js';
import { hasJapanOnlyCard } from '../../shared/data/japanOnlyCards';

/**
 * Credit for the fan translations and images of cards that exist only in
 * Japanese so far (see shared/data/japanOnlyCards). The wording is approved
 * copy: change it only with sign-off.
 */

const PROXIES_URL = 'https://www.pokemonproxies.com';

/** Whether the page already carries the full credit, so the deck lists on it skip theirs. */
const PageCredited = createContext<Accessor<boolean>>(() => false);

function ProxiesLink() {
  return (
    <a href={PROXIES_URL} target='_blank' rel='noopener noreferrer'>
      pokemonproxies.com
    </a>
  );
}

/** The credit line. `short` is the approved form for tight spaces. */
export function FanTranslationCredit(props: { short?: boolean }) {
  return (
    <p class='fan-credit'>
      <Show
        when={props.short}
        fallback={
          <>
            Unreleased Japanese cards use fan translations and images from <ProxiesLink />, translated by Toine Lay and
            PokeBeach.
          </>
        }
      >
        Translations of unreleased Japanese cards: <ProxiesLink /> (Toine Lay, PokeBeach).
      </Show>
    </p>
  );
}

/**
 * A page that shows a fan-translated card: its content, then the full credit
 * at the bottom when `when` holds.
 */
export function FanTranslationCredited(props: { when: boolean; children: JSX.Element }) {
  const credited = createMemo(() => props.when);
  return (
    <PageCredited.Provider value={credited}>
      {props.children}
      <Show when={credited()}>
        <FanTranslationCredit />
      </Show>
    </PageCredited.Provider>
  );
}

/** The short credit under a deck list that holds a fan-translated card, unless its page has the full one. */
export function DeckFanTranslationCredit(props: { cards: Array<{ set?: string | null }> }) {
  const pageCredited = useContext(PageCredited);
  return (
    <Show when={!pageCredited() && hasJapanOnlyCard(props.cards)}>
      <FanTranslationCredit short />
    </Show>
  );
}

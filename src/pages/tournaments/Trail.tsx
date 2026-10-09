import { A } from '@solidjs/router';
import { Show } from 'solid-js';
import { latestValue } from '../../lib/resource';
import type { Tab } from './Dashboard';
import { session } from './session';

/**
 * The way back above a tournament page's title: "Your events / <the page>",
 * the first part opening the dashboard on the tab the page belongs to (or
 * the dashboard's own choice when it belongs to none). Signed out there are
 * no events of one's own to go back to, so it draws nothing.
 */
export function Trail(props: { here: string; tab?: Tab | undefined }) {
  const href = () => (props.tab ? `/host?tab=${props.tab}` : '/host');
  return (
    <Show when={latestValue(session)?.user}>
      <nav class='tm-trail' aria-label='Breadcrumb'>
        <A href={href()}>Your events</A>
        <span class='tm-trail-sep' aria-hidden='true'>
          /
        </span>
        <span class='tm-trail-here' aria-current='page'>
          {props.here}
        </span>
      </nav>
    </Show>
  );
}

import { children, type JSX, Show } from 'solid-js';
import type { Tab } from './Dashboard';
import { Trail } from './Trail';

/**
 * The head of every tournament page: the title, one sentence built from the
 * event's data saying where it stands, a muted meta line, and at most one
 * primary action at the right. A step that cannot be taken yet stays in
 * place, disabled, with the reason under it. A titled head carries the way
 * back to the dashboard above it (Trail).
 */
export function TournamentHero(props: {
  /** Left out where the page's heading is already drawn above it, as the dashboard's tabs are. */
  title?: string;
  status?: JSX.Element;
  meta?: JSX.Element;
  action?: JSX.Element;
  /** Why the action can't be taken yet, or what it is waiting on. */
  reason?: string | undefined;
  /** The dashboard tab the page belongs to, which the way back opens. */
  tab?: Tab | undefined;
  /** False where there is nowhere to go back to yet, as at a new sign-up's age check. */
  trail?: false;
}) {
  // Resolved once each: a prop's JSX is built again on every read, and a `Show` passed in that
  // renders nothing is still a truthy prop, which drew an empty line and pushed the action down.
  const status = children(() => props.status);
  const meta = children(() => props.meta);
  const action = children(() => props.action);
  return (
    <>
      <Show when={props.trail !== false && props.title}>{title => <Trail here={title()} tab={props.tab} />}</Show>
      <section class='tm-hero'>
        <div class='tm-hero-text'>
          <Show when={props.title}>
            <h1>{props.title}</h1>
          </Show>
          <Show when={status()}>
            <p class='tm-status'>{status()}</p>
          </Show>
          <Show when={meta()}>
            <p class='hero-meta'>{meta()}</p>
          </Show>
        </div>
        <Show when={action() || props.reason}>
          <div class='tm-next'>
            {action()}
            <Show when={props.reason}>
              <span class='tm-next-reason'>{props.reason}</span>
            </Show>
          </div>
        </Show>
      </section>
    </>
  );
}

import { children, type JSX, Show } from 'solid-js';

/**
 * The head of every tournament page: the title, one sentence built from the
 * event's data saying where it stands, a muted meta line, and at most one
 * primary action at the right. A step that cannot be taken yet stays in
 * place, disabled, with the reason under it.
 */
export function TournamentHero(props: {
  title: string;
  status?: JSX.Element;
  meta?: JSX.Element;
  action?: JSX.Element;
  /** Why the action can't be taken yet, or what it is waiting on. */
  reason?: string | undefined;
}) {
  // Resolved once each: a prop's JSX is built again on every read, and a `Show` passed in that
  // renders nothing is still a truthy prop, which drew an empty line and pushed the action down.
  const status = children(() => props.status);
  const meta = children(() => props.meta);
  const action = children(() => props.action);
  return (
    <section class='tm-hero'>
      <div class='tm-hero-text'>
        <h1>{props.title}</h1>
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
  );
}

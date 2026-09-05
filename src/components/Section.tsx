import { type JSX, type ParentComponent, Show } from 'solid-js';

interface SectionProps {
  title?: string;
  right?: JSX.Element | string;
}

/**
 * Section wrapper with a heading row (h2 + optional right-side meta). Either
 * half is optional: an index page with a row count but no title still gets its
 * count, right-aligned over the table.
 */
export const Section: ParentComponent<SectionProps> = props => {
  return (
    <section>
      <Show when={props.title || props.right}>
        <div class='section-head'>
          <Show when={props.title}>
            <h2>{props.title}</h2>
          </Show>
          <Show when={props.right}>
            <span class='right'>{props.right}</span>
          </Show>
        </div>
      </Show>
      {props.children}
    </section>
  );
};

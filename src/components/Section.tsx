import type { JSX, ParentComponent } from 'solid-js';

interface SectionProps {
  title?: string;
  right?: JSX.Element | string;
}

/**
 * Section wrapper with a heading row (h2 + optional right-side meta).
 */
export const Section: ParentComponent<SectionProps> = props => {
  return (
    <section>
      {props.title ? (
        <div class='section-head'>
          <h2>{props.title}</h2>
          {props.right ? <span class='right'>{props.right}</span> : null}
        </div>
      ) : null}
      {props.children}
    </section>
  );
};

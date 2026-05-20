import { A } from '@solidjs/router';
import { For } from 'solid-js';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Breadcrumb row above detail pages. The last item is the current page (no link).
 */
export function Breadcrumb(props: { crumbs: Crumb[] }) {
  return (
    <div class='breadcrumb'>
      <For each={props.crumbs}>
        {(crumb, i) => (
          <>
            {i() > 0 ? <span class='sep'>›</span> : null}
            {crumb.href ? <A href={crumb.href}>{crumb.label}</A> : <span class='current'>{crumb.label}</span>}
          </>
        )}
      </For>
    </div>
  );
}

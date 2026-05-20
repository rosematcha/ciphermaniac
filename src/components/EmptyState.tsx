import type { JSX, ParentComponent } from 'solid-js';

interface EmptyStateProps {
  title: string;
  description?: string;
  actions?: JSX.Element;
  /** Optional inline SVG mark; defaults to a generic "no results" mark */
  mark?: JSX.Element;
}

/**
 * Locked Empty State (B from explorer): mark + heading + description + actions.
 */
export const EmptyState: ParentComponent<EmptyStateProps> = props => {
  return (
    <div class='empty-state'>
      <div class='empty-state-mark' aria-hidden='true'>
        {props.mark ?? <DefaultMark />}
      </div>
      <h4>{props.title}</h4>
      {props.description ? <p>{props.description}</p> : null}
      {props.actions ? <div class='empty-state-actions'>{props.actions}</div> : null}
    </div>
  );
};

function DefaultMark() {
  return (
    <svg
      viewBox='0 0 24 24'
      width='22'
      height='22'
      fill='none'
      stroke='currentColor'
      stroke-width='1.5'
      stroke-linecap='round'
      stroke-linejoin='round'
    >
      <rect x='3' y='6' width='18' height='14' rx='2' />
      <path d='M3 10 h18' />
      <path d='M8 14 h8' />
    </svg>
  );
}

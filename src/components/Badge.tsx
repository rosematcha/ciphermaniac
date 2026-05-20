import type { ParentComponent } from 'solid-js';

type BadgeVariant = 'neutral' | 'regulation';

interface BadgeProps {
  variant?: BadgeVariant;
}

export const Badge: ParentComponent<BadgeProps> = props => {
  return (
    <span class='badge' classList={{ regulation: props.variant === 'regulation' }}>
      {props.children}
    </span>
  );
};

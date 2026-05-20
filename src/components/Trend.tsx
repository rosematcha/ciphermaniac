import type { Component } from 'solid-js';

export type TrendDirection = 'up' | 'down' | 'flat';

interface TrendProps {
  direction: TrendDirection;
  delta?: string | number;
}

const arrow: Record<TrendDirection, string> = {
  up: '↑',
  down: '↓',
  flat: '—'
};

export const Trend: Component<TrendProps> = props => {
  return (
    <span
      class='trend'
      classList={{ up: props.direction === 'up', down: props.direction === 'down', flat: props.direction === 'flat' }}
    >
      <span class='arrow'>{arrow[props.direction]}</span>
      {props.delta !== undefined ? <> {props.delta}</> : null}
    </span>
  );
};

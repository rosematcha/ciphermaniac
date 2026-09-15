import type { DistanceUnit } from '../../lib/events/geo';
import { clampRadius, RADIUS_CHOICES, RADIUS_SLIDER_MAX } from '../../lib/events/viewState';

export interface RadiusControlProps {
  radius: number;
  unit: DistanceUnit;
  onInput: (radius: number) => void;
  /** The slider was let go: the map refits then, not on every step. */
  onCommit: () => void;
}

/** The search radius, on a slider of friendly distances. */
export function RadiusControl(props: RadiusControlProps) {
  return (
    <label class='el-radius'>
      <input
        type='range'
        min={0}
        max={RADIUS_SLIDER_MAX}
        step={1}
        value={RADIUS_CHOICES.findIndex(choice => choice === clampRadius(props.radius))}
        aria-label='Within'
        aria-valuetext={`${props.radius} ${props.unit}`}
        onInput={e => props.onInput(RADIUS_CHOICES[Number(e.currentTarget.value)] ?? RADIUS_CHOICES[0])}
        onChange={() => props.onCommit()}
      />
      <output>
        {props.radius} {props.unit}
      </output>
    </label>
  );
}

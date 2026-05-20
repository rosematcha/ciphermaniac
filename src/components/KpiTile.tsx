import { type JSX, type ParentComponent, Show } from 'solid-js';

interface KpiTileProps {
  label: string;
  value: string | number;
  leader?: boolean;
  foot?: JSX.Element | string;
}

export const KpiTile: ParentComponent<KpiTileProps> = props => {
  return (
    <div class='kpi'>
      <div class='kpi-label'>{props.label}</div>
      <div class='kpi-value' classList={{ leader: props.leader }}>
        {props.value}
      </div>
      <Show when={props.foot}>
        <div class='kpi-foot'>{props.foot}</div>
      </Show>
    </div>
  );
};

import type { JSX } from 'solid-js';

interface SkeletonProps {
  width?: string;
  height?: string;
  rounded?: string;
  inline?: boolean;
  style?: JSX.CSSProperties;
}

/**
 * Generic loading skeleton block. Inherits surface-2 color so it blends with the page.
 * Subtle pulse via keyframe (defined in components.css).
 */
export function Skeleton(props: SkeletonProps) {
  return (
    <span
      class='skeleton'
      classList={{ 'skeleton-block': !props.inline }}
      style={{
        width: props.width ?? '100%',
        height: props.height ?? '14px',
        'border-radius': props.rounded ?? 'var(--radius-sm)',
        ...props.style
      }}
      aria-hidden='true'
    />
  );
}

/**
 * Skeleton row sized for a KPI tile, used while meta is loading.
 */
export function KpiSkeleton() {
  return (
    <div class='kpi'>
      <Skeleton width='50%' height='11px' />
      <Skeleton width='70%' height='30px' />
      <Skeleton width='40%' height='12px' />
    </div>
  );
}

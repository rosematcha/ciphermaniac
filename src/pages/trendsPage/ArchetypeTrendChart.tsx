import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { getArchetypeIconMap, resolveArchetypeIcons } from '../../lib/data';
import type { ArchetypeSeries, DayBin } from '../../lib/majorsTrends';
import { DAY_MS } from '../../lib/trendWindow';
import { createChartTooltipPlacement } from './chartTooltip';
import type { EventMarker } from './weekly';

const LINE_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', '#9c5fd0', '#d4a043', '#3eb9c5'];

/** Stable line colour for a series by its rank index (cycles the palette). */
export function lineColor(index: number): string {
  return LINE_COLORS[index % LINE_COLORS.length];
}

interface ArchetypeTrendChartProps {
  /** Every ranked series; colours key off the index here so they never shift. */
  series: ArchetypeSeries[];
  days: DayBin[];
  /** Names of the series to draw. */
  visible: string[];
  /** A series to bring forward while the rest fade (the rail's hover). */
  highlight: string | null;
  /** Dated events drawn as dashed markers on the axis. */
  markers: EventMarker[];
  yLabel: string;
}

const PADDING = { top: 16, right: 16, bottom: 32, left: 46 };

/**
 * The archetype line chart. It owns the crosshair, the tooltip, and the touch
 * scrub; which lines show and what the legend says is the rail's business,
 * so the chart takes a list of visible names and draws exactly those.
 */
export function ArchetypeTrendChart(props: ArchetypeTrendChartProps) {
  const iconMap = getArchetypeIconMap;
  const colorByName = createMemo(() => {
    const m = new Map<string, string>();
    props.series.forEach((s, i) => m.set(s.name, lineColor(i)));
    return m;
  });
  const colorOf = (name: string): string => colorByName().get(name) ?? lineColor(0);
  const slugsByName = createMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of props.series) {
      m.set(s.name, resolveArchetypeIcons({ name: s.name, label: s.label }, iconMap()));
    }
    return m;
  });
  const visibleSeries = createMemo<ArchetypeSeries[]>(() => {
    const wanted = new Set(props.visible);
    return props.series.filter(s => wanted.has(s.name));
  });

  // Width is measured from the container so the SVG fills horizontally without
  // ever stretching its coordinates. Text and dots stay at a constant size.
  let containerRef: HTMLDivElement | undefined;
  const [width, setWidth] = createSignal(880);
  onMount(() => {
    if (!containerRef) {
      return;
    }
    const initial = containerRef.getBoundingClientRect().width;
    if (initial > 0) {
      setWidth(initial);
    }
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) {
          setWidth(w);
        }
      }
    });
    ro.observe(containerRef);
    onCleanup(() => ro.disconnect());
  });
  const innerW = () => width() - PADDING.left - PADDING.right;
  const height = () => (width() < 560 ? 220 : 300);
  const innerH = () => height() - PADDING.top - PADDING.bottom;

  const xDomain = createMemo(() => {
    if (props.days.length === 0) {
      const now = Date.now();
      return { start: now - DAY_MS, end: now };
    }
    const start = props.days[0].date.getTime();
    const end = props.days[props.days.length - 1].date.getTime();
    return { start, end: start === end ? start + DAY_MS : end };
  });
  function x(d: Date): number {
    const { start, end } = xDomain();
    const frac = (d.getTime() - start) / (end - start);
    return PADDING.left + Math.max(0, Math.min(1, frac)) * innerW();
  }

  const yDomain = createMemo(() => {
    let max = -Infinity;
    for (const s of visibleSeries()) {
      for (const p of s.points) {
        if (p !== null && Number.isFinite(p) && p > max) {
          max = p;
        }
      }
    }
    if (!Number.isFinite(max) || max <= 0) {
      return { min: 0, max: 10, step: 2 };
    }
    // The top of the axis is the next tick above the data, so the ticks are
    // evenly spaced and the last one never lands a hair under the top.
    const step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : 10;
    return { min: 0, max: Math.ceil(max / step) * step, step };
  });
  const y = (v: number) => {
    const { min, max } = yDomain();
    return PADDING.top + innerH() - ((v - min) / (max - min)) * innerH();
  };
  const yTicks = () => {
    const { max, step } = yDomain();
    const ticks: number[] = [];
    for (let v = 0; v <= max; v += step) {
      ticks.push(v);
    }
    return ticks;
  };

  // Break the path at gaps so a missing day leaves a gap instead of a line.
  function segmentsFor(points: (number | null)[]): { d: string; isolated: { x: number; y: number }[] } {
    let d = '';
    const isolated: { x: number; y: number }[] = [];
    let i = 0;
    while (i < points.length) {
      if (points[i] === null) {
        i++;
        continue;
      }
      let j = i;
      while (j < points.length && points[j] !== null) {
        j++;
      }
      if (j - i === 1) {
        isolated.push({ x: x(props.days[i].date), y: y(points[i] as number) });
      } else {
        for (let k = i; k < j; k++) {
          d += `${k === i ? 'M' : 'L'} ${x(props.days[k].date).toFixed(1)} ${y(points[k] as number).toFixed(1)} `;
        }
      }
      i = j;
    }
    return { d: d.trim(), isolated };
  }

  const xTicks = () => {
    const count = props.days.length;
    if (count === 0) {
      return [] as { label: string; xPx: number; anchor: 'start' | 'middle' | 'end' }[];
    }
    const tickCount = Math.min(width() < 560 ? 4 : 7, count);
    const seen = new Set<number>();
    const ticks: { label: string; xPx: number; anchor: 'start' | 'middle' | 'end' }[] = [];
    for (let i = 0; i < tickCount; i++) {
      const idx = tickCount === 1 ? 0 : Math.round((i / (tickCount - 1)) * (count - 1));
      if (seen.has(idx)) {
        continue;
      }
      seen.add(idx);
      const d = props.days[idx].date;
      // The first and last labels hang inward so neither clips at the edge.
      const anchor = idx === 0 ? 'start' : idx === count - 1 ? 'end' : 'middle';
      ticks.push({ label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), xPx: x(d), anchor });
    }
    return ticks;
  };
  const markerPoints = createMemo(() =>
    props.markers
      .map(m => ({ label: m.label, day: props.days.find(d => d.key === m.date) }))
      .filter((m): m is { label: string; day: DayBin } => m.day !== undefined)
      .map(m => ({ label: m.label, xPx: x(m.day.date) }))
  );
  // Dots only on a short window: on a two-week or smoothed line they are noise.
  const showDots = () => props.days.length <= 7;

  // Crosshair: hover follows the mouse; a tap pins on touch and a drag scrubs.
  const [hoverIdx, setHoverIdx] = createSignal<number | null>(null);
  const [pinIdx, setPinIdx] = createSignal<number | null>(null);
  let svgRef: SVGSVGElement | undefined;
  let wrapRef: HTMLDivElement | undefined;
  let scrubbing = false;

  function indexFromPointer(e: PointerEvent): number | null {
    if (!svgRef || props.days.length === 0) {
      return null;
    }
    const rect = svgRef.getBoundingClientRect();
    if (rect.width === 0) {
      return null;
    }
    const svgX = ((e.clientX - rect.left) / rect.width) * width();
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < props.days.length; i++) {
      const dx = Math.abs(x(props.days[i].date) - svgX);
      if (dx < bestDist) {
        bestDist = dx;
        best = i;
      }
    }
    return best;
  }
  function handlePointerMove(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      setHoverIdx(indexFromPointer(e));
      return;
    }
    if (scrubbing) {
      const idx = indexFromPointer(e);
      if (idx !== null && idx !== pinIdx()) {
        setPinIdx(idx);
      }
    }
  }
  function handlePointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      return;
    }
    scrubbing = true;
    svgRef?.setPointerCapture(e.pointerId);
    const idx = indexFromPointer(e);
    if (idx !== null) {
      setPinIdx(prev => (prev === idx ? null : idx));
    }
  }
  const handlePointerUp = () => {
    scrubbing = false;
  };

  const hoverData = createMemo(() => {
    const i = hoverIdx() ?? pinIdx();
    if (i === null || i >= props.days.length) {
      return null;
    }
    const day = props.days[i];
    const entries = visibleSeries()
      .map(s => ({
        label: s.label,
        slugs: slugsByName().get(s.name) ?? [],
        color: colorOf(s.name),
        value: s.points[i]
      }))
      .filter((e): e is { label: string; slugs: string[]; color: string; value: number } => e.value !== null)
      .sort((a, b) => b.value - a.value);
    return { day, entries, xPx: x(day.date) };
  });
  const tooltip = createChartTooltipPlacement(
    () => wrapRef,
    width,
    () => hoverData()?.xPx ?? null
  );

  return (
    <div class='chart-card trends-chart-card' ref={containerRef}>
      <div class='chart-svg-wrap' ref={wrapRef}>
        <svg
          class='chart trend-chart'
          ref={svgRef}
          width={width()}
          height={height()}
          viewBox={`0 0 ${width()} ${height()}`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIdx(null)}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <g class='grid'>
            <For each={yTicks()}>
              {v => (
                <>
                  <line x1={PADDING.left} x2={width() - PADDING.right} y1={y(v)} y2={y(v)} />
                  <text x={PADDING.left - 6} y={y(v)} class='axis-label' text-anchor='end' dominant-baseline='middle'>
                    {v}%
                  </text>
                </>
              )}
            </For>
          </g>
          <text
            class='axis-title'
            x={12}
            y={PADDING.top + innerH() / 2}
            transform={`rotate(-90 12 ${PADDING.top + innerH() / 2})`}
            text-anchor='middle'
          >
            {props.yLabel}
          </text>
          <g>
            <For each={xTicks()}>
              {tick => (
                <text x={tick.xPx} y={height() - PADDING.bottom + 18} class='axis-label' text-anchor={tick.anchor}>
                  {tick.label}
                </text>
              )}
            </For>
          </g>
          <For each={markerPoints()}>
            {m => (
              <g class='trend-marker'>
                <line x1={m.xPx} x2={m.xPx} y1={PADDING.top} y2={height() - PADDING.bottom} />
                <text x={m.xPx + 4} y={PADDING.top + 10}>
                  {m.label}
                </text>
              </g>
            )}
          </For>
          <For each={visibleSeries()}>
            {series => {
              const color = colorOf(series.name);
              const seg = createMemo(() => segmentsFor(series.points));
              const dim = () => props.highlight !== null && props.highlight !== series.name;
              return (
                <g style={{ opacity: dim() ? 0.22 : 1 }}>
                  <path
                    d={seg().d}
                    fill='none'
                    stroke={color}
                    stroke-width='2'
                    stroke-linecap='round'
                    stroke-linejoin='round'
                  />
                  <Show
                    when={showDots()}
                    fallback={
                      <For each={seg().isolated}>{pt => <circle cx={pt.x} cy={pt.y} r='3' fill={color} />}</For>
                    }
                  >
                    <For each={series.points}>
                      {(v, j) =>
                        v === null ? null : <circle cx={x(props.days[j()].date)} cy={y(v)} r='3' fill={color} />
                      }
                    </For>
                  </Show>
                </g>
              );
            }}
          </For>
          <Show when={hoverData()}>
            {h => (
              <g class='hover-layer' pointer-events='none'>
                <line x1={h().xPx} x2={h().xPx} y1={PADDING.top} y2={height() - PADDING.bottom} class='hover-line' />
                <For each={h().entries}>
                  {e => <circle cx={h().xPx} cy={y(e.value)} r='4.5' fill={e.color} class='hover-dot' />}
                </For>
              </g>
            )}
          </Show>
        </svg>
        <Show when={hoverData()}>
          {h => (
            <div class='chart-tooltip' ref={tooltip.observeTooltip} style={tooltip.style()}>
              <div class='chart-tooltip-date'>
                {h().day.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
              <ul class='chart-tooltip-list'>
                <For each={h().entries}>
                  {e => (
                    <li>
                      <span class='dot' style={{ background: e.color }} />
                      <ArchetypeIcons slugs={e.slugs} size={16} reserveSlot />
                      <span class='label'>{e.label}</span>
                      <span class='value'>{e.value.toFixed(1)}%</span>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}

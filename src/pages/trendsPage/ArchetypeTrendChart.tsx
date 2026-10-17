import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { getArchetypeIconMap, resolveArchetypeIcons } from '../../lib/data';
import type { ArchetypeSeries, DayBin } from '../../lib/majorsTrends';
import { createChartTooltipPlacement } from './chartTooltip';
import { DAY_MS, yAxisDomain } from './weekly';

/** Eight lines at most, so eight colours and none repeats. */
const LINE_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)'
];

/** Line colour for the rail position `index` (cycles past eight). */
export function lineColor(index: number): string {
  return LINE_COLORS[index % LINE_COLORS.length];
}

interface ArchetypeTrendChartProps {
  series: ArchetypeSeries[];
  /** Line colour per series name, keyed by rail position so no two lines share one. */
  colors: Map<string, string>;
  days: DayBin[];
  /** Names of the series to draw. */
  visible: string[];
  /** A series to bring forward while the rest fade (the rail's hover). */
  highlight: string | null;
  yLabel: string;
}

const PADDING = { top: 16, right: 16, bottom: 32, left: 46 };

/**
 * Beside the rail, the card is stretched to the rail's height and the chart
 * fills it. Must match the `.trends-chart-cell` breakpoint in trends.css.
 */
const BESIDE_RAIL_QUERY = '(min-width: 901px)';
/** Shortest the chart draws when it fills, so a short rail never crushes it. */
const MIN_FILL_HEIGHT = 240;

/**
 * The archetype line chart. It owns the crosshair, the tooltip, and the touch
 * scrub; which lines show and what the legend says is the rail's business,
 * so the chart takes a list of visible names and draws exactly those.
 */
export function ArchetypeTrendChart(props: ArchetypeTrendChartProps) {
  const iconMap = getArchetypeIconMap;
  const colorOf = (name: string): string => props.colors.get(name) ?? lineColor(0);
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
  // Height the card offers when it is stretched beside the rail; 0 when stacked,
  // where the card's height comes from the chart and measuring it would loop.
  const [fillHeight, setFillHeight] = createSignal(0);
  onMount(() => {
    if (!containerRef) {
      return;
    }
    const beside = window.matchMedia(BESIDE_RAIL_QUERY);
    const initial = containerRef.getBoundingClientRect().width;
    if (initial > 0) {
      setWidth(initial);
    }
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0) {
          setWidth(w);
        }
        setFillHeight(beside.matches ? h : 0);
      }
    });
    ro.observe(containerRef);
    onCleanup(() => ro.disconnect());
  });
  const innerW = () => width() - PADDING.left - PADDING.right;
  const height = () => {
    const fill = fillHeight();
    if (fill > 0) {
      return Math.max(MIN_FILL_HEIGHT, Math.floor(fill));
    }
    return width() < 560 ? 220 : 300;
  };
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

  const yDomain = createMemo(() =>
    yAxisDomain(visibleSeries().flatMap(s => s.points.filter((p): p is number => p !== null)))
  );
  const y = (v: number) => {
    const { min, max } = yDomain();
    return PADDING.top + innerH() - ((v - min) / (max - min)) * innerH();
  };
  const yTicks = () => yDomain().ticks;

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
          <Axes
            yTicks={yTicks()}
            xTicks={xTicks()}
            y={y}
            width={width()}
            height={height()}
            innerH={innerH()}
            yLabel={props.yLabel}
          />
          <For each={visibleSeries()}>
            {series => (
              <SeriesLine
                points={series.points}
                segments={segmentsFor(series.points)}
                color={colorOf(series.name)}
                dim={props.highlight !== null && props.highlight !== series.name}
                dots={showDots()}
                at={(j, v) => ({ x: x(props.days[j].date), y: y(v) })}
              />
            )}
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
            <ChartTooltip
              date={h().day.date}
              entries={h().entries}
              ref={tooltip.observeTooltip}
              style={tooltip.style()}
            />
          )}
        </Show>
      </div>
    </div>
  );
}

interface Segments {
  d: string;
  isolated: { x: number; y: number }[];
}

/**
 * One archetype's line. Lines are 2.5px: the vivid light-mode greens and
 * oranges fall under 3:1 on white, and the rail's hover or focus fades the
 * rest so a series can be singled out without its colour.
 */
function SeriesLine(props: {
  points: (number | null)[];
  segments: Segments;
  color: string;
  dim: boolean;
  dots: boolean;
  at: (index: number, value: number) => { x: number; y: number };
}) {
  const segments = createMemo(() => props.segments);
  return (
    <g style={{ opacity: props.dim ? 0.22 : 1 }}>
      <path
        d={segments().d}
        fill='none'
        stroke={props.color}
        stroke-width='2.5'
        stroke-linecap='round'
        stroke-linejoin='round'
      />
      <Show
        when={props.dots}
        fallback={<For each={segments().isolated}>{pt => <circle cx={pt.x} cy={pt.y} r='3' fill={props.color} />}</For>}
      >
        <For each={props.points}>
          {(v, j) =>
            v === null ? null : <circle cx={props.at(j(), v).x} cy={props.at(j(), v).y} r='3' fill={props.color} />
          }
        </For>
      </Show>
    </g>
  );
}

/** The hovered day's values, highest first. */
function ChartTooltip(props: {
  date: Date;
  entries: { label: string; slugs: string[]; color: string; value: number }[];
  ref: (el: HTMLElement) => void;
  style: JSX.CSSProperties;
}) {
  return (
    <div class='chart-tooltip' ref={props.ref} style={props.style}>
      <div class='chart-tooltip-date'>
        {props.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
      </div>
      <ul class='chart-tooltip-list'>
        <For each={props.entries}>
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
  );
}

/** The value grid and its labels, the axis title, and the date ticks along the foot. */
function Axes(props: {
  yTicks: number[];
  xTicks: { xPx: number; label: string; anchor: 'start' | 'middle' | 'end' }[];
  y: (value: number) => number;
  width: number;
  height: number;
  innerH: number;
  yLabel: string;
}) {
  return (
    <>
      <g class='grid'>
        <For each={props.yTicks}>
          {v => (
            <>
              <line x1={PADDING.left} x2={props.width - PADDING.right} y1={props.y(v)} y2={props.y(v)} />
              <text x={PADDING.left - 6} y={props.y(v)} class='axis-label' text-anchor='end' dominant-baseline='middle'>
                {v}%
              </text>
            </>
          )}
        </For>
      </g>
      <text
        class='axis-title'
        x={12}
        y={PADDING.top + props.innerH / 2}
        transform={`rotate(-90 12 ${PADDING.top + props.innerH / 2})`}
        text-anchor='middle'
      >
        {props.yLabel}
      </text>
      <g>
        <For each={props.xTicks}>
          {tick => (
            <text x={tick.xPx} y={props.height - PADDING.bottom + 18} class='axis-label' text-anchor={tick.anchor}>
              {tick.label}
            </text>
          )}
        </For>
      </g>
    </>
  );
}

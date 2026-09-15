import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { cellKeyFor, cellsForCircle } from '../../shared/events/cells';
import type { EventKind } from '../../shared/events/types';
import { fetchLocalEvents, fetchLocalsIndex, fetchLocatorEvents, fetchLocatorIndex } from '../lib/data/eventLocator';
import { latestValue, resolved } from '../lib/resource';
import { filterEvents, groupByDay, type VenueMarker, venueMarkers } from '../lib/events/filter';
import { monthDay } from '../lib/events/format';
import { type DistanceUnit, toKm, unitForCountry } from '../lib/events/geo';
import type { PlaceSuggestion } from '../lib/events/search';
import {
  centerFromParams,
  type CenterSource,
  convertRadius,
  loadStored,
  type LocatorCenter,
  type LocatorParams,
  type LocatorSettings,
  paramsFor,
  saveStored,
  settingsFromParams,
  type WindowDays
} from '../lib/events/viewState';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { EventList, eventPanelId } from './eventLocator/EventList';
import { FilterBar, FilterSeam, FilterSheet } from './eventLocator/FilterSheet';
import type { LocatorFiltersProps } from './eventLocator/LocatorFilters';
import { MapPanel } from './eventLocator/MapPanel';
import { useLocatorCenter } from './eventLocator/useLocatorCenter';
import { useToday } from './eventLocator/useToday';
import '../styles/pages/event-locator.css';

const URL_WRITE_DELAY_MS = 300;
/** Centres the page picked itself say so after the place name. */
const SOURCE_NOTES: Partial<Record<CenterSource, string>> = {
  approximate: ' (approximate)'
};

function countText(total: number, cups: number): string {
  const events = `${total} event${total === 1 ? '' : 's'}`;
  return cups ? `${events}, ${cups} Cup${cups === 1 ? '' : 's'}` : events;
}

export function EventLocatorPage() {
  const [params, setParams] = useSearchParams<LocatorParams & Record<string, string>>();
  const stored = loadStored();
  const initialCenter = centerFromParams(params) ?? stored.center;
  const [settings, setSettings] = createSignal<LocatorSettings>(settingsFromParams(params, stored.settings));
  const [expanded, setExpanded] = createSignal<string | null>(null);
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [pendingShop, setPendingShop] = createSignal<string | null>(null);
  const [fitNonce, setFitNonce] = createSignal(0);
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  const today = useToday();
  // Every new centre closes the open event, adopts the country's unit (until
  // the visitor picks one), and refits the map.
  const { center, choose, locateDevice, locating, locateError, lookedUp } = useLocatorCenter(initialCenter, next => {
    setExpanded(null);
    if (next.cc && !settings().unitPinned) {
      const unit = unitForCountry(next.cc);
      setSettings(s => ({ ...s, unit }));
    }
    setFitNonce(n => n + 1);
  });

  const [index, { refetch: retryIndex }] = createResource(fetchLocatorIndex);
  const [localsIndex] = createResource(fetchLocalsIndex);
  const radiusKm = () => toKm(settings().radius, settings().unit);
  const cellKey = createMemo(() => {
    const c = center();
    return c ? cellsForCircle(c.lat, c.lon, radiusKm()).join(' ') : '';
  });
  const [loaded, { refetch: retryEvents }] = createResource(
    () => {
      const i = resolved(index);
      const key = cellKey();
      return i && key ? { i, key } : false;
    },
    async ({ i, key }) => ({ cells: key.split(' '), events: await fetchLocatorEvents(i, key.split(' ')) })
  );
  const kinds = createMemo(() => new Set<EventKind>(settings().kinds));
  // Locals are their own artifact, fetched only while the Locals filter is on
  // and expanded from weekly slots into the dates around today.
  const [locals] = createResource(
    () => {
      const li = resolved(localsIndex);
      const key = cellKey();
      return li && key && kinds().has('local') ? { li, key, today: today() } : false;
    },
    async ({ li, key, today: day }) => ({
      cells: key.split(' '),
      events: await fetchLocalEvents(li, key.split(' '), day)
    })
  );
  const coversCentre = (value: { cells: string[] } | undefined) => {
    const c = center();
    return Boolean(value && c && value.cells.includes(cellKeyFor(c.lat, c.lon)));
  };
  /**
   * The loaded listings, when they cover the current centre. While a radius
   * grows the old ones stay up (no skeleton flash); a jump elsewhere waits for
   * its own cells rather than filtering the old area against the new point.
   */
  const usable = () => {
    const value = latestValue(loaded);
    return coversCentre(value) ? value?.events : undefined;
  };
  /** Locals for the current centre, once they have arrived; none while they load or are off. */
  const usableLocals = () => {
    const value = latestValue(locals);
    return kinds().has('local') && coversCentre(value) ? (value?.events ?? []) : [];
  };

  const placed = createMemo(() => {
    const c = center();
    const events = usable();
    if (!c || !events) {
      return [];
    }
    return filterEvents([...events, ...usableLocals()], {
      center: c,
      radiusKm: radiusKm(),
      kinds: kinds(),
      windowDays: settings().windowDays,
      today: today()
    });
  });
  const days = createMemo(() => groupByDay(placed()));
  const markers = createMemo(() => venueMarkers(placed()));
  const countries = createMemo(() => new Set(resolved(index)?.countries ?? []));
  const count = () =>
    center() && usable() ? countText(placed().length, placed().filter(e => e.kind === 'cup').length) : '';

  onMount(() => {
    document.title = 'Events — Ciphermaniac';
  });

  function pickPlace(place: PlaceSuggestion) {
    // Before choosing: the effect that opens the store's event runs as soon as
    // the new centre lands, and has to find the store already pending.
    setPendingShop(place.shop ?? null);
    choose({ lat: place.lat, lon: place.lon, label: place.centerLabel, cc: place.cc, source: 'search' });
  }

  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function reveal(id: string) {
    setExpanded(id);
    requestAnimationFrame(() =>
      document
        .getElementById(eventPanelId(id))
        ?.closest('.el-item')
        ?.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' })
    );
  }

  // A store picked from search opens its next event once that area's listings arrive.
  createEffect(
    on(placed, list => {
      const shop = pendingShop();
      if (!shop || loaded.loading) {
        return;
      }
      const hit = list.find(e => e.shop === shop);
      setPendingShop(null);
      if (hit) {
        reveal(hit.id);
      }
    })
  );

  const setUnit = (unit: DistanceUnit) => {
    setSettings(s => ({ ...s, unit, unitPinned: true, radius: convertRadius(s.radius, s.unit, unit) }));
    setFitNonce(n => n + 1);
  };
  const setWindow = (windowDays: WindowDays) => setSettings(s => ({ ...s, windowDays }));
  const setRadius = (radius: number) => setSettings(s => ({ ...s, radius }));
  const refit = () => setFitNonce(n => n + 1);
  const toggleKind = (kind: EventKind) =>
    setSettings(s => ({ ...s, kinds: s.kinds.includes(kind) ? s.kinds.filter(k => k !== kind) : [...s.kinds, kind] }));

  createEffect(() => saveStored(center(), settings()));
  let urlTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const next = paramsFor(center(), settings());
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => setParams(next, { replace: true }), URL_WRITE_DELAY_MS);
  });
  onCleanup(() => clearTimeout(urlTimer));

  /** "Austin, TX (approximate)": the centre, with a note when the page picked it. It fills the empty search box. */
  const place = () => {
    const c = center();
    return c ? `${c.label}${SOURCE_NOTES[c.source] ?? ''}` : '';
  };
  /** Kinds with any events anywhere. Locals count from their own index. */
  const available = () => {
    const kindsListed = resolved(index)?.kinds;
    return kindsListed ? { ...kindsListed, local: resolved(localsIndex)?.total ?? 0 } : null;
  };
  /** Events the filters show now, or null before the area has loaded. */
  const total = () => (center() && usable() ? placed().length : null);
  // One set of filter props for the desktop panel, the phone sheet and both scope lines; getters keep them live.
  const filters: LocatorFiltersProps = {
    get kinds() {
      return kinds();
    },
    get available() {
      return available();
    },
    get windowDays() {
      return settings().windowDays;
    },
    get unit() {
      return settings().unit;
    },
    get radius() {
      return settings().radius;
    },
    onToggleKind: toggleKind,
    onWindow: setWindow,
    onUnit: setUnit,
    onRadiusInput: setRadius,
    onRadiusCommit: refit
  };

  return (
    <>
      <h1 class='sr-only'>Events near you</h1>
      {/* The one live region for the result, mounted at every width (a region that appears with its text is not announced). */}
      <p class='sr-only' aria-live='polite'>
        {count()}
      </p>
      <div class='el-layout'>
        <div class='el-map-slot'>
          <MapPanel
            index={resolved(index) ?? null}
            center={center()}
            centerLabel={center()?.label ?? ''}
            centerCountry={center()?.cc ?? null}
            countries={countries()}
            radiusKm={radiusKm()}
            markers={markers()}
            highlighted={hovered()}
            fitKey={String(fitNonce())}
            searchPlaceholder={place()}
            locating={locating()}
            locateError={locateError()}
            onPickPlace={pickPlace}
            onLocate={() => void locateDevice()}
            onMarker={(marker: VenueMarker) => reveal(marker.firstId)}
            onMarkerHover={setHovered}
            onFilters={() => setFiltersOpen(true)}
          />
        </div>
        <FilterSeam {...filters} count={count()} onOpen={() => setFiltersOpen(true)} />
        <div class='el-results'>
          <FilterBar {...filters} count={count()} />
          <Results
            index={index}
            loaded={loaded}
            hasEvents={Boolean(usable())}
            center={center()}
            lookedUp={lookedUp()}
            days={days()}
            settings={settings()}
            countries={countries()}
            today={today()}
            expanded={expanded()}
            hovered={hovered()}
            onRetry={() => void (index.error ? retryIndex() : retryEvents())}
            onToggle={id => setExpanded(current => (current === id ? null : id))}
            onHover={setHovered}
            onWiden={radius => {
              setSettings(s => ({ ...s, radius }));
              setFitNonce(n => n + 1);
            }}
            onLonger={() => setWindow(settings().windowDays === 7 ? 30 : null)}
          />
          <Credit index={resolved(index)} />
        </div>
      </div>
      <FilterSheet {...filters} open={filtersOpen()} onClose={() => setFiltersOpen(false)} total={total()} />
    </>
  );
}

/** Where the listings come from, and how fresh they are. */
function Credit(props: { index: { source: string; generatedAt: string } | undefined }) {
  return (
    <Show when={props.index}>
      {i => (
        <p class='el-credit'>
          Listings from{' '}
          <a href={i().source} target='_blank' rel='noopener'>
            Pokedata
          </a>
          , updated {monthDay(i().generatedAt.slice(0, 10))}.
        </p>
      )}
    </Show>
  );
}

interface ResultsProps {
  index: ReturnType<typeof createResource<Awaited<ReturnType<typeof fetchLocatorIndex>>>>[0];
  loaded: { error: unknown };
  /** The current area's listings have arrived. */
  hasEvents: boolean;
  center: LocatorCenter | null;
  lookedUp: boolean;
  days: ReturnType<typeof groupByDay>;
  settings: LocatorSettings;
  countries: ReadonlySet<string>;
  today: string;
  expanded: string | null;
  hovered: string | null;
  onRetry: () => void;
  onToggle: (id: string) => void;
  onHover: (venue: string | null) => void;
  onWiden: (radius: number) => void;
  onLonger: () => void;
}

const WIDER = [100, 250];

function Results(props: ResultsProps) {
  const failed = () => Boolean(props.index.error || props.loaded.error);
  // No centre yet means the first lookup is still out: that is loading, not an empty result.
  const loading = () => !resolved(props.index) || !props.center || !props.hasEvents;
  return (
    <Show
      when={!failed()}
      fallback={
        <EmptyState
          title='Couldn’t load events.'
          actions={
            <button type='button' class='btn btn-secondary' onClick={() => props.onRetry()}>
              Try again
            </button>
          }
        />
      }
    >
      <Show when={props.center || !props.lookedUp} fallback={null}>
        <Show when={!loading()} fallback={<ResultsSkeleton />}>
          <Show when={props.days.length} fallback={<NoResults {...props} />}>
            <EventList
              days={props.days}
              unit={props.settings.unit}
              today={props.today}
              expanded={props.expanded}
              highlighted={props.hovered}
              onToggle={props.onToggle}
              onHover={props.onHover}
            />
          </Show>
        </Show>
      </Show>
    </Show>
  );
}

function NoResults(props: ResultsProps) {
  const country = () => props.center?.cc ?? null;
  const unlisted = () => country() && props.countries.size > 0 && !props.countries.has(country() as string);
  const wider = () => WIDER.find(r => r > props.settings.radius);
  return (
    <Show
      when={!unlisted()}
      fallback={
        <EmptyState
          title={`No events listed in ${new Intl.DisplayNames(['en'], { type: 'region' }).of(country() as string) ?? country()}.`}
        />
      }
    >
      <EmptyState
        title={`Nothing ${props.settings.windowDays ? `in the next ${props.settings.windowDays} days` : 'listed'} within ${props.settings.radius} ${props.settings.unit}.`}
        actions={
          <>
            <Show when={wider()}>
              {radius => (
                <button type='button' class='btn btn-secondary' onClick={() => props.onWiden(radius())}>
                  Widen to {radius()} {props.settings.unit}
                </button>
              )}
            </Show>
            <Show when={props.settings.windowDays}>
              <button type='button' class='btn btn-ghost' onClick={() => props.onLonger()}>
                Look further ahead
              </button>
            </Show>
          </>
        }
      />
    </Show>
  );
}

const SKELETON_DAYS = [3, 2, 3];

function ResultsSkeleton() {
  return (
    <div class='el-days' aria-hidden='true'>
      <For each={SKELETON_DAYS}>
        {rows => (
          <section class='el-day'>
            <div class='el-day-head'>
              <Skeleton width='120px' height='13px' />
            </div>
            <ul class='el-list'>
              <For each={Array.from({ length: rows })}>
                {() => (
                  <li class='el-item el-skeleton'>
                    <div class='el-row'>
                      <Skeleton width='44px' height='12px' />
                      <span class='el-main'>
                        <Skeleton width='70%' height='13px' />
                        <Skeleton width='45%' height='12px' />
                      </span>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
    </div>
  );
}

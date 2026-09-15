import { Show } from 'solid-js';
import type { VenueMarker } from '../../lib/events/filter';
import type { DistanceUnit, LatLon } from '../../lib/events/geo';
import type { PlaceSuggestion } from '../../lib/events/search';
import { RADIUS_MAX, RADIUS_MIN, RADIUS_STEP } from '../../lib/events/viewState';
import type { Insets } from '../../lib/events/mercator';
import type { LocatorIndex } from '../../../shared/events/types';
import { LocatorMap } from './LocatorMap';
import { PlaceSearch } from './PlaceSearch';

/** Map area under the search box (top) and the radius control (bottom). */
const MAP_INSETS: Insets = { top: 64, right: 16, bottom: 64, left: 16 };

export interface MapPanelProps {
  index: LocatorIndex | null;
  center: LatLon | null;
  centerLabel: string;
  centerCountry: string | null;
  countries: ReadonlySet<string>;
  radius: number;
  radiusKm: number;
  unit: DistanceUnit;
  markers: VenueMarker[];
  highlighted: string | null;
  fitKey: string;
  collapsed: boolean;
  locating: boolean;
  locateError: string | null;
  onRadiusInput: (radius: number) => void;
  onRadiusCommit: () => void;
  onPickPlace: (place: PlaceSuggestion) => void;
  onPickPoint: (point: LatLon) => void;
  onLocate: () => void;
  onMarker: (marker: VenueMarker) => void;
  onMarkerHover: (key: string | null) => void;
  onExpand: () => void;
}

/** The map and the controls that sit on it: search, locate, radius. */
export function MapPanel(props: MapPanelProps) {
  return (
    <div class='el-map-frame' classList={{ collapsed: props.collapsed }}>
      <div class='el-map-canvas'>
        <LocatorMap
          center={props.center}
          radiusKm={props.radiusKm}
          markers={props.markers}
          fitKey={props.fitKey}
          insets={MAP_INSETS}
          highlighted={props.highlighted}
          onMarker={props.onMarker}
          onMarkerHover={props.onMarkerHover}
          onPick={props.onPickPoint}
        />
      </div>
      <PlaceSearch
        index={props.index}
        near={props.center}
        currentLabel={props.centerLabel}
        currentCountry={props.centerCountry}
        countries={props.countries}
        locating={props.locating}
        locateError={props.locateError}
        onPick={props.onPickPlace}
        onLocate={props.onLocate}
      />
      <button
        type='button'
        class='el-locate'
        classList={{ busy: props.locating }}
        aria-label='Use my location'
        title='Use my location'
        aria-busy={props.locating}
        onClick={() => props.onLocate()}
      >
        <svg viewBox='0 0 24 24' aria-hidden='true'>
          <circle cx='12' cy='12' r='3' />
          <path d='M12 2v4M12 18v4M2 12h4M18 12h4' />
          <circle cx='12' cy='12' r='8' />
        </svg>
      </button>
      <Show when={props.center}>
        <label class='el-radius'>
          <span>Within</span>
          <input
            type='range'
            min={RADIUS_MIN}
            max={RADIUS_MAX}
            step={RADIUS_STEP}
            value={props.radius}
            aria-valuetext={`${props.radius} ${props.unit}`}
            onInput={e => props.onRadiusInput(Number(e.currentTarget.value))}
            onChange={() => props.onRadiusCommit()}
          />
          <output>
            {props.radius} {props.unit}
          </output>
        </label>
      </Show>
      <button type='button' class='el-map-expand' aria-label='Show the map' onClick={() => props.onExpand()} />
    </div>
  );
}

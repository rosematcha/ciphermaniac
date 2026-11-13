import { createMemo, createResource, createSignal, Match, onMount, Switch, untrack } from 'solid-js';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { fetchSimCities, type SimCities, type SimCity } from './regSim/data';
import { type Division, type Draw, liveDraw, newDraw, playerId } from './regSim/model';
import { EventDetails } from './regSim/EventDetails';
import { RegisterForm } from './regSim/RegisterForm';
import { Confirmation } from './regSim/Confirmation';
import { SiteFooter } from './regSim/SiteFooter';
import '../styles/pages/reg-sim.css';

const STORAGE_KEY = 'ciphermaniac:reg-sim';

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(draw: Draw): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draw));
  } catch {
    /* Private windows: the draw still works, it just won't survive a reload. */
  }
}

/** This device's draw if it is under two hours old, otherwise a fresh one. */
function currentDraw(data: SimCities): Draw {
  const ids = new Set(data.cities.map(city => city.id));
  const kept = liveDraw(readStored(), Date.now(), id => ids.has(id));
  if (kept) {
    return kept;
  }
  const draw = newDraw(new Date(), data.cities, Math.random);
  store(draw);
  return draw;
}

/**
 * Registration Simulator (/tools/registration).
 *
 * A parody of a tournament registration page. Each visitor draws a city and an
 * opening time at the next top of the hour; the page does not refresh itself,
 * so catching the opening means reloading at the right moment, as with the
 * real thing.
 */
export function RegistrationPage() {
  const [data] = createResource(fetchSimCities);

  onMount(() => {
    document.title = 'Registration Simulator — Ciphermaniac';
  });

  return (
    <div class='regsim'>
      <Switch fallback={<Skeleton width='100%' height='420px' />}>
        <Match when={data.state === 'errored'}>
          <EmptyState title='The event list did not load.' description='Reload the page to try again.' />
        </Match>
        <Match when={data()}>{loaded => <Simulation data={loaded()} />}</Match>
      </Switch>
      <SiteFooter />
    </div>
  );
}

function Simulation(props: { data: SimCities }) {
  const [draw, setDraw] = createSignal(untrack(() => currentDraw(props.data)));
  const [registering, setRegisteringSignal] = createSignal(false);
  // Each step is a new page as far as the visitor is concerned: start it at the top.
  const setRegistering = (value: boolean) => {
    setRegisteringSignal(value);
    window.scrollTo(0, 0);
  };
  const city = createMemo(() => props.data.cities.find(row => row.id === draw().cityId) as SimCity);
  // Read once: the page shows what was true when it loaded, like the real one.
  const open = untrack(() => Date.now() >= draw().opensAt);

  const register = (division: Division) => {
    save({ ...draw(), registeredAt: Date.now(), division, playerId: playerId(Math.random) });
    setRegistering(false);
  };
  // Cancelling clears the registration but keeps the draw, so the visitor can go again.
  const cancel = () => {
    const { registeredAt: _registeredAt, division: _division, ...rest } = draw();
    save(rest);
    window.scrollTo(0, 0);
  };
  const save = (next: Draw) => {
    store(next);
    setDraw(next);
  };

  return (
    <Switch fallback={<EventDetails city={city()} draw={draw()} open={open} onRegister={() => setRegistering(true)} />}>
      <Match when={draw().registeredAt}>
        {registeredAt => <Confirmation city={city()} draw={draw()} registeredAt={registeredAt()} onCancel={cancel} />}
      </Match>
      <Match when={registering()}>
        <RegisterForm city={city()} draw={draw()} onSubmit={register} onCancel={() => setRegistering(false)} />
      </Match>
    </Switch>
  );
}

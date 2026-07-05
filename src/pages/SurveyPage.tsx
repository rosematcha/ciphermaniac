import { createSignal, For, onMount, Show } from 'solid-js';

import evaGif from '../assets/eva-evangelion.gif';
import { isSurveyClosed, SURVEY_CLOSED_MESSAGE } from '../lib/survey';
import '../styles/pages/survey.css';

/**
 * SurveyPage — Ciphermaniac user survey.
 * Collects responses and POSTs them to /api/survey (D1-backed). Closes on the
 * date in ../lib/survey, after which the closed message is shown instead.
 */

const REGIONS = ['North America', 'Europe', 'Latin America', 'Oceania', 'MESA'];

const AREAS = [
  'The card view',
  'The archetype view',
  'The archetype filtration system',
  'The meta trends view',
  'The player view'
];

const DEVICES = ['On a desktop', 'On a mobile device', 'On a tablet', 'On a smart refrigerator', 'On a Nintendo 3DS'];

const FORMATS = [
  'Expanded',
  'Gym Leader Challenge',
  'Eternal',
  'Retro (RSPK, 2010, EFG)',
  'None of these, I just care about standard'
];

const FORMATS_NONE = 'None of these, I just care about standard';

const DISCOVERY = ['Through Twitter', 'Through a Google search', 'Through a recommendation from a friend'];

const OTHER = 'Other';

export function SurveyPage() {
  onMount(() => {
    document.title = 'Survey — Ciphermaniac';
  });

  const closed = isSurveyClosed();

  const [region, setRegion] = createSignal<string | null>(null);
  const [areas, setAreas] = createSignal<string[]>([]);
  const [readability, setReadability] = createSignal<Record<string, number>>({});
  const [effectiveness, setEffectiveness] = createSignal<Record<string, number>>({});
  const [devices, setDevices] = createSignal<string[]>([]);
  const [deviceOther, setDeviceOther] = createSignal('');
  const [layout, setLayout] = createSignal<Record<string, number>>({});
  const [speed, setSpeed] = createSignal<number | null>(null);
  const [trust, setTrust] = createSignal<number | null>(null);
  const [recommend, setRecommend] = createSignal<number | null>(null);
  const [formats, setFormats] = createSignal<string[]>([]);
  const [formatOther, setFormatOther] = createSignal('');
  const [oneThing, setOneThing] = createSignal('');
  const [annoyance, setAnnoyance] = createSignal('');
  const [discovery, setDiscovery] = createSignal<string | null>(null);
  const [discoveryOther, setDiscoveryOther] = createSignal('');
  const [anythingElse, setAnythingElse] = createSignal('');
  const [honeypot, setHoneypot] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [submitError, setSubmitError] = createSignal(false);
  const [submitted, setSubmitted] = createSignal(false);

  const toggleArea = (a: string) => setAreas(cur => (cur.includes(a) ? cur.filter(x => x !== a) : [...cur, a]));

  // Keep grids in canonical order, showing only areas the user selected.
  const selectedAreas = () => AREAS.filter(a => areas().includes(a));

  const setRead = (area: string, n: number) => setReadability(cur => ({ ...cur, [area]: n }));
  const setEff = (area: string, n: number) => setEffectiveness(cur => ({ ...cur, [area]: n }));

  const toggleDevice = (d: string) => setDevices(cur => (cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d]));
  const selectedDevices = () => DEVICES.filter(d => devices().includes(d));
  const setLayoutRating = (device: string, n: number) => setLayout(cur => ({ ...cur, [device]: n }));

  // "None of these" is mutually exclusive with the real formats.
  const toggleFormat = (f: string) =>
    setFormats(cur => {
      if (f === FORMATS_NONE) {
        return cur.includes(f) ? [] : [FORMATS_NONE];
      }
      const next = cur.includes(f) ? cur.filter(x => x !== f) : [...cur, f];
      return next.filter(x => x !== FORMATS_NONE);
    });

  return (
    <Show
      when={!closed}
      fallback={
        <section>
          <div class='survey-done survey-closed'>
            <p>{SURVEY_CLOSED_MESSAGE}</p>
          </div>
        </section>
      }
    >
      <section class='hero survey-hero'>
        <h1>Ciphermaniac user survey</h1>
      </section>

      <Show
        when={!submitted()}
        fallback={
          <section>
            <div class='survey-done'>
              <h2>Congratulations!</h2>
              <img class='survey-done-gif' src={evaGif} alt='' />
              <p>
                I appreciate you taking the time to fill out this survey! Any user feedback always helps. I'll make a
                summary post after the survey closes. Thanks again! :)
              </p>
            </div>
          </section>
        }
      >
        <section>
          <form
            class='survey'
            onSubmit={async e => {
              e.preventDefault();
              if (submitting()) {
                return;
              }
              setSubmitError(false);
              setSubmitting(true);
              try {
                const res = await fetch('/api/survey', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    region: region(),
                    areas: areas(),
                    readability: readability(),
                    effectiveness: effectiveness(),
                    devices: devices(),
                    deviceOther: deviceOther(),
                    layout: layout(),
                    speed: speed(),
                    trust: trust(),
                    recommend: recommend(),
                    formats: formats(),
                    formatOther: formatOther(),
                    feature: oneThing(),
                    annoyance: annoyance(),
                    discovery: discovery(),
                    discoveryOther: discoveryOther(),
                    anythingElse: anythingElse(),
                    hp: honeypot()
                  })
                });
                if (!res.ok) {
                  throw new Error(`Request failed: ${res.status}`);
                }
                setSubmitted(true);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              } catch {
                setSubmitError(true);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <p class='survey-intro'>
              Thanks for participating in the Ciphermaniac user survey! This helps me get an idea of how people are
              using Ciphermaniac, what's working, what's not, and what can be added in the future. All questions are
              optional, so feel free to skip ones you aren't sure about.
            </p>

            {/* Honeypot — hidden from real users; bots that fill it are silently dropped. */}
            <div class='hp-field' aria-hidden='true'>
              <label>
                Website
                <input
                  type='text'
                  tabindex='-1'
                  autocomplete='off'
                  value={honeypot()}
                  onInput={e => setHoneypot(e.currentTarget.value)}
                />
              </label>
            </div>

            {/* Q1 — region */}
            <div class='q'>
              <div class='q-title'>What region do you play in?</div>
              <div class='choices'>
                <For each={REGIONS}>
                  {opt => (
                    <button type='button' class='chip' aria-pressed={region() === opt} onClick={() => setRegion(opt)}>
                      {opt}
                    </button>
                  )}
                </For>
              </div>
            </div>

            {/* Q2 — which areas they use */}
            <div class='q'>
              <div class='q-title'>What parts of Ciphermaniac do you actively use?</div>
              <p class='q-help'>Select all that apply.</p>
              <div class='choices'>
                <For each={AREAS}>
                  {opt => (
                    <button
                      type='button'
                      class='chip'
                      aria-pressed={areas().includes(opt)}
                      onClick={() => toggleArea(opt)}
                    >
                      {opt}
                    </button>
                  )}
                </For>
              </div>
            </div>

            {/* Q3 — readability, only for selected areas */}
            <div class='q'>
              <div class='q-title'>How easy is each area you use to visually read?</div>
              <p class='q-help'>1 = hard to read, 5 = very easy.</p>
              <Show
                when={selectedAreas().length > 0}
                fallback={<div class='q-empty'>Selections will appear once you pick the parts you use above.</div>}
              >
                <div class='grid-rows'>
                  <For each={selectedAreas()}>
                    {area => (
                      <div class='grid-row'>
                        <span class='label'>{area}</span>
                        <div class='dots'>
                          <For each={[1, 2, 3, 4, 5]}>
                            {n => (
                              <button
                                type='button'
                                class='dot'
                                aria-pressed={readability()[area] === n}
                                onClick={() => setRead(area, n)}
                              >
                                {n}
                              </button>
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            {/* Q4 — effectiveness, only for selected areas */}
            <div class='q'>
              <div class='q-title'>How effective is each area you use at getting you the data you want?</div>
              <p class='q-help'>1 = can't find what I need, 5 = gets me exactly what I want.</p>
              <Show
                when={selectedAreas().length > 0}
                fallback={<div class='q-empty'>Selections will appear once you pick the parts you use above.</div>}
              >
                <div class='grid-rows'>
                  <For each={selectedAreas()}>
                    {area => (
                      <div class='grid-row'>
                        <span class='label'>{area}</span>
                        <div class='dots'>
                          <For each={[1, 2, 3, 4, 5]}>
                            {n => (
                              <button
                                type='button'
                                class='dot'
                                aria-pressed={effectiveness()[area] === n}
                                onClick={() => setEff(area, n)}
                              >
                                {n}
                              </button>
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            {/* Q5 — devices */}
            <div class='q'>
              <div class='q-title'>Where do you use Ciphermaniac?</div>
              <p class='q-help'>Select all that apply.</p>
              <div class='choices'>
                <For each={DEVICES}>
                  {opt => (
                    <button
                      type='button'
                      class='chip'
                      aria-pressed={devices().includes(opt)}
                      onClick={() => toggleDevice(opt)}
                    >
                      {opt}
                    </button>
                  )}
                </For>
                <button
                  type='button'
                  class='chip'
                  aria-pressed={devices().includes(OTHER)}
                  onClick={() => toggleDevice(OTHER)}
                >
                  Other…
                </button>
              </div>
              <Show when={devices().includes(OTHER)}>
                <input
                  type='text'
                  class='other-input'
                  placeholder='Where else? (e.g. a smart TV)'
                  value={deviceOther()}
                  onInput={e => setDeviceOther(e.currentTarget.value)}
                />
              </Show>
            </div>

            {/* Q6 — layout feel per device, conditional on Q5 */}
            <div class='q'>
              <div class='q-title'>How does the layout of the site feel on the devices you use Ciphermaniac on?</div>
              <p class='q-help'>1 = feels cramped or awkward, 5 = feels great.</p>
              <Show
                when={selectedDevices().length > 0}
                fallback={
                  <div class='q-empty'>Selections will appear once you pick where you use Ciphermaniac above.</div>
                }
              >
                <div class='grid-rows'>
                  <For each={selectedDevices()}>
                    {device => (
                      <div class='grid-row'>
                        <span class='label'>{device}</span>
                        <div class='dots'>
                          <For each={[1, 2, 3, 4, 5]}>
                            {n => (
                              <button
                                type='button'
                                class='dot'
                                aria-pressed={layout()[device] === n}
                                onClick={() => setLayoutRating(device, n)}
                              >
                                {n}
                              </button>
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            {/* Q7 — speed */}
            <div class='q'>
              <div class='q-title'>How fast does the site feel?</div>
              <p class='q-help'>1 = sluggish, 5 = snappy.</p>
              <div class='dots'>
                <For each={[1, 2, 3, 4, 5]}>
                  {n => (
                    <button type='button' class='dot' aria-pressed={speed() === n} onClick={() => setSpeed(n)}>
                      {n}
                    </button>
                  )}
                </For>
              </div>
            </div>

            {/* Q8 — trust */}
            <div class='q'>
              <div class='q-title'>Do you trust the data is accurate and up to date?</div>
              <p class='q-help'>1 = not really, 5 = completely.</p>
              <div class='dots'>
                <For each={[1, 2, 3, 4, 5]}>
                  {n => (
                    <button type='button' class='dot' aria-pressed={trust() === n} onClick={() => setTrust(n)}>
                      {n}
                    </button>
                  )}
                </For>
              </div>
            </div>

            {/* Q9 — recommendation (NPS-style) */}
            <div class='q'>
              <div class='q-title'>How likely are you to recommend Ciphermaniac to another player?</div>
              <p class='q-help'>0 = not at all likely, 10 = extremely likely.</p>
              <div class='dots wrap'>
                <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}>
                  {n => (
                    <button type='button' class='dot' aria-pressed={recommend() === n} onClick={() => setRecommend(n)}>
                      {n}
                    </button>
                  )}
                </For>
              </div>
            </div>

            {/* Q10 — additional formats */}
            <div class='q'>
              <div class='q-title'>
                If Ciphermaniac added support for additional formats, which would you like to see?
              </div>
              <p class='q-help'>Select all that apply.</p>
              <div class='choices'>
                <For each={FORMATS}>
                  {opt => (
                    <button
                      type='button'
                      class='chip'
                      aria-pressed={formats().includes(opt)}
                      onClick={() => toggleFormat(opt)}
                    >
                      {opt}
                    </button>
                  )}
                </For>
                <button
                  type='button'
                  class='chip'
                  aria-pressed={formats().includes(OTHER)}
                  onClick={() => toggleFormat(OTHER)}
                >
                  Other…
                </button>
              </div>
              <Show when={formats().includes(OTHER)}>
                <input
                  type='text'
                  class='other-input'
                  placeholder='Which format?'
                  value={formatOther()}
                  onInput={e => setFormatOther(e.currentTarget.value)}
                />
              </Show>
            </div>

            {/* Feature request */}
            <div class='q'>
              <div class='q-title'>What's a feature that would make Ciphermaniac more useful to you?</div>
              <textarea
                placeholder='Type your answer here.'
                value={oneThing()}
                onInput={e => setOneThing(e.currentTarget.value)}
              />
            </div>

            {/* Annoyance */}
            <div class='q'>
              <div class='q-title'>Anything confusing, broken, or annoying?</div>
              <textarea
                placeholder='Type your answer here.'
                value={annoyance()}
                onInput={e => setAnnoyance(e.currentTarget.value)}
              />
            </div>

            {/* Q15 — discovery */}
            <div class='q'>
              <div class='q-title'>How did you find out about Ciphermaniac?</div>
              <div class='choices'>
                <For each={DISCOVERY}>
                  {opt => (
                    <button
                      type='button'
                      class='chip'
                      aria-pressed={discovery() === opt}
                      onClick={() => setDiscovery(opt)}
                    >
                      {opt}
                    </button>
                  )}
                </For>
                <button
                  type='button'
                  class='chip'
                  aria-pressed={discovery() === OTHER}
                  onClick={() => setDiscovery(OTHER)}
                >
                  Other…
                </button>
              </div>
              <Show when={discovery() === OTHER}>
                <input
                  type='text'
                  class='other-input'
                  placeholder='How did you find it?'
                  value={discoveryOther()}
                  onInput={e => setDiscoveryOther(e.currentTarget.value)}
                />
              </Show>
            </div>

            {/* Anything else */}
            <div class='q'>
              <div class='q-title'>Anything else you'd like to add?</div>
              <textarea
                placeholder='Type your answer here.'
                value={anythingElse()}
                onInput={e => setAnythingElse(e.currentTarget.value)}
              />
            </div>

            <div class='actions'>
              <button type='submit' class='btn btn-primary' disabled={submitting()}>
                {submitting() ? 'Sending…' : 'Send it'}
              </button>
              <span class='privacy'>Responses are anonymous.</span>
            </div>
            <Show when={submitError()}>
              <p class='survey-error'>Something went wrong sending your response. Please try again.</p>
            </Show>
          </form>
        </section>
      </Show>
    </Show>
  );
}

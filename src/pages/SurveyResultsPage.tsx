import { createSignal, For, onMount, Show } from 'solid-js';

import '../styles/pages/survey.css';

interface Avg {
  avg: number | null;
  count: number;
}
interface TextEntry {
  at: string;
  text: string;
}
interface Results {
  total: number;
  generatedAt: string;
  region: Record<string, number>;
  discovery: Record<string, number>;
  devices: Record<string, number>;
  formats: Record<string, number>;
  areas: Record<string, number>;
  speed: Avg;
  trust: Avg;
  recommend: Avg;
  nps: number | null;
  readability: Record<string, Avg>;
  effectiveness: Record<string, Avg>;
  layout: Record<string, Avg>;
  feature: TextEntry[];
  annoyance: TextEntry[];
  anythingElse: TextEntry[];
}

/** Count map → rows sorted desc, with a proportional bar. */
function CountBars(props: { data: Record<string, number> }) {
  const entries = () => Object.entries(props.data).sort((a, b) => b[1] - a[1]);
  const max = () => Math.max(1, ...Object.values(props.data));
  return (
    <Show when={entries().length > 0} fallback={<p class='results-empty'>No responses yet.</p>}>
      <div class='bars'>
        <For each={entries()}>
          {([label, count]) => (
            <div class='bar-row'>
              <span class='bar-label'>{label}</span>
              <span class='bar-track'>
                <span class='bar-fill' style={{ width: `${(count / max()) * 100}%` }} />
              </span>
              <span class='bar-count'>{count}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

/** Per-label average (1–5) with response count. */
function AvgList(props: { data: Record<string, Avg> }) {
  const entries = () => Object.entries(props.data).sort((a, b) => (b[1].avg ?? 0) - (a[1].avg ?? 0));
  return (
    <Show when={entries().length > 0} fallback={<p class='results-empty'>No ratings yet.</p>}>
      <div class='bars'>
        <For each={entries()}>
          {([label, v]) => (
            <div class='bar-row'>
              <span class='bar-label'>{label}</span>
              <span class='bar-track'>
                <span class='bar-fill' style={{ width: `${((v.avg ?? 0) / 5) * 100}%` }} />
              </span>
              <span class='bar-count'>
                {v.avg ?? '—'} <span class='muted'>({v.count})</span>
              </span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

function TextList(props: { data: TextEntry[] }) {
  return (
    <Show when={props.data.length > 0} fallback={<p class='results-empty'>No answers yet.</p>}>
      <ul class='text-list'>
        <For each={props.data}>
          {entry => (
            <li>
              <span class='text-date'>{entry.at.slice(0, 10)}</span>
              <span>{entry.text}</span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

export function SurveyResultsPage() {
  const [data, setData] = createSignal<Results | null>(null);
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/survey/results');
      if (!res.ok) {
        setError(`Error ${res.status}.`);
        return;
      }
      setData((await res.json()) as Results);
    } catch {
      setError('Network error — is the API running? (Requires wrangler / a deploy.)');
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    document.title = 'Survey results — Ciphermaniac';
    void load();
  });

  return (
    <>
      <section class='hero survey-hero'>
        <h1>Survey results</h1>
      </section>

      <section>
        <Show
          when={data()}
          fallback={
            <div class='survey'>
              <div class='q'>
                <Show when={loading()} fallback={<p class='survey-error'>{error() || 'No data.'}</p>}>
                  <p class='results-empty'>Loading…</p>
                </Show>
              </div>
            </div>
          }
        >
          {d => (
            <div class='survey results'>
              <div class='results-topbar'>
                <span class='muted'>
                  {d().total} response{d().total === 1 ? '' : 's'} · generated{' '}
                  {d().generatedAt.slice(0, 16).replace('T', ' ')}
                </span>
              </div>

              <div class='results-tiles'>
                <div class='tile'>
                  <div class='tile-num'>{d().speed.avg ?? '—'}</div>
                  <div class='tile-label'>Avg speed (1–5)</div>
                </div>
                <div class='tile'>
                  <div class='tile-num'>{d().trust.avg ?? '—'}</div>
                  <div class='tile-label'>Avg trust (1–5)</div>
                </div>
                <div class='tile'>
                  <div class='tile-num'>{d().recommend.avg ?? '—'}</div>
                  <div class='tile-label'>Avg recommend (0–10)</div>
                </div>
                <div class='tile'>
                  <div class='tile-num'>{d().nps ?? '—'}</div>
                  <div class='tile-label'>NPS</div>
                </div>
              </div>

              <div class='q'>
                <div class='q-title'>Parts actively used</div>
                <CountBars data={d().areas} />
              </div>
              <div class='q'>
                <div class='q-title'>Readability (avg 1–5)</div>
                <AvgList data={d().readability} />
              </div>
              <div class='q'>
                <div class='q-title'>Data effectiveness (avg 1–5)</div>
                <AvgList data={d().effectiveness} />
              </div>
              <div class='q'>
                <div class='q-title'>Region</div>
                <CountBars data={d().region} />
              </div>
              <div class='q'>
                <div class='q-title'>Devices</div>
                <CountBars data={d().devices} />
              </div>
              <div class='q'>
                <div class='q-title'>Layout feel by device (avg 1–5)</div>
                <AvgList data={d().layout} />
              </div>
              <div class='q'>
                <div class='q-title'>Formats wanted</div>
                <CountBars data={d().formats} />
              </div>
              <div class='q'>
                <div class='q-title'>How they found it</div>
                <CountBars data={d().discovery} />
              </div>
              <div class='q'>
                <div class='q-title'>Feature requests</div>
                <TextList data={d().feature} />
              </div>
              <div class='q'>
                <div class='q-title'>Confusing / broken / annoying</div>
                <TextList data={d().annoyance} />
              </div>
              <div class='q'>
                <div class='q-title'>Anything else</div>
                <TextList data={d().anythingElse} />
              </div>
            </div>
          )}
        </Show>
      </section>
    </>
  );
}

import { createSignal, For, type JSX, Match, onCleanup, onMount, type ParentComponent, Show, Switch } from 'solid-js';
import { Badge } from '../components/Badge';
import { ChipGroup, SearchInput } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { InfoTip } from '../components/InfoTip';
import { Pagination } from '../components/Pagination';
import { Section } from '../components/Section';
import { Segmented } from '../components/Segmented';
import { Skeleton } from '../components/Skeleton';
import { Tabs } from '../components/Tabs';
import { Trend } from '../components/Trend';
import { EXCEPTIONS, RULINGS, TOKEN_GROUPS, type TokenGroup, type TokenKind } from './styleGuide/catalogue';
import '../styles/pages/style-guide.css';

/**
 * /style — the living style guide.
 *
 * Deliberately unlinked from the top nav and the tools index: it is a reference
 * for whoever is building, not a destination. It ships anyway (rather than
 * living in a scratch file) because a guide that renders through the real
 * stylesheets cannot drift from them, and one that copies their values always
 * will.
 *
 * Nothing here fetches. Every specimen is the real component or the real class,
 * and every token value is read off the live document.
 */

/**
 * Resolve the design tokens against the document. Re-reads whenever the mode
 * flips, so the values printed beside each swatch are the ones actually in
 * force rather than the light-mode defaults.
 */
function useTokenValues(): () => Record<string, string> {
  const [values, setValues] = createSignal<Record<string, string>>({});

  const read = () => {
    const style = getComputedStyle(document.body);
    const next: Record<string, string> = {};
    for (const group of TOKEN_GROUPS) {
      for (const token of group.tokens) {
        next[token.name] = style.getPropertyValue(token.name).trim();
      }
    }
    setValues(next);
  };

  onMount(() => {
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
    // The auto-dark path pins no attribute, so a system theme change moves the
    // tokens without touching the DOM at all.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', read);
    onCleanup(() => {
      observer.disconnect();
      media.removeEventListener('change', read);
    });
  });

  return values;
}

/** Renders the visual half of a token row — what the value actually looks like. */
function TokenSwatch(props: { kind: TokenKind; name: string }) {
  return (
    <Switch fallback={<span class='stg-swatch-none' aria-hidden='true' />}>
      <Match when={props.kind === 'color'}>
        <span class='stg-swatch-color' style={{ background: `var(${props.name})` }} />
      </Match>
      <Match when={props.kind === 'shape'}>
        <span class='stg-swatch-shape' style={{ 'border-radius': `var(${props.name})` }} />
      </Match>
      <Match when={props.kind === 'space'}>
        <span class='stg-swatch-space' style={{ width: `var(${props.name})` }} />
      </Match>
      <Match when={props.kind === 'shadow'}>
        <span class='stg-swatch-shadow' style={{ 'box-shadow': `var(${props.name})` }} />
      </Match>
      <Match when={props.kind === 'motion'}>
        <span class='stg-swatch-motion' />
      </Match>
    </Switch>
  );
}

function TokenTable(props: { group: TokenGroup; values: Record<string, string> }) {
  return (
    <div class='stg-tokens'>
      <h3>{props.group.title}</h3>
      <Show when={props.group.note}>
        <p class='stg-note'>{props.group.note}</p>
      </Show>
      <ul class='stg-token-list'>
        <For each={props.group.tokens}>
          {token => (
            <li class='stg-token'>
              <TokenSwatch kind={props.group.kind} name={token.name} />
              <code class='stg-token-name'>{token.name}</code>
              <span class='stg-token-value num'>{props.values[token.name] || '—'}</span>
              <span class='stg-token-note'>{token.note ?? ''}</span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

/**
 * One specimen: the live thing, then its selector and a one-line rule beneath.
 * The caption sits under the sample rather than over it — a small all-caps line
 * above a heading is an eyebrow, and the house rules forbid those.
 */
const Spec: ParentComponent<{ selector: string; rule?: string; wide?: boolean }> = props => {
  return (
    <div class='stg-spec' classList={{ 'stg-spec-wide': props.wide }}>
      <div class='stg-spec-stage'>{props.children}</div>
      <div class='stg-spec-caption'>
        <code>{props.selector}</code>
        <Show when={props.rule}>
          <span>{props.rule}</span>
        </Show>
      </div>
    </div>
  );
};

function ColourSpecimens(props: { values: Record<string, string> }) {
  return (
    <For each={TOKEN_GROUPS.filter(g => g.kind === 'color')}>
      {group => <TokenTable group={group} values={props.values} />}
    </For>
  );
}

function ShapeSpecimens(props: { values: Record<string, string> }) {
  return (
    <For each={TOKEN_GROUPS.filter(g => g.kind !== 'color')}>
      {group => <TokenTable group={group} values={props.values} />}
    </For>
  );
}

function TypeSpecimens() {
  return (
    <div class='stg-grid'>
      <Spec selector='h1' rule='Page title. One per route, inside .hero.' wide>
        <h1>Charizard ex</h1>
      </Spec>
      <Spec selector='h2' rule='Section title. Always via <Section title>.' wide>
        <h2>Top card movers</h2>
      </Spec>
      <Spec selector='h3' rule='Sub-head inside a panel.' wide>
        <h3>Copies played</h3>
      </Spec>
      <Spec selector='body' rule='15px base, 1.5. Data rows drop to 13px.' wide>
        <p>Inter, self-hosted at 400 through 800. System sans is the only fallback.</p>
      </Spec>
      <Spec selector='.label-micro' rule='11px / 600 / 0.08em. The one uppercase caption.' wide>
        <span class='label-micro'>Inclusion rate</span>
      </Spec>
      <Spec selector='.num' rule='Tabular figures on every number that sits in a column.' wide>
        <span class='num'>
          11,482 · 63.4% · $18.00
          <br />
          10,000 · 60.0% · $10.00
        </span>
      </Spec>
    </div>
  );
}

function ButtonSpecimens() {
  return (
    <div class='stg-grid'>
      <Spec selector='.btn.btn-primary' rule='One per view, on the single action that matters.'>
        <button type='button' class='btn btn-primary'>
          Export list
        </button>
      </Spec>
      <Spec selector='.btn.btn-secondary' rule='The default. Bordered, on surface.'>
        <button type='button' class='btn btn-secondary'>
          Copy
        </button>
      </Spec>
      <Spec selector='.btn.btn-ghost' rule='Borderless, for a tertiary action beside another button.'>
        <button type='button' class='btn btn-ghost'>
          Reset
        </button>
      </Spec>
      <Spec selector='.btn:disabled' rule='0.4 and not-allowed, for every button. Never hide a disabled action.'>
        <button type='button' class='btn btn-secondary' disabled>
          Copy
        </button>
      </Spec>
      <Spec
        selector=':focus-visible'
        rule='2px accent outline at 2px offset, on every control. Drawn statically here; tab through this page to see the real thing.'
      >
        <button type='button' class='btn btn-secondary stg-focus-demo'>
          Copy
        </button>
      </Spec>
    </div>
  );
}

function ChipSpecimens(props: {
  chip: string;
  onChip: (v: string) => void;
  seg: string;
  onSeg: (v: string) => void;
  search: string;
  onSearch: (v: string) => void;
}) {
  return (
    <div class='stg-grid'>
      <Spec selector='.chips > .chip' rule='Toggle. Pressed state is an accent fill.' wide>
        <ChipGroup
          options={[
            { value: 'all', label: 'All' },
            { value: 'day2', label: 'Day 2' },
            { value: 'cut', label: 'Top cut' }
          ]}
          selected={props.chip}
          onSelect={props.onChip}
        />
      </Spec>
      <Spec selector='.badge' rule='Reads state. Never clickable.'>
        <span class='stg-row'>
          <Badge>Rotated</Badge>
          <Badge variant='regulation'>G</Badge>
        </span>
      </Spec>
      <Spec selector='.segmented' rule='Two to four mutually exclusive views of the same data.'>
        <Segmented
          options={[
            { value: 'grid', label: 'Grid' },
            { value: 'list', label: 'List' }
          ]}
          selected={props.seg}
          onSelect={props.onSeg}
          ariaLabel='View'
        />
      </Spec>
      <Spec
        selector='.search'
        rule='A field on the page background: --surface. Shown at its current --radius-md; the ruling puts every field on --radius-sm.'
        wide
      >
        <SearchInput value={props.search} onInput={props.onSearch} placeholder='Search cards' />
      </Spec>
    </div>
  );
}

function DataSpecimens() {
  return (
    <>
      <div class='stg-grid'>
        <Spec selector='.kpi' rule='Headline figure. Label above, value, then context.'>
          <div class='kpi'>
            <span class='kpi-label'>Decks recorded</span>
            <span class='kpi-value'>1,204</span>
            <span class='kpi-foot'>
              <Trend direction='up' delta='4.1%' /> vs last event
            </span>
          </div>
        </Spec>
        <Spec selector='.trend' rule='Direction glyph plus the delta. Colour never carries it alone.'>
          <span class='stg-row'>
            <Trend direction='up' delta='2.4%' />
            <Trend direction='down' delta='1.1%' />
            <Trend direction='flat' />
          </span>
        </Spec>
        <Spec
          selector='.au-bar (cards.css)'
          rule='8px, --surface-2 track, --accent fill, --radius-sm, no border. Drawn here from the spec — the real rule still lives in a page sheet and wants promoting.'
        >
          <div class='stg-bar-demo'>
            <div class='stg-bar'>
              <div class='stg-bar-fill' style={{ width: '64%' }} />
            </div>
            <span class='num'>64%</span>
          </div>
        </Spec>
        <Spec selector='.skeleton' rule='Reserve the real size. Never a spinner.'>
          <div class='stg-stack'>
            <Skeleton width='180px' height='16px' />
            <Skeleton width='120px' height='12px' />
          </div>
        </Spec>
      </div>
      <Spec selector='.table-wrap > table.data' rule='38px rows, hairline rules, sticky uppercase header.' wide>
        <div class='table-wrap'>
          <table class='data'>
            <thead>
              <tr>
                <th>Card</th>
                <th class='num'>Decks</th>
                <th class='num'>Share</th>
              </tr>
            </thead>
            <tbody>
              <For
                each={[
                  ['Iono', '842', '71%'],
                  ['Boss’s Orders', '610', '52%'],
                  ['Rare Candy', '388', '33%']
                ]}
              >
                {row => (
                  <tr>
                    <td class='cardname'>{row[0]}</td>
                    <td class='num'>{row[1]}</td>
                    <td class='num'>{row[2]}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Spec>
    </>
  );
}

function SurfaceSpecimens() {
  return (
    <div class='stg-grid'>
      <Spec selector='.stats-panel' rule='1px ink border, --radius-md, --shadow-1. Hairlines inside.' wide>
        <div class='stats-panel'>
          <div class='stat-row'>
            <span class='stat-label'>Decks</span>
            <span class='stat-value num'>842</span>
          </div>
          <div class='stat-row'>
            <span class='stat-label'>Average copies</span>
            <span class='stat-value num'>2.6</span>
          </div>
        </div>
      </Spec>
      <Spec selector='.info-tip' rule='A caveat that would otherwise clutter the row.'>
        <span>
          Win rate
          <InfoTip label='Sample note'>Mirror matches are excluded from this figure.</InfoTip>
        </span>
      </Spec>
      <Spec selector='.empty-state' rule='Mark, heading, one line, actions. Heading ends in a full stop.' wide>
        <EmptyState
          title='No cards match.'
          description='Widen the filters, or clear them and start again.'
          actions={
            <button type='button' class='btn btn-secondary'>
              Clear filters
            </button>
          }
        />
      </Spec>
    </div>
  );
}

function AnatomySpecimens(props: {
  tab: string;
  onTab: (v: string) => void;
  page: number;
  onPage: (n: number) => void;
}) {
  return (
    <>
      <Spec selector='.hero > h1 + .hero-meta' rule='Every route opens with this. The h1 is the page title.' wide>
        <div class='hero'>
          <h1>Charizard ex</h1>
          <div class='hero-meta'>
            <span>Obsidian Flames 125</span>
            <span class='dot'>·</span>
            <span>Standard</span>
          </div>
        </div>
      </Spec>
      <Spec selector='.section-head' rule='h2 left, optional muted meta right. Rendered by <Section>.' wide>
        <div class='section-head'>
          <h2>Top card movers</h2>
          <span class='right'>Across 14 tournaments</span>
        </div>
      </Spec>
      <Spec selector='.tabs' rule='Top-level navigation within a page. Scrolls on phones.' wide>
        <Tabs
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'cards', label: 'Cards' },
            { value: 'matchups', label: 'Matchups' }
          ]}
          selected={props.tab}
          onSelect={props.onTab}
          ariaLabel='Example'
        />
      </Spec>
      <Spec selector='.pagination' rule='Numbered. Sits below the list it pages.' wide>
        <Pagination page={props.page} totalPages={9} onChange={props.onPage} pageSize={50} totalItems={432} />
      </Spec>
    </>
  );
}

function Ledger() {
  return (
    <ul class='stg-ledger'>
      <For each={RULINGS}>
        {item => (
          <li class='stg-ruling' classList={{ 'stg-ruling-open': item.status === 'open' }}>
            <div class='stg-ruling-head'>
              <h3>{item.element}</h3>
              <span class='stg-ruling-status'>{item.status === 'open' ? 'Undecided' : 'Settled'}</span>
            </div>
            <p class='stg-ruling-found'>{item.found}</p>
            <p class='stg-ruling-verdict'>{item.ruling}</p>
            <ul class='stg-ruling-sites'>
              <For each={item.sites}>
                {site => (
                  <li>
                    <code>{site}</code>
                  </li>
                )}
              </For>
            </ul>
          </li>
        )}
      </For>
    </ul>
  );
}

export function StyleGuidePage(): JSX.Element {
  const values = useTokenValues();
  const [chip, setChip] = createSignal('all');
  const [seg, setSeg] = createSignal('grid');
  const [tab, setTab] = createSignal('overview');
  const [search, setSearch] = createSignal('');
  const [page, setPage] = createSignal(3);

  onMount(() => {
    document.title = 'Style guide — Ciphermaniac';
  });

  return (
    <>
      <section class='hero'>
        <h1>Style guide</h1>
        <div class='hero-meta'>
          <span>STAMP, as the code actually implements it</span>
          <span class='dot'>·</span>
          <span>Values read live — flip the mode in the nav and they follow</span>
        </div>
      </section>

      <Section title='Colour'>
        <ColourSpecimens values={values()} />
      </Section>

      <Section title='Shape, space, elevation, motion'>
        <ShapeSpecimens values={values()} />
      </Section>

      <Section title='Typography'>
        <TypeSpecimens />
      </Section>

      <Section title='Buttons'>
        <ButtonSpecimens />
      </Section>

      <Section title='Selection'>
        <ChipSpecimens
          chip={chip()}
          onChip={setChip}
          seg={seg()}
          onSeg={setSeg}
          search={search()}
          onSearch={setSearch}
        />
      </Section>

      <Section title='Data display'>
        <DataSpecimens />
      </Section>

      <Section title='Surfaces and states'>
        <SurfaceSpecimens />
      </Section>

      <Section title='Page anatomy'>
        <AnatomySpecimens tab={tab()} onTab={setTab} page={page()} onPage={setPage} />
      </Section>

      <Section title='Drift ledger' right={`${RULINGS.filter(r => r.status === 'open').length} undecided`}>
        <p class='stg-note stg-note-lead'>
          Every place the codebase still does one thing two ways, and which way wins. The rulings that could be applied
          mechanically already have been, and <code>npm run check:design</code> now fails the build on anything new that
          breaks one. What is left needs a decision or a copy change.
        </p>
        <Ledger />
      </Section>

      <Section title='Sanctioned exceptions'>
        <ul class='stg-exceptions'>
          <For each={EXCEPTIONS}>
            {item => (
              <li>
                <span class='stg-exception-what'>{item.what}</span>
                <span class='stg-exception-why'>{item.why}</span>
              </li>
            )}
          </For>
        </ul>
      </Section>
    </>
  );
}

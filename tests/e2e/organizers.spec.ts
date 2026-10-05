/**
 * Becoming an organizer, against mocked functions: the apply page's store
 * Application uploads its certificate on pick and sends it with a note or
 * without either, sends an incomplete profile to Settings, and shows where a
 * sent one stands, with Apply again after a rejection. The store form's own
 * fields are covered in stores.spec.ts.
 */

import { expect, type Page, test } from '@playwright/test';

import type { AccountRole } from '../../shared/accounts/roles';
import type { ApplicationState, MyApplication, MyStore } from '../../shared/accounts/types';

const ME = {
  id: 'acct-1',
  name: 'Mary',
  avatar: null,
  popId: '7200001' as string | null,
  firstName: 'Mary',
  lastName: 'Jackson',
  birthDate: '02/27/1995',
  role: null as AccountRole | null,
  handle: 'reese',
  publicProfile: false,
  profileName: 'real' as 'real' | 'handle',
  providers: ['google'],
  stores: [] as MyStore[]
};

/** The store an approved Application made, as /api/me lists it. */
const STORE: MyStore = {
  id: 'store-1',
  name: 'Combat Power Gaming',
  leagueId: '6238620',
  status: 'active',
  timeZone: 'America/Chicago',
  role: 'manager'
};

const NONE: ApplicationState = { application: null, proof: null, eligible: { profile: true } };

/** What the locator knows of the league applied for. */
const LEAGUE = {
  leagueId: '6238620',
  shop: 'COMBAT POWER GAMING',
  address: '4522 FREDERICKSBURG RD #B64',
  city: 'SAN ANTONIO',
  region: 'TX',
  cc: 'US',
  lat: 29.49,
  lon: -98.55,
  timeZone: 'America/Chicago'
};

const DAY = Date.UTC(2026, 8, 28, 12);

const application = (status: MyApplication['status'], extra: Partial<MyApplication> = {}): MyApplication => ({
  id: 'app-1',
  status,
  explanation: '',
  proofType: null,
  createdAt: DAY,
  decidedAt: status === 'pending' ? null : DAY + 86_400_000,
  note: null,
  store: null,
  ...extra
});

/** A one-pixel PNG, as a picked file. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

interface Asked {
  method: string;
  path: string;
  body: unknown;
}

interface Options {
  /** The Application the account's latest is once a pending one is withdrawn: the one decided before it, or none. */
  afterWithdraw?: MyApplication | null;
  /** Holds an upload's answer until it settles. */
  upload?: Promise<void>;
  /** The account as /api/me reads it the second time, after a decision the page has not seen. */
  reread?: typeof ME;
}

/** The applicant endpoints, holding the account's state as the functions would, and every ask they get. */
async function mockApplicant(page: Page, start: ApplicationState, user: typeof ME | null = ME, options: Options = {}) {
  const asks: Asked[] = [];
  let state = start;
  let reads = 0;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const method = request.method();
    const { pathname } = new URL(request.url());
    const key = `${method} ${pathname}`;
    asks.push({ method, path: pathname, body: method === 'POST' ? request.postDataJSON() : null });
    if (key === 'GET /api/me') {
      reads += 1;
      const current = reads > 1 && options.reread ? options.reread : user;
      return route.fulfill({ json: { user: current, providers: ['google', 'discord'] } });
    }
    if (key === 'GET /api/applications/mine') {
      return route.fulfill({ json: state });
    }
    if (key === 'PUT /api/applications/proof') {
      await options.upload;
      if (request.postDataBuffer()?.subarray(0, 4).toString() === 'text') {
        return route.fulfill({ status: 400, json: { error: 'Use a PNG, JPEG, WebP or PDF' } });
      }
      const proof = { type: 'image/png', size: request.postDataBuffer()?.byteLength ?? 0 };
      state = { ...state, proof };
      return route.fulfill({ json: { proof } });
    }
    if (key === 'DELETE /api/applications/proof') {
      state = { ...state, proof: null };
      return route.fulfill({ status: 204 });
    }
    if (method === 'GET' && pathname.startsWith('/api/leagues/')) {
      return route.fulfill({ json: { leagueId: '6238620', league: LEAGUE, taken: false } });
    }
    if (key === 'POST /api/applications') {
      const body = request.postDataJSON() as { explanation: string; proof: boolean };
      const sent = application('pending', {
        explanation: body.explanation,
        proofType: body.proof ? 'image/png' : null
      });
      state = { ...state, application: sent, proof: null };
      return route.fulfill({ status: 201, json: { application: sent } });
    }
    if (key === 'DELETE /api/applications/mine') {
      state = { ...state, application: options.afterWithdraw ?? null };
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  return asks;
}

const posted = (asks: Asked[]) =>
  asks
    .filter(a => a.method === 'POST')
    .map(a => {
      const { explanation, proof, store } = a.body as { explanation: string; proof: boolean; store: unknown };
      return { explanation, proof, store: Boolean(store) };
    });

/** Picks the Store row and looks its league up, then answers the questions the form needs answered. */
async function openStoreForm(page: Page) {
  await page.getByRole('radio', { name: /(?:Store|Organized play location)/ }).check();
  await page.getByLabel('League ID or pokemon.com league page').fill('6238620');
  await page.getByRole('button', { name: 'Look up' }).click();
  await page.getByLabel('How you run it').selectOption('owner');
  await page.getByRole('checkbox', { name: /certified/ }).check();
}

test('the store application uploads the certificate on pick, then sends it with the note @mobile', async ({ page }) => {
  const asks = await mockApplicant(page, NONE);
  await page.goto('/apply');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run events');
  await openStoreForm(page);
  const send = page.getByRole('button', { name: 'Send application' });
  await page.getByLabel('Certificate').focus();
  await page.getByLabel('Certificate').setInputFiles({ name: 'certificate.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.tm-apply-file')).toContainText('certificate.png');
  await expect(page.locator('.tm-apply-file')).toContainText('1 KB');
  await expect(send).toBeEnabled();
  // The picker it replaced held the focus, so the focus goes on to Remove, then back to the picker.
  await expect(page.getByRole('button', { name: 'Remove' })).toBeFocused();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.tm-apply-file')).toHaveCount(0);
  await expect(page.getByLabel('Certificate')).toBeFocused();
  await page.getByLabel('Certificate').setInputFiles({ name: 'certificate.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await page.getByLabel('Note').fill('I run the Thursday league.');
  await expect(page.locator('.tm-apply-count')).toHaveText('26 / 2000');
  await send.click();
  await expect(page.locator('.tm-applicant')).toContainText('Application pending');
  await expect(page.getByRole('button', { name: 'Withdraw' })).toBeVisible();
  await expect(send).toHaveCount(0);
  expect(asks.filter(a => a.path === '/api/applications/proof').map(a => a.method)).toEqual(['PUT', 'DELETE', 'PUT']);
  expect(posted(asks)).toEqual([{ explanation: 'I run the Thursday league.', proof: true, store: true }]);
});

test('a store application sends with neither certificate nor note', async ({ page }) => {
  const asks = await mockApplicant(page, NONE);
  await page.goto('/apply');
  await openStoreForm(page);
  await page.getByLabel('Note').fill('   ');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.locator('.tm-applicant')).toContainText('Application pending');
  expect(posted(asks)).toEqual([{ explanation: '', proof: false, store: true }]);
  expect(asks.some(a => a.path === '/api/applications/proof')).toBe(false);
});

test('an incomplete profile is sent to Settings, with no form', async ({ page }) => {
  await mockApplicant(page, { ...NONE, eligible: { profile: false } }, { ...ME, popId: null });
  await page.goto('/apply');
  await page.getByRole('radio', { name: /(?:Store|Organized play location)/ }).check();
  await expect(page.getByRole('link', { name: 'Complete your profile' })).toHaveAttribute('href', '/settings');
  await expect(page.getByRole('button', { name: 'Send application' })).toHaveCount(0);
});

test('a pending Application shows where it stands instead of the form, and withdraws', async ({ page }) => {
  const asks = await mockApplicant(page, { ...NONE, application: application('pending') });
  await page.goto('/apply');
  const status = page.locator('.tm-applicant');
  await expect(status).toContainText('Application pending');
  await expect(status).toContainText('Sent');
  await expect(page.getByRole('button', { name: 'Send application' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Withdraw' }).click();
  await page
    .getByRole('group', { name: 'Withdraw your application?' })
    .getByRole('button', { name: 'Withdraw' })
    .click();
  await expect(page.getByRole('radio', { name: /(?:Store|Organized play location)/ })).toBeVisible();
  expect(asks.filter(a => a.method === 'DELETE').map(a => a.path)).toEqual(['/api/applications/mine']);
});

test('after a rejection, the note shows and Apply again opens the form', async ({ page }) => {
  const asks = await mockApplicant(page, {
    ...NONE,
    application: application('rejected', { note: 'Send your certificate, please.' })
  });
  await page.goto('/apply');
  const status = page.locator('.tm-applicant');
  await expect(status).toContainText('Not approved');
  await expect(status).toContainText('Send your certificate, please.');
  await expect(page.getByRole('button', { name: 'Send application' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply again' }).click();
  await expect(page.getByRole('button', { name: 'Apply again' })).toHaveCount(0);
  // Applying again is applying for a store again: its row opens at once.
  await expect(page.getByRole('radio', { name: /(?:Store|Organized play location)/ })).toBeChecked();
  await openStoreForm(page);
  await page.getByLabel('Note').fill('Certificate is on its way.');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(status).toContainText('Application pending');
  expect(posted(asks)).toEqual([{ explanation: 'Certificate is on its way.', proof: false, store: true }]);
});

test('an organizer whose access was removed sees so, and applies again from there', async ({ page }) => {
  await mockApplicant(page, NONE, { ...ME, role: 'revoked' });
  await page.goto('/apply');
  await expect(page.locator('.tm-applicant')).toContainText('Organizer access removed');
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply again' }).click();
  // Community access was taken away, so only the store is offered.
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.getByRole('radio', { name: /(?:Store|Organized play location)/ })).toBeChecked();
});

test('an approved account sees its store was approved, with the way to its events', async ({ page }) => {
  await mockApplicant(page, { ...NONE, application: application('approved') }, { ...ME, stores: [STORE] });
  await page.goto('/apply');
  await expect(page.locator('.tm-applicant-stage strong')).toHaveText('Store approved');
  await expect(page.locator('.tm-applicant').getByRole('link', { name: 'Your events' })).toHaveAttribute(
    'href',
    '/host'
  );
  await expect(page.getByRole('button', { name: 'Send application' })).toHaveCount(0);
});

test('signed out, the apply page offers sign-in that comes back to it', async ({ page }) => {
  await mockApplicant(page, NONE, null);
  await page.goto('/apply');
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', /next=%2Fapply/);
});

test('a refused upload says why, and a file over 8 MB is refused before it is sent', async ({ page }) => {
  const asks = await mockApplicant(page, NONE);
  await page.goto('/apply');
  await openStoreForm(page);
  await page
    .getByLabel('Certificate')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('text') });
  await expect(page.getByRole('alert')).toHaveText('Use a PNG, JPEG, WebP or PDF');
  const big = Buffer.alloc(8 * 1024 * 1024 + 1);
  await page.getByLabel('Certificate').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: big });
  await expect(page.getByRole('alert')).toHaveText('Up to 8 MB');
  expect(asks.filter(a => a.method === 'PUT')).toHaveLength(1);
});

test('a refused upload after a removed one gives the focus back to the picker', async ({ page }) => {
  await mockApplicant(page, NONE);
  await page.goto('/apply');
  await openStoreForm(page);
  const picker = page.getByLabel('Certificate');
  await picker.setInputFiles({ name: 'certificate.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(picker).toBeFocused();
  await picker.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('text') });
  await expect(page.getByRole('alert')).toHaveText('Use a PNG, JPEG, WebP or PDF');
  await expect(picker).toBeFocused();
});

test('Send application waits for an upload in flight', async ({ page }) => {
  let land = () => undefined as void;
  const upload = new Promise<void>(resolve => {
    land = resolve;
  });
  await mockApplicant(page, NONE, ME, { upload });
  await page.goto('/apply');
  await openStoreForm(page);
  const send = page.getByRole('button', { name: 'Send application' });
  await page.getByLabel('Note').fill('I run a league.');
  await expect(send).toBeEnabled();
  await page.getByLabel('Certificate').setInputFiles({ name: 'certificate.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.tm-apply-file[role=status]')).toHaveText('Uploading certificate.png');
  await expect(send).toBeDisabled();
  land();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await expect(send).toBeEnabled();
  // The note being written keeps the focus when the upload lands.
  await expect(page.getByLabel('Note')).toBeFocused();
});

test('an account approved since the page read it is read again, and starts events', async ({ page }) => {
  const asks = await mockApplicant(page, { ...NONE, application: application('approved') }, ME, {
    reread: { ...ME, stores: [STORE] }
  });
  await page.route('**/api/tournaments', route => route.fulfill({ json: { tournaments: [] } }));
  await page.goto('/host');
  await expect(page.getByRole('button', { name: 'Start an event' })).toBeVisible();
  expect(asks.filter(a => a.path === '/api/me')).toHaveLength(2);
});

// ---------- Settings: where the account stands ----------

test('Settings shows each applicant stage with its step @mobile', async ({ page }) => {
  const stages: [ApplicationState, typeof ME, string, string, string][] = [
    [NONE, ME, '', 'Apply to run events', '/apply'],
    [
      { ...NONE, application: application('rejected', { note: 'Send your certificate.' }) },
      ME,
      'Not approved',
      'Apply again',
      '/apply?again=1'
    ],
    [
      { ...NONE, application: application('approved') },
      { ...ME, stores: [STORE] },
      'Store approved',
      'Your events',
      '/host'
    ],
    [NONE, { ...ME, role: 'community' }, 'Community organizer', 'Your events', '/host'],
    [NONE, { ...ME, role: 'revoked' }, 'Organizer access removed', 'Apply again', '/apply?again=1'],
    [NONE, { ...ME, role: 'admin' }, 'Admin', 'Admin page', '/admin']
  ];
  for (const [state, user, words, step, href] of stages) {
    await page.unrouteAll();
    const asks = await mockApplicant(page, state, user);
    await page.goto('/settings');
    const status = page.locator('.tm-applicant');
    await expect(status.getByRole('link', { name: step, exact: true })).toHaveAttribute('href', href);
    if (words) {
      await expect(status.locator('.tm-applicant-stage strong')).toHaveText(words);
    } else {
      await expect(status.locator('.tm-applicant-stage')).toHaveCount(0);
    }
    // Your events is offered once: under Organizer for an account that runs events, by the name otherwise.
    await expect(page.getByRole('link', { name: 'Your events' })).toHaveCount(1);
    // Anyone may apply for a store, so every account's page asks where its Application stands.
    expect(asks.some(a => a.path === '/api/applications/mine')).toBe(true);
  }
  await expect(page.locator('.tm-applicant').getByRole('link', { name: 'Your events' })).toHaveAttribute(
    'href',
    '/host'
  );
});

test('Settings shows a pending Application with its day, and withdraws it', async ({ page }) => {
  const asks = await mockApplicant(page, { ...NONE, application: application('pending') });
  await page.goto('/settings');
  const status = page.locator('.tm-applicant');
  await expect(status).toContainText('Application pending');
  await expect(status).toContainText(/Sent .*2026/);
  await status.getByRole('button', { name: 'Withdraw' }).click();
  await status
    .getByRole('group', { name: 'Withdraw your application?' })
    .getByRole('button', { name: 'Withdraw' })
    .click();
  await expect(status.getByRole('link', { name: 'Apply to run events' })).toBeVisible();
  expect(asks.filter(a => a.method === 'DELETE').map(a => a.path)).toEqual(['/api/applications/mine']);
});

test('withdrawn, an Application gives way to the decision before it @mobile', async ({ page }) => {
  const rejected = application('rejected', { id: 'app-0', note: 'Send your certificate.' });
  await mockApplicant(page, { ...NONE, application: application('pending') }, ME, { afterWithdraw: rejected });
  // The narrowest phones, where the question and its buttons are wider than the box.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/settings');
  const status = page.locator('.tm-applicant');
  await status.getByRole('button', { name: 'Withdraw' }).click();
  const question = status.getByRole('group', { name: 'Withdraw your application?' });
  // The question wraps inside the screen rather than running past it.
  const asked = await question.boundingBox();
  expect((asked?.x ?? 0) + (asked?.width ?? 0)).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await question.getByRole('button', { name: 'Withdraw' }).click();
  await expect(status.locator('.tm-applicant-stage strong')).toHaveText('Not approved');
  await expect(status).toContainText('Send your certificate.');
});

test('Apply again on Settings opens the apply page at its form', async ({ page }) => {
  await mockApplicant(page, { ...NONE, application: application('rejected') });
  await page.goto('/settings');
  await page.locator('.tm-applicant').getByRole('link', { name: 'Apply again' }).click();
  await expect(page).toHaveURL(/\/apply\?again=1$/);
  await expect(page.locator('.tm-applicant')).toContainText('Not approved');
  await expect(page.getByRole('radio', { name: /(?:Store|Organized play location)/ })).toBeChecked();
  await expect(page.getByLabel('League ID or pokemon.com league page')).toBeVisible();
});

// ---------- /host: only Organizers start events ----------

const SUMMARY = {
  code: 'OWNED1',
  name: 'Thursday Locals',
  startDate: '09/24/2026',
  mode: 'swiss',
  players: 12,
  rounds: 4,
  finished: true,
  role: 'owner',
  updatedAt: 0
};

/** /host for an account, its events listed, and an event start refused as the functions refuse it. */
async function mockHost(page: Page, user: typeof ME, state: ApplicationState = NONE) {
  const asks: Asked[] = [];
  let current = user;
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    asks.push({ method: request.method(), path: pathname, body: null });
    if (pathname === '/api/me') {
      return route.fulfill({ json: { user: current, providers: ['google', 'discord'] } });
    }
    if (pathname === '/api/applications/mine') {
      return route.fulfill({ json: state });
    }
    if (pathname === '/api/tournaments' && request.method() === 'POST') {
      current = { ...current, role: 'revoked' };
      return route.fulfill({ status: 403, json: { error: 'Only organizers can start events', apply: true } });
    }
    return route.fulfill({ json: { tournaments: [SUMMARY] } });
  });
  return asks;
}

test('/host: an account that is not an Organizer starts no event, applies instead, and keeps its events @mobile', async ({
  page
}) => {
  await mockHost(page, ME);
  await page.goto('/host');
  await expect(page.getByRole('link', { name: 'Apply to run events' })).toHaveAttribute('href', '/apply');
  await expect(page.getByRole('button', { name: 'Start an event' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Link .tdf file' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Thursday Locals' })).toHaveAttribute('href', '/host/OWNED1');
});

test('/host: on a phone, an event row keeps its links on screen without scrolling sideways @mobile', async ({
  page
}) => {
  await mockHost(page, { ...ME, role: 'community' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/host');
  const row = page.locator('.tm-host-table tbody tr').first();
  for (const name of ['Results', 'Public page']) {
    const box = await row.getByRole('link', { name }).boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  }
  const wrap = page.locator('.tm-host-section .table-wrap').first();
  expect(await wrap.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
  await expect(row.locator('.tm-host-players')).toHaveAttribute('data-unit', 'players');
});

test('/host: a pending Application shows in place of the way to apply', async ({ page }) => {
  await mockHost(page, ME, { ...NONE, application: application('pending') });
  await page.goto('/host');
  await expect(page.locator('.tm-applicant-line')).toHaveText('Application pending');
  await expect(page.getByRole('link', { name: 'Apply to run events' })).toHaveCount(0);
});

test('/host: an Organizer whose access goes while the page is open is refused, and offered the way to apply', async ({
  page
}) => {
  const asks = await mockHost(page, { ...ME, role: 'community' });
  await page.goto('/host');
  await page.getByRole('button', { name: 'Start an event' }).click();
  await page.getByRole('textbox', { name: 'Event name' }).fill('Tuesday League');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page.locator('.tm-error')).toHaveText('Only organizers can start events');
  await expect(page.locator('.tm-applicant-line')).toContainText('Organizer access removed');
  await expect(page.getByRole('button', { name: 'Start an event' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Thursday Locals' })).toBeVisible();
  // The Organizer's page asked for no Application until the account read as one that may apply.
  expect(asks.filter(a => a.path === '/api/applications/mine')).toHaveLength(1);
});

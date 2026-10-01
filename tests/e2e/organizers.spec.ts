/**
 * Becoming an organizer, against mocked functions: the apply page sends an
 * Application with an uploaded proof, an explanation or both, sends an
 * incomplete profile to Settings, and shows where a sent one stands, with
 * Apply again after a rejection.
 */

import { expect, type Page, test } from '@playwright/test';

import type { AccountRole } from '../../shared/accounts/roles';
import type { ApplicationState, MyApplication } from '../../shared/accounts/types';

const ME = {
  id: 'acct-1',
  name: 'Mary',
  avatar: null,
  popId: '7200001' as string | null,
  firstName: 'Mary',
  lastName: 'Jackson',
  birthDate: '02/27/1995',
  role: null as AccountRole | null,
  publicSlug: null as string | null,
  providers: ['google']
};

const NONE: ApplicationState = { application: null, proof: null, eligible: { profile: true, role: true } };

const DAY = Date.UTC(2026, 8, 28, 12);

const application = (status: MyApplication['status'], extra: Partial<MyApplication> = {}): MyApplication => ({
  id: 'app-1',
  status,
  explanation: '',
  proofType: null,
  createdAt: DAY,
  decidedAt: status === 'pending' ? null : DAY + 86_400_000,
  note: null,
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
  /** Holds an upload's answer until it settles. */
  upload?: Promise<void>;
}

/** The applicant endpoints, holding the account's state as the functions would, and every ask they get. */
async function mockApplicant(page: Page, start: ApplicationState, user: typeof ME | null = ME, options: Options = {}) {
  const asks: Asked[] = [];
  let state = start;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const method = request.method();
    const { pathname } = new URL(request.url());
    const key = `${method} ${pathname}`;
    asks.push({ method, path: pathname, body: method === 'POST' ? request.postDataJSON() : null });
    if (key === 'GET /api/me') {
      return route.fulfill({ json: { user, providers: ['google', 'discord'] } });
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
      state = { ...state, application: null };
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  return asks;
}

const posted = (asks: Asked[]) => asks.filter(a => a.method === 'POST').map(a => a.body);

test('the apply page uploads the proof on pick, then sends it with the explanation @mobile', async ({ page }) => {
  const asks = await mockApplicant(page, NONE);
  await page.goto('/apply');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Apply to run events');
  const send = page.getByRole('button', { name: 'Send application' });
  await expect(send).toBeDisabled();
  await page.getByLabel('Proof').setInputFiles({ name: 'certificate.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.tm-apply-file')).toContainText('certificate.png');
  await expect(page.locator('.tm-apply-file')).toContainText('1 KB');
  await expect(send).toBeEnabled();
  // The picker it replaced held the focus, so the focus goes on to Remove, then back to the picker.
  await expect(page.getByRole('button', { name: 'Remove' })).toBeFocused();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.tm-apply-file')).toHaveCount(0);
  await expect(page.getByLabel('Proof')).toBeFocused();
  await expect(send).toBeDisabled();
  await page.getByLabel('Proof').setInputFiles({ name: 'certificate.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await page.getByLabel('Explanation').fill('I run the Thursday league.');
  await expect(page.locator('.tm-apply-count')).toHaveText('26 / 2000');
  await send.click();
  await expect(page.locator('.tm-applicant')).toContainText('Application pending');
  await expect(page.getByRole('button', { name: 'Withdraw' })).toBeVisible();
  await expect(send).toHaveCount(0);
  expect(asks.filter(a => a.path === '/api/applications/proof').map(a => a.method)).toEqual(['PUT', 'DELETE', 'PUT']);
  expect(posted(asks)).toEqual([{ explanation: 'I run the Thursday league.', proof: true }]);
});

test('an explanation alone sends, with no proof', async ({ page }) => {
  const asks = await mockApplicant(page, NONE);
  await page.goto('/apply');
  const send = page.getByRole('button', { name: 'Send application' });
  await page.getByLabel('Explanation').fill('   ');
  await expect(send).toBeDisabled();
  await page.getByLabel('Explanation').fill('No certificate yet; I run a store.');
  await send.click();
  await expect(page.locator('.tm-applicant')).toContainText('Application pending');
  expect(posted(asks)).toEqual([{ explanation: 'No certificate yet; I run a store.', proof: false }]);
  expect(asks.some(a => a.path === '/api/applications/proof')).toBe(false);
});

test('an incomplete profile is sent to Settings, with no form', async ({ page }) => {
  await mockApplicant(page, { ...NONE, eligible: { profile: false, role: true } }, { ...ME, popId: null });
  await page.goto('/apply');
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
  await expect(page.getByRole('button', { name: 'Send application' })).toBeVisible();
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
  await page.getByLabel('Explanation').fill('Certificate is on its way.');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(status).toContainText('Application pending');
  expect(posted(asks)).toEqual([{ explanation: 'Certificate is on its way.', proof: false }]);
});

test('an organizer whose access was removed sees so, and applies again from there', async ({ page }) => {
  await mockApplicant(page, { ...NONE, application: application('approved') }, { ...ME, role: 'revoked' });
  await page.goto('/apply');
  await expect(page.locator('.tm-applicant')).toContainText('Organizer access removed');
  await expect(page.getByRole('button', { name: 'Send application' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply again' }).click();
  await expect(page.getByRole('button', { name: 'Send application' })).toBeVisible();
});

test('an approved account sees it is an organizer, with the way to its events', async ({ page }) => {
  await mockApplicant(page, { ...NONE, application: application('approved') }, { ...ME, role: 'organizer' });
  await page.goto('/apply');
  await expect(page.locator('.tm-applicant')).toContainText('Organizer');
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
  await page
    .getByLabel('Proof')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('text') });
  await expect(page.getByRole('alert')).toHaveText('Use a PNG, JPEG, WebP or PDF');
  await expect(page.getByRole('button', { name: 'Send application' })).toBeDisabled();
  const big = Buffer.alloc(8 * 1024 * 1024 + 1);
  await page.getByLabel('Proof').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: big });
  await expect(page.getByRole('alert')).toHaveText('Up to 8 MB');
  expect(asks.filter(a => a.method === 'PUT')).toHaveLength(1);
});

test('Send application waits for an upload in flight', async ({ page }) => {
  let land = () => undefined as void;
  const upload = new Promise<void>(resolve => {
    land = resolve;
  });
  await mockApplicant(page, NONE, ME, { upload });
  await page.goto('/apply');
  const send = page.getByRole('button', { name: 'Send application' });
  await page.getByLabel('Explanation').fill('I run a league.');
  await expect(send).toBeEnabled();
  await page.getByLabel('Proof').setInputFiles({ name: 'certificate.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('status')).toHaveText('Uploading certificate.png');
  await expect(send).toBeDisabled();
  land();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await expect(send).toBeEnabled();
  // The explanation being written keeps the focus when the upload lands.
  await expect(page.getByLabel('Explanation')).toBeFocused();
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
      { ...ME, role: 'organizer' },
      'Organizer',
      'Your events',
      '/host'
    ],
    [
      { ...NONE, application: application('approved') },
      { ...ME, role: 'revoked' },
      'Organizer access removed',
      'Apply again',
      '/apply?again=1'
    ],
    [NONE, { ...ME, role: 'admin' }, 'Admin', 'Admin page', '/admin']
  ];
  for (const [state, user, words, step, href] of stages) {
    await page.unrouteAll();
    const asks = await mockApplicant(page, state, user);
    await page.goto('/settings');
    const status = page.locator('.tm-applicant');
    await expect(status.getByRole('link', { name: step, exact: true })).toHaveAttribute('href', href);
    if (words) {
      await expect(status).toContainText(words);
    }
    // Your events is offered once: under Organizer for an account that runs events, by the name otherwise.
    await expect(page.getByRole('link', { name: 'Your events' })).toHaveCount(1);
    const asked = asks.some(a => a.path === '/api/applications/mine');
    expect(asked, `${user.role ?? 'player'} asks for its Application`).toBe(
      user.role === null || user.role === 'revoked'
    );
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

test('Apply again on Settings opens the apply page at its form', async ({ page }) => {
  await mockApplicant(page, { ...NONE, application: application('rejected') });
  await page.goto('/settings');
  await page.locator('.tm-applicant').getByRole('link', { name: 'Apply again' }).click();
  await expect(page).toHaveURL(/\/apply\?again=1$/);
  await expect(page.locator('.tm-applicant')).toContainText('Not approved');
  await expect(page.getByRole('button', { name: 'Send application' })).toBeVisible();
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

test('/host: a pending Application shows in place of the way to apply', async ({ page }) => {
  await mockHost(page, ME, { ...NONE, application: application('pending') });
  await page.goto('/host');
  await expect(page.locator('.tm-applicant-line')).toHaveText('Application pending');
  await expect(page.getByRole('link', { name: 'Apply to run events' })).toHaveCount(0);
});

test('/host: an Organizer whose access goes while the page is open is refused, and offered the way to apply', async ({
  page
}) => {
  const asks = await mockHost(page, { ...ME, role: 'organizer' });
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

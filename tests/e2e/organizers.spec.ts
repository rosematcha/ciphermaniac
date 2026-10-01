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

/** The applicant endpoints, holding the account's state as the functions would, and every ask they get. */
async function mockApplicant(page: Page, start: ApplicationState, user: typeof ME | null = ME) {
  const asks: Asked[] = [];
  let state = start;
  await page.route('**/api/**', route => {
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
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.tm-apply-file')).toHaveCount(0);
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

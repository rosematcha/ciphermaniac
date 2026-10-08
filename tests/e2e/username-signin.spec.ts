/**
 * Username and password sign-in on the page (src/lib/tournament/clerk.ts,
 * SignIn.tsx), against a stand-in for Clerk's script: the form sits beside the
 * provider buttons only when the server offers it, posts Clerk's token to
 * /api/auth/clerk as a form and leaves no Clerk session behind, makes an
 * account from the same form, and says what went wrong when Clerk refuses.
 */

import { expect, type Page, test } from '@playwright/test';

const KEY = `pk_test_${Buffer.from('clerk.cm.test$').toString('base64')}`;
const SCRIPT = 'https://clerk.cm.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js';

/**
 * Clerk's browser SDK as far as the form uses it. `window.clerkFake.error`
 * makes the next attempt fail with that code; every attempt and removed
 * session is counted on `window.clerkFake`.
 */
const FAKE_CLERK = `
window.clerkFake = Object.assign({ attempts: [], removed: 0, error: null }, window.clerkFake);
function attempt(mode, params) {
  window.clerkFake.attempts.push({ mode, ...params });
  // Kept where the form post can't wipe it: whether Clerk's bot check had somewhere to draw.
  sessionStorage.setItem('captcha-' + mode, String(document.querySelectorAll('#clerk-captcha').length));
  const error = window.clerkFake.error;
  if (error) throw { errors: [error] };
  return { status: 'complete', createdSessionId: 'sess_' + window.clerkFake.attempts.length };
}
window.Clerk = {
  session: null,
  load: async () => {},
  client: {
    signIn: { create: async params => attempt('in', params) },
    signUp: { create: async params => attempt('up', params) }
  },
  setActive: async ({ session }) => {
    window.Clerk.session = {
      getToken: async () => 'token-' + session,
      remove: async () => { window.clerkFake.removed += 1; window.Clerk.session = null; }
    };
  }
};`;

interface Posted {
  token: string | null;
  next: string | null;
  link: string | null;
}

async function mockSite(page: Page, providers: string[], clerkKey: string | null = KEY) {
  const posted: Posted[] = [];
  await page.route(SCRIPT, route => route.fulfill({ contentType: 'text/javascript', body: FAKE_CLERK }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/clerk') {
      const form = new URLSearchParams(route.request().postData() ?? '');
      posted.push({ token: form.get('token'), next: form.get('next'), link: form.get('link') });
      return route.fulfill({ contentType: 'text/html', body: '<p>posted</p>' });
    }
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers, clerkKey } });
    }
    return route.fulfill({ json: {} });
  });
  return posted;
}

const form = (page: Page) => page.locator('.tm-signin-form');

async function fill(page: Page, username: string, password: string) {
  await form(page).getByLabel('Username').fill(username);
  await form(page).getByLabel('Password').fill(password);
}

test('the form sits beside the provider buttons only when the server offers it', async ({ page }) => {
  await mockSite(page, ['google', 'discord', 'clerk']);
  await page.goto('/settings');
  await expect(form(page)).toBeVisible();
  const buttons = await page.locator('.tm-signin').boundingBox();
  const fields = await form(page).boundingBox();
  expect(fields!.x).toBeGreaterThan(buttons!.x + buttons!.width - 1);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await mockSite(page, ['google', 'discord']);
  await page.goto('/settings');
  await expect(page.locator('.tm-sso-google')).toBeVisible();
  await expect(form(page)).toHaveCount(0);
});

test('without the publishable key there is no form, even when the server lists it', async ({ page }) => {
  await mockSite(page, ['google', 'clerk'], null);
  await page.goto('/settings');
  await expect(page.locator('.tm-sso-google')).toBeVisible();
  await expect(form(page)).toHaveCount(0);
});

test('signing in posts Clerk’s token here and leaves no Clerk session behind', async ({ page }) => {
  const posted = await mockSite(page, ['google', 'clerk']);
  await page.goto('/settings');
  await fill(page, '  pat_plays ', 'correct horse battery staple');
  await form(page).getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('posted')).toBeVisible();
  expect(posted).toEqual([{ token: 'token-sess_1', next: '/settings', link: null }]);
});

test('Clerk is asked with the trimmed username, and its session is removed once the token is taken', async ({
  page
}) => {
  await mockSite(page, ['clerk']);
  // The page stays put, so what the fake counted can be read back.
  await page.addInitScript(() => {
    HTMLFormElement.prototype.submit = function submit() {
      (window as any).submitted = Object.fromEntries(new FormData(this));
    };
  });
  await page.goto('/settings');
  await fill(page, '  pat_plays ', 'correct horse battery staple');
  await form(page).getByRole('button', { name: 'Sign in' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).clerkFake?.removed)).toBe(1);
  const attempts = await page.evaluate(() => (window as any).clerkFake.attempts);
  expect(attempts).toEqual([{ mode: 'in', identifier: 'pat_plays', password: 'correct horse battery staple' }]);
  expect(await page.evaluate(() => (window as any).submitted)).toEqual({ token: 'token-sess_1', next: '/settings' });
});

test('the same form makes an account: a new password, the length it needs, and one place for Clerk’s bot check while it is made', async ({
  page
}) => {
  const posted = await mockSite(page, ['google', 'clerk']);
  await page.goto('/settings');
  await form(page).getByRole('button', { name: 'Create an account' }).click();
  const password = form(page).getByLabel('Password');
  await expect(password).toHaveAttribute('autocomplete', 'new-password');
  await expect(password).toHaveAttribute('minlength', '15');
  await expect(password).toHaveAccessibleDescription('At least 15 characters');
  await expect(page.locator('#clerk-captcha')).toHaveCount(0);
  await fill(page, 'new_player', 'a long enough passphrase');
  await form(page).getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('posted')).toBeVisible();
  expect(posted).toEqual([{ token: 'token-sess_1', next: '/settings', link: null }]);
  expect(await page.evaluate(() => sessionStorage.getItem('captcha-up'))).toBe('1');

  await page.goto('/settings');
  await form(page).getByRole('button', { name: 'Create an account' }).click();
  await form(page).getByRole('button', { name: 'I have an account' }).click();
  await expect(form(page).getByLabel('Password')).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.locator('#clerk-captcha')).toHaveCount(0);
});

test('when Clerk refuses, the form says why, marks the fields, and can be sent again', async ({ page }) => {
  const posted = await mockSite(page, ['google', 'clerk']);
  await page.addInitScript(() => {
    (window as any).clerkFake = { error: { code: 'form_password_incorrect' } };
  });
  await page.goto('/settings');
  await fill(page, 'pat_plays', 'not the password at all');
  const submit = form(page).getByRole('button', { name: 'Sign in' });
  await submit.click();
  await expect(form(page).getByRole('alert')).toHaveText('Wrong username or password.');
  await expect(form(page).getByLabel('Username')).toHaveAttribute('aria-invalid', 'true');
  await expect(submit).toBeEnabled();

  await page.evaluate(() => {
    (window as any).clerkFake.error = { code: 'something_new', longMessage: 'Clerk’s own words.' };
  });
  await submit.click();
  await expect(form(page).getByRole('alert')).toHaveText('Clerk’s own words.');

  await page.evaluate(() => {
    (window as any).clerkFake.error = null;
  });
  await form(page).getByRole('button', { name: 'Create an account' }).click();
  await expect(form(page).getByRole('alert')).toHaveCount(0);
  expect(posted).toEqual([]);
});

test('on a phone the form goes under the provider buttons', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockSite(page, ['google', 'discord', 'clerk']);
  await page.goto('/settings');
  const buttons = await page.locator('.tm-signin').boundingBox();
  const fields = await form(page).boundingBox();
  expect(fields!.y).toBeGreaterThanOrEqual(buttons!.y + buttons!.height - 1);
  expect(Math.abs(fields!.width - buttons!.width)).toBeLessThan(40);
});

test('while a sign-in is under way the form can’t switch to making an account', async ({ page }) => {
  await mockSite(page, ['google', 'clerk']);
  // Clerk never answers, so the form stays busy.
  await page.route(SCRIPT, route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `${FAKE_CLERK}; window.Clerk.client.signIn.create = () => new Promise(() => {});`
    })
  );
  await page.goto('/settings');
  await fill(page, 'pat_plays', 'correct horse battery staple');
  await form(page).getByRole('button', { name: 'Sign in' }).click();
  await expect(form(page).getByRole('button', { name: 'Sign in' })).toBeDisabled();
  await expect(form(page).getByRole('button', { name: 'Create an account' })).toBeDisabled();
});

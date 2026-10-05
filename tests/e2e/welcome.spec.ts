/**
 * The age check a new sign-up waits on, against a mocked function: an adult
 * goes on to where sign-in started, a minor is told accounts are for adults
 * with no form left to try again, and a wait that ran out offers sign-in.
 */

import { expect, type Page, test } from '@playwright/test';

/** Answers the age check with `status` and `body`, and records the birth date each ask sent. */
async function mockAgeCheck(page: Page, status: number, body: unknown): Promise<string[]> {
  const sent: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === '/api/auth/age' && request.method() === 'POST') {
      sent.push((request.postDataJSON() as { birthDate: string }).birthDate);
      await route.fulfill({ status, json: body });
    } else if (pathname === '/api/me') {
      await route.fulfill({ json: { user: null, providers: ['google'] } });
    } else {
      await route.fulfill({ status: 404, json: { error: 'Not mocked' } });
    }
  });
  return sent;
}

test('an adult’s birth date goes on to where sign-in started', async ({ page }) => {
  const sent = await mockAgeCheck(page, 200, { next: '/history' });
  await page.goto('/welcome');
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expect(continueButton).toBeDisabled();
  await page.getByLabel('Birth date').fill('1990-06-15');
  await continueButton.click();
  await expect(page).toHaveURL(/\/history$/);
  expect(sent).toEqual(['1990-06-15']);
});

test('a minor is told accounts are for adults, with nothing left to try again', async ({ page }) => {
  await mockAgeCheck(page, 403, { error: 'Ciphermaniac accounts are for people 18 and older.', minor: true });
  await page.goto('/welcome');
  await page.getByLabel('Birth date').fill('2015-01-01');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Ciphermaniac accounts are for people 18 and older.')).toBeVisible();
  await expect(page.getByLabel('Birth date')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
});

test('a wait that ran out offers sign-in again', async ({ page }) => {
  await mockAgeCheck(page, 410, { error: 'Sign in again to continue' });
  await page.goto('/welcome');
  await page.getByLabel('Birth date').fill('1990-06-15');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Sign in again to continue')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/settings');
});

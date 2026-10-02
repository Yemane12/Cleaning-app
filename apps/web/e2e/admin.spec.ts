import { expect, test, type Page } from '@playwright/test';
import { FakeBackend } from './fake-backend';

/** Fails the test on anything the browser reports as an error. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('an admin checks a cleaner’s documents and approves them', async ({ page, context }) => {
  const backend = new FakeBackend().asAdmin();
  await backend.install(context, { signedIn: true });
  const errors = watchErrors(page);

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Identity checks' })).toBeVisible();
  await page.getByRole('link', { name: /Hirut Bekele/ }).click();

  await expect(page.getByRole('heading', { name: 'Hirut Bekele' })).toBeVisible();
  await expect(page.getByText('hirut@example.com · 0912345678')).toBeVisible();

  // Photos are shown from short-lived signed links, and really load.
  for (const title of ['ID, front', 'ID, back', 'Selfie']) {
    const image = page.getByRole('img', { name: title });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0);
  }
  // A PDF is offered as a download rather than drawn.
  const address = page.getByRole('listitem').filter({ hasText: 'Proof of address' });
  await expect(address.getByRole('button', { name: 'Download file' })).toBeVisible();
  expect(backend.readLinks.sort()).toEqual(['d-back', 'd-front', 'd-selfie']);

  // One document marked as checked, then the cleaner approved.
  const front = page.getByRole('listitem').filter({ hasText: 'ID, front' });
  await front.getByRole('button', { name: 'Looks right' }).click();
  await expect(front).toContainText('Looks right');
  expect(backend.documentReviews).toEqual([{ id: 'd-front', approved: true }]);

  await page.getByRole('button', { name: 'Approve cleaner' }).click();
  await expect(page).toHaveURL(/\/admin\?done=approved/);
  await expect(page.getByText('Hirut Bekele is approved.')).toBeVisible();
  await expect(page.getByText('No one is waiting for an identity check.')).toBeVisible();
  expect(backend.decision).toEqual({ approved: true });
  expect(errors).toEqual([]);
});

test('an admin rejects a blurry selfie and sends the check back, saying why', async ({
  page,
  context,
}) => {
  const backend = new FakeBackend().asAdmin();
  await backend.install(context, { signedIn: true });

  await page.goto('/admin/reviews/u2');
  const selfie = page.getByRole('listitem').filter({ hasText: 'Selfie' });
  await selfie.getByRole('button', { name: 'Reject' }).click();
  await selfie.getByLabel('Reason (the cleaner sees this)').fill('Blurry');
  await selfie.getByRole('button', { name: 'Reject document' }).click();
  // The cleaner is told why, so a reason must say something.
  await expect(selfie.getByText('Please write at least 10 characters.')).toBeVisible();
  await selfie
    .getByLabel('Reason (the cleaner sees this)')
    .fill('The photo is blurry: please take it again in good light.');
  await selfie.getByRole('button', { name: 'Reject document' }).click();
  await expect(selfie).toContainText('Rejected');
  await expect(selfie).toContainText('The photo is blurry');

  // With a document rejected, approving is off; the check goes back instead.
  await expect(page.getByRole('button', { name: 'Approve cleaner' })).toBeDisabled();
  await expect(page.getByText('A document is rejected')).toBeVisible();
  await page.getByRole('button', { name: 'Send back', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Reason (the cleaner sees this)' })
    .last()
    .fill('Please take your selfie again; the rest is fine.');
  await page.getByRole('button', { name: 'Send back to the cleaner' }).click();

  await expect(page).toHaveURL(/\/admin\?done=rejected/);
  await expect(page.getByText('Hirut Bekele was asked to replace their documents.')).toBeVisible();
  expect(backend.documentReviews).toEqual([
    {
      id: 'd-selfie',
      approved: false,
      reason: 'The photo is blurry: please take it again in good light.',
    },
  ]);
  expect(backend.decision).toEqual({
    approved: false,
    reason: 'Please take your selfie again; the rest is fine.',
  });
});

test('signing in takes an admin to the identity checks, and keeps others out', async ({
  page,
  context,
}) => {
  const backend = new FakeBackend().asAdmin();
  await backend.install(context, { signedIn: false });

  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password', { exact: true }).fill('a-long-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('link', { name: 'Identity checks' })).toBeVisible();

  backend.role = 'CUSTOMER';
  await page.goto('/admin');
  await expect(page.getByText('This page is for the team.')).toBeVisible();
});

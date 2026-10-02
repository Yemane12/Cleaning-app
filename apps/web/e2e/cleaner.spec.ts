import { expect, test, type Page } from '@playwright/test';
import { FakeBackend } from './fake-backend';

/** Fails the test on anything the browser reports as an error. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Nothing on the page may be wider than the screen (a phone, in that project). */
async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
}

/** A small JPEG-looking file; storage only counts the bytes. */
const photo = (name: string) => ({
  name,
  mimeType: 'image/jpeg',
  buffer: Buffer.from(`fake photo ${name}`),
});

test('a customer joins as a cleaner and is shown what to set up', async ({ page, context }) => {
  const backend = new FakeBackend();
  await backend.install(context, { signedIn: true });
  const errors = watchErrors(page);

  await page.goto('/');
  await page.getByRole('link', { name: 'Work with us' }).last().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Work with us' })).toBeVisible();

  await page.getByRole('button', { name: 'Join as a cleaner' }).click();
  await expect(page).toHaveURL(/\/cleaner$/);
  expect(backend.role).toBe('CLEANER');

  await expect(page.getByText('Customers cannot book you yet.')).toBeVisible();
  for (const step of ['Your profile', 'Identity check', 'Where we pay you', 'Your hours']) {
    await expect(page.getByRole('link', { name: new RegExp(step) })).toContainText('To do');
  }
  // The header now offers a cleaner's pages, not booking.
  await expect(page.getByRole('link', { name: 'Jobs', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Book a cleaner' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a new cleaner sets up profile, documents, payout and hours', async ({ page, context }) => {
  const backend = new FakeBackend();
  backend.role = 'CLEANER';
  await backend.install(context, { signedIn: true });
  const errors = watchErrors(page);

  // Profile: what customers read.
  await page.goto('/cleaner/profile');
  await page.getByLabel('About you').fill('Ten years cleaning homes in Bole and CMC.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Your profile is saved.')).toBeVisible();
  expect(backend.bio).toBe('Ten years cleaning homes in Bole and CMC.');

  // Documents: each goes straight to storage with its signed link, then is confirmed.
  await page.goto('/cleaner/documents');
  await expect(page.getByText('Upload all four documents')).toBeVisible();
  // A file the API would refuse is stopped here, before anything is sent.
  await page
    .getByRole('listitem')
    .filter({ hasText: 'ID, front' })
    .locator('input[type=file]')
    .setInputFiles({ name: 'id.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
  await expect(page.getByText('Use a photo (JPG, PNG or HEIC) or a PDF.')).toBeVisible();
  expect(backend.documents).toHaveLength(0);

  const documents = [
    ['ID, front', 'id-front.jpg'],
    ['ID, back', 'id-back.jpg'],
    ['Selfie', 'selfie.jpg'],
    ['Proof of address', 'bill.jpg'],
  ];
  for (const [title, file] of documents) {
    const row = page.getByRole('listitem').filter({ hasText: title });
    await row.locator('input[type=file]').setInputFiles(photo(file));
    await expect(page.getByText(`${title}: uploaded.`)).toBeVisible();
    await expect(row).toContainText('Uploaded');
  }
  await expect(page.getByText('We are checking your documents')).toBeVisible();
  // Locked while checked: no more upload buttons.
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  expect(backend.kycStatus).toBe('IN_REVIEW');
  expect(backend.uploads).toHaveLength(4);
  expect(backend.uploads[0]).toEqual({
    path: '/kyc/doc-1',
    contentType: 'image/jpeg',
    size: Buffer.from('fake photo id-front.jpg').length,
  });

  // Payout: a telebirr wallet, by its phone number.
  await page.goto('/cleaner/payout');
  await page.getByLabel('Bank or mobile wallet').selectOption({ label: 'telebirr' });
  await page.getByLabel('Wallet phone number').fill('091234567');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('telebirr numbers are 10 digits long.')).toBeVisible();
  await page.getByLabel('Wallet phone number').fill('0912345678');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. Your next pay goes to telebirr.')).toBeVisible();
  await expect(page.getByText(/account ending 5678/)).toBeVisible();
  expect(backend.payout).toEqual({
    bankCode: 855,
    accountNumber: '0912345678',
    accountName: 'Test Customer',
  });

  // Hours: Monday and Tuesday mornings, then a day off.
  await page.goto('/cleaner/schedule');
  await page.getByLabel('Monday: Working').check();
  await page.getByLabel('Tuesday: Working').check();
  await page.getByLabel('Tuesday Until').selectOption({ label: '12:00' });
  await expect(page.getByText('13 hours a week')).toBeVisible();
  await page.getByRole('button', { name: 'Save hours' }).click();
  await expect(page.getByText('Your hours are saved.')).toBeVisible();
  expect(backend.windows).toEqual([
    { weekday: 1, startMinute: 480, endMinute: 1020 },
    { weekday: 2, startMinute: 480, endMinute: 720 },
  ]);

  await page.getByLabel('First day').fill('2026-12-24');
  await page.getByLabel('Last day').fill('2026-12-26');
  await page.getByLabel(/Reason/).fill('Holiday');
  await page.getByRole('button', { name: 'Add time off' }).click();
  await expect(page.getByText('Time off added.')).toBeVisible();
  await expect(page.getByText(/Thu,? 24 Dec to Sat,? 26 Dec/)).toBeVisible();
  // Whole days in Addis Ababa (UTC+3): from the first day's start to the day after the last.
  expect(backend.timeOff[0]).toMatchObject({
    startsAt: '2026-12-23T21:00:00.000Z',
    endsAt: '2026-12-26T21:00:00.000Z',
    reason: 'Holiday',
  });
  await expectNoSidewaysScroll(page);

  // Back on the dashboard: only the identity check is left, and it is with us.
  await page.goto('/cleaner');
  await expect(page.getByRole('link', { name: /Identity check/ })).toContainText('Being checked');
  for (const step of ['Your profile', 'Where we pay you', 'Your hours']) {
    await expect(page.getByRole('link', { name: new RegExp(step) })).toContainText('Done');
  }
  await expect(page.getByText('Customers cannot book you yet.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a verified cleaner accepts, starts and finishes a job, and is paid', async ({
  page,
  context,
}) => {
  const backend = new FakeBackend().readyCleaner();
  await backend.install(context, { signedIn: true });
  const errors = watchErrors(page);

  await page.goto('/cleaner');
  await expect(page.getByText('Customers can find and book you.')).toBeVisible();
  await page.getByRole('link', { name: 'New requests: 1' }).click();

  const job = page.getByRole('link', { name: /Standard clean/ });
  await expect(job).toContainText('New request');
  await expect(job).toContainText('for Abebe Kebede');
  await expect(job).toContainText('You earn ETB 850.00');
  await job.click();

  await expect(page.getByText('Bole Road, House 12, Addis Ababa')).toBeVisible();
  await expect(page.getByText('The key is with the guard')).toBeVisible();
  await expect(page.getByText('You are paid ETB 850.00 when the job is done.')).toBeVisible();

  await page.getByRole('button', { name: 'Accept job' }).click();
  await expect(page.getByText('Accepted. The customer can see that you are coming.')).toBeVisible();
  await page.getByRole('button', { name: 'Start job' }).click();
  await expect(page.getByText('Job started.')).toBeVisible();
  await page.getByRole('button', { name: 'Mark as done' }).click();
  await expect(page.getByText('Done! Your pay is on its way.')).toBeVisible();
  await expect(page.getByText('Your pay of ETB 850.00 is on its way.')).toBeVisible();
  expect(backend.jobStatus).toBe('COMPLETED');
  await expectNoSidewaysScroll(page);
  expect(errors).toEqual([]);
});

test('a cleaner declines a request, saying why', async ({ page, context }) => {
  const backend = new FakeBackend().readyCleaner();
  await backend.install(context, { signedIn: true });

  await page.goto('/cleaner/jobs/j1');
  await page.getByRole('button', { name: 'Decline' }).click();
  await expect(page.getByText('The customer gets their money back in full.')).toBeVisible();
  await page.getByLabel(/Reason/).fill('I am away that day');
  await page.getByRole('button', { name: 'Yes, decline' }).click();

  await expect(page.getByText('Declined. The customer is refunded.')).toBeVisible();
  await expect(page.getByText('Nothing to pay for this job.')).toBeVisible();
  expect(backend.jobStatus).toBe('DECLINED');
  expect(backend.endReason).toBe('I am away that day');
});

test('signing in takes a cleaner to their dashboard', async ({ page, context }) => {
  const backend = new FakeBackend().readyCleaner();
  await backend.install(context, { signedIn: false });

  await page.goto('/login');
  await page.getByLabel('Email').fill('hirut@example.com');
  await page.getByLabel('Password', { exact: true }).fill('a-long-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/cleaner$/);
  await expect(page.getByRole('heading', { name: 'Hello, Hirut Bekele' })).toBeVisible();
});

test('each side is pointed to its own pages', async ({ page, context }) => {
  const backend = new FakeBackend().readyCleaner();
  await backend.install(context, { signedIn: true });

  await page.goto('/book');
  await expect(page.getByText('This page is for customers.')).toBeVisible();
  await page.getByRole('link', { name: 'Go to your dashboard' }).click();
  await expect(page).toHaveURL(/\/cleaner$/);

  backend.role = 'CUSTOMER';
  await page.goto('/cleaner/jobs');
  await expect(page.getByText('This page is for cleaners.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Work with us' })).toBeVisible();
});

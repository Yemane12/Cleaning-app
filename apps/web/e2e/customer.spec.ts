import { expect, test, type Page } from '@playwright/test';
import { FakeBackend } from './fake-backend';

/** Fails the test on anything the browser reports as an error, bar what `expected` matches. */
function watchErrors(page: Page, expected?: RegExp) {
  const errors: string[] = [];
  page.on(
    'console',
    (message) =>
      message.type() === 'error' && !expected?.test(message.text()) && errors.push(message.text()),
  );
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('a visitor sees the offer and must sign in to book', async ({ page, context }) => {
  await new FakeBackend().install(context, { signedIn: false });
  const errors = watchErrors(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/A clean home/);

  await page.goto('/book');
  await expect(page).toHaveURL(/\/login\?next=%2Fbook$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('an expired link and an unconfirmed email say so, and a new link can be sent', async ({
  page,
  context,
}) => {
  const backend = new FakeBackend();
  backend.emailConfirmed = false;
  await backend.install(context, { signedIn: false });
  // Chrome logs Supabase's deliberate 400 as a failed resource load.
  const errors = watchErrors(page, /status of 400/);

  // Where Supabase sends a confirmation link opened after it expired.
  await page.goto(
    '/login#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
  );
  await expect(page.getByText(/That link has expired or was already used/)).toBeVisible();

  await page.getByLabel('Email').fill('new@example.com');
  await page.getByLabel('Password', { exact: true }).fill('a-long-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/Your email address is not confirmed yet/)).toBeVisible();
  await expect(page.getByText('Email or password is not right.')).toHaveCount(0);

  await page.getByRole('button', { name: 'Send a new link' }).click();
  await expect(page.getByText('We sent a new link to new@example.com.')).toBeVisible();
  expect(backend.resent).toMatchObject({
    type: 'signup',
    email: 'new@example.com',
    redirectTo: expect.stringMatching(/\/login$/),
  });
  expect(errors).toEqual([]);
});

test('a password can be shown while typing it', async ({ page, context }) => {
  await new FakeBackend().install(context, { signedIn: false });
  const errors = watchErrors(page);

  await page.goto('/signup');
  const password = page.getByLabel('Password', { exact: true });
  const show = page.getByRole('button', { name: 'Show password' });
  await password.fill('a-long-password');
  await expect(password).toHaveAttribute('type', 'password');

  await show.click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('a-long-password');
  await expect(show).toHaveAttribute('aria-pressed', 'true');

  await show.click();
  await expect(password).toHaveAttribute('type', 'password');
  expect(errors).toEqual([]);
});

test('a customer books, pays with Chapa, and cancels for a full refund', async ({
  page,
  context,
}) => {
  const backend = new FakeBackend();
  await backend.install(context, { signedIn: true });
  const errors = watchErrors(page);

  await page.goto('/book');
  await page.getByRole('button', { name: /Standard clean/ }).click();
  await expect(page.getByText('Price: ETB 1,000.00')).toBeVisible();

  await page.getByRole('button', { name: '2 h 30 min' }).click();
  await expect(page.getByText('Price: ETB 1,150.00')).toBeVisible();

  await page.getByRole('button', { name: /Hirut Bekele/ }).click();
  // Times are on the 12-hour clock.
  await page.getByRole('button', { name: /^6:00\sam$/ }).click();

  const review = page.locator('section', { hasText: 'Check and pay' });
  await expect(review).toContainText('Standard clean with Hirut Bekele');
  await expect(review).toContainText('ETB 1,150.00');

  await page.getByLabel(/Anything the cleaner should know/).fill('Please bring a mop');
  await page.getByRole('button', { name: 'Pay ETB 1,150.00 with Chapa' }).click();

  await expect(page).toHaveURL('http://checkout.test/pay/b1');
  expect(backend.created).toMatchObject({
    serviceId: 's1',
    cleanerId: 'c1',
    addressId: 'a1',
    durationMinutes: 150,
    customerNotes: 'Please bring a mop',
  });
  // 6:00 am in Addis Ababa is 03:00 UTC.
  expect(backend.created?.scheduledStart).toMatch(/T03:00:00\.000Z$/);

  // Back from Chapa: the return page checks the payment.
  await page.goto('/payment/return?booking=b1');
  await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible();

  await page.goto('/bookings');
  await expect(page.getByText('Waiting for the cleaner')).toBeVisible();
  await expect(page.getByText(/with Hirut Bekele/)).toBeVisible();

  await page.goto('/bookings/b1');
  await page.getByRole('button', { name: 'Cancel booking' }).click();
  await expect(page.getByText('Cancelling now is free')).toBeVisible();
  await page.getByRole('button', { name: 'Yes, cancel' }).click();

  await expect(page.getByText('The booking is cancelled.')).toBeVisible();
  await expect(page.getByText('Cancelled by you')).toBeVisible();
  await expect(page.getByText('Refunded ETB 1,150.00')).toBeVisible();

  // Nothing on the page may be wider than the screen (a phone, in that project).
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

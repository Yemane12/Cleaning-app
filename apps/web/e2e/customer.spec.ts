import { expect, test, type Page } from '@playwright/test';
import { FakeBackend } from './fake-backend';

/** Fails the test on anything the browser reports as an error. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
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
  await page.getByRole('button', { name: '06:00' }).click();

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
  // 06:00 in Addis Ababa is 03:00 UTC.
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

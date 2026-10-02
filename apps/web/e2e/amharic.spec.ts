import { expect, test, type Page } from '@playwright/test';
import { FakeBackend } from './fake-backend';

// A phone set to Amharic.
test.use({ locale: 'am-ET' });

/** Fails the test on anything the browser reports as an error. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('a phone set to Amharic gets Amharic, and English stays chosen once picked', async ({
  page,
  context,
}) => {
  await new FakeBackend().install(context, { signedIn: false });
  const errors = watchErrors(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'ንጹሕ ቤት፣ በጥቂት ደቂቃዎች' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'am');
  await expect(page.getByRole('link', { name: 'ይግቡ' })).toBeVisible();

  // English is offered in its own words.
  await page.getByRole('button', { name: /English/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'A clean home, booked in minutes' }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'A clean home, booked in minutes' }),
  ).toBeVisible();

  await page.getByRole('button', { name: /አማርኛ/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ንጹሕ ቤት፣ በጥቂት ደቂቃዎች' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a cleaner reads jobs on the Ethiopian calendar, the phone clock and in birr', async ({
  page,
  context,
}) => {
  const backend = new FakeBackend().readyCleaner();
  await backend.install(context, { signedIn: true });
  const errors = watchErrors(page);

  await page.goto('/cleaner/jobs');
  await expect(page.getByRole('heading', { level: 1, name: 'ሥራዎች' })).toBeVisible();

  // 10 October 2026, 9:00 in Addis Ababa, is Saturday 30 Meskerem 2019, 9:00 in the morning.
  const job = page.getByRole('link', { name: /Standard clean/ });
  await expect(job).toContainText('አዲስ ጥያቄ');
  await expect(job).toContainText(/ቅዳሜ[፣,] መስከረም 30[፣,]? 9:00 ጥዋት/u);
  await expect(job).toContainText('2 ሰዓት 30 ደቂቃ');
  await expect(job).toContainText(/የሚያገኙት ብር\s850\.00/u);

  await job.click();
  await page.getByRole('button', { name: 'ሥራውን ይቀበሉ' }).click();
  await expect(page.getByText('ተቀብለዋል። ደንበኛው እንደሚመጡ ማየት ይችላል።')).toBeVisible();
  expect(backend.jobStatus).toBe('ACCEPTED');
  expect(errors).toEqual([]);
});

test('time off picked on a Gregorian date picker is read back on the Ethiopian calendar', async ({
  page,
  context,
}) => {
  const backend = new FakeBackend().readyCleaner();
  await backend.install(context, { signedIn: true });
  const errors = watchErrors(page);

  await page.goto('/cleaner/schedule');
  // 11 and 12 September 2027: the last day of 2019 (the 13th month's sixth) and New Year's Day.
  await page.getByLabel('የመጀመሪያ ቀን').fill('2027-09-11');
  await page.getByLabel('የመጨረሻ ቀን').fill('2027-09-12');
  await expect(page.getByText(/^ቅዳሜ[፣,] ጳጉሜን 6$/u)).toBeVisible();
  await expect(page.getByText(/^እሑድ[፣,] መስከረም 1$/u)).toBeVisible();

  await page.getByRole('button', { name: 'ዕረፍት ያክሉ' }).click();
  await expect(page.getByText('ዕረፍቱ ተጨምሯል።')).toBeVisible();
  await expect(page.getByText(/ቅዳሜ[፣,] ጳጉሜን 6 እስከ እሑድ[፣,] መስከረም 1/u)).toBeVisible();
  expect(errors).toEqual([]);
});

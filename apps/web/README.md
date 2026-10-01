# Web app

The customer-facing web app: sign up, book a verified cleaner, pay with Chapa
(telebirr, CBE Birr, M-Pesa or card), and see or cancel bookings. Next.js (App
Router), React, Tailwind CSS. It talks to the API in `apps/api` with the
customer's Supabase access token; Supabase handles sign-up and sign-in.

## Running it

```bash
cd apps/web
npm install
cp .env.example .env.local   # the API's URL and your Supabase project's public values
npm run dev                  # http://localhost:3000
```

The API must allow this origin in its `CORS_ORIGINS` (e.g. `http://localhost:3000`
while developing), and its `PAYMENT_RETURN_URL` should be this app's
`/payment/return` page so customers come back here after paying.

## Checks

```bash
npm run lint
npm run format:check
npm run typecheck   # generates Next's route types first
npm test            # unit tests (Vitest): times, money, the API client, translations
npm run build
npm run e2e         # the built app in a browser, against a faked API, Supabase and Chapa
```

CI runs all of these. `npm run e2e` needs Chromium (`npx playwright install chromium`);
to use a browser already on the machine, set `PLAYWRIGHT_CHROMIUM_PATH`.

## Layout

| Path               | What                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `src/app/`         | Pages: home, sign-in/up, `book`, `payment/return`, `bookings`, `bookings/[id]`, `account` |
| `src/lib/api.ts`   | Every API call, typed (`src/lib/types.ts`)                                                |
| `src/lib/auth.tsx` | Sign-in state; loads the API profile after each sign-in                                   |
| `src/lib/time.ts`  | Dates and times in the cleaner's zone (Addis Ababa)                                       |
| `src/i18n/`        | All text, and the language switch                                                         |
| `e2e/`             | Browser tests and the fake backend they run against                                       |

## Languages

Every piece of text is in `src/i18n/messages/en.ts`. To add Amharic:

1. Create `src/i18n/messages/am.ts` exporting `am: Messages` with the same keys
   — the typecheck fails on any missing or misspelt one.
2. Register it in `src/i18n/locales.ts`:
   `am: { messages: am, label: 'አማርኛ', intl: 'am-ET' }`.

The page font already includes Ge'ez script, for Amharic text and names.

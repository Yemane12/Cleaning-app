# Web app

One web app for both sides of the marketplace. Next.js (App Router), React,
Tailwind CSS. It talks to the API in `apps/api` with the user's Supabase access
token; Supabase handles sign-up and sign-in, and the API's role decides which
side someone sees.

- **Customers** sign up, book a verified cleaner, pay with Chapa (telebirr,
  CBE Birr, M-Pesa or card), and see or cancel bookings.
- **The team** (admins) check cleaners' identity documents at `/admin`: view
  each photo, mark it right or reject it with a reason the cleaner sees, then
  approve the cleaner or send the check back.
- **Cleaners** join from `/work` (a customer account becomes a cleaner one),
  then from their dashboard at `/cleaner`: add a profile, upload identity
  documents, add a payout account (mobile wallet or bank), set weekly hours and
  time off, and accept, start, finish, decline or cancel jobs.

Identity documents go from the browser straight to private storage with a
short-lived signed link from the API (`src/lib/documents.ts`); they never pass
through the API. The storage must accept cross-origin `PUT`s from this app's
origin. Supabase Storage's S3 endpoint does when addressed path-style, as the
API is configured to.

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
npm test            # unit tests (Vitest): times, money, schedules, documents, the API client…
npm run build
npm run e2e         # the built app in a browser, against a faked API, Supabase and Chapa
```

CI runs all of these. `npm run e2e` needs Chromium (`npx playwright install chromium`);
to use a browser already on the machine, set `PLAYWRIGHT_CHROMIUM_PATH`.

## Layout

| Path                   | What                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `src/app/`             | Customer pages: home, sign-in/up, `book`, `payment/return`, `bookings`, `account`   |
| `src/app/work/`        | Joining as a cleaner                                                                |
| `src/app/cleaner/`     | Cleaner pages: dashboard, `profile`, `documents`, `payout`, `schedule`, `jobs`      |
| `src/app/admin/`       | The team's pages: the identity-check queue and each review                          |
| `src/lib/api.ts`       | Every API call, typed (`src/lib/types.ts`)                                          |
| `src/lib/auth.tsx`     | Sign-in state; loads the API profile after each sign-in                             |
| `src/lib/time.ts`      | Dates and times in the cleaner's zone (Addis Ababa)                                 |
| `src/lib/schedule.ts`  | Weekly hours and whole-day time off                                                 |
| `src/lib/documents.ts` | Checking and uploading identity documents                                           |
| `src/i18n/`            | All text, and the language switch                                                   |
| `e2e/`                 | Browser tests and the fake backend (API, Supabase, Chapa, storage) they run against |

## Languages

The app speaks English (`src/i18n/messages/en.ts`) and Amharic
(`src/i18n/messages/am.ts`). It starts in the phone's or browser's language
when that is Amharic, else English; the switch in the header changes it, and
the choice is remembered on that device.

- **Dates.** Amharic shows dates on the Ethiopian calendar, e.g. "እሑድ፣ መስከረም
  24" for Sunday 4 October 2026. Date pickers are the browser's and stay
  Gregorian, so the chosen day is shown underneath on the Ethiopian calendar.
- **Times.** Both languages use the 12-hour clock phones show: "8:30 am",
  "8:30 ጥዋት". Neither counts hours from dawn.
- **Money.** "ETB 1,150.00" in English, "ብር 1,150.00" in Amharic.

Service names, addresses and other text people type are shown as entered.

To change wording, edit the messages files. Every language must have every
key English has, and the same `{placeholders}`; the typecheck and
`locales.test.ts` fail otherwise. Another language is one more messages file
and one entry in `src/i18n/locales.ts`.

The page font includes Ge'ez script, for Amharic text and names.

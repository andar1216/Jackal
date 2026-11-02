# Valkyrie

Valkyrie is a personal "track anything in life" app. It combines streak tracking, finances, fitness and calories, time tracking, and a calendar in one React app.

> **Status:** the frontend UI is built and interactive, and a Node + MongoDB backend API (`server/`) is set up and tested. **You sign in with an account (email + password), and your data is private to it.** **The Dashboard is connected to the API**: skills, logged days and per-skill average weeks are saved in MongoDB. The other screens (Streaks, Finances, Fitness, Time, Calendar) are not connected yet. They keep state in memory, reset on refresh, and start with sample data. The dashboard widget layout and the theme are also not saved yet.

---

## Features

Your profile (picture, name and email) sits at the **bottom of the left sidebar**. Click it and a menu opens upward with **Settings** (theme: system/light/dark, display name) and **Log out**. On a narrow window the sidebar becomes a top strip and the menu drops down from the right.

| Screen | What it does today (UI) | Planned |
| --- | --- | --- |
| **Dashboard** (default tab) | Drag-and-drop widgets for **Skills** you're working on. Widgets: Skills list (mark today, add, delete), Calendar (click days to log them), Streak (current and best), Days on / off, and Weekly average (average days per week over a configurable number of weeks, set per skill, with a per-week bar chart). Click a skill to show it in the other widgets. A **Connect** button above the widgets opens the list of outside services to link (see Integrations below). Boards can be moved and resized without the settings gear: press a board anywhere that isn't a button or field and drag it to a new place (or focus it and use the arrow keys), pull its left or right side to resize it (it snaps to a third, half, three-quarter or full width, and nothing in between), pull its top or bottom to make it taller (in small steps, never shorter than its contents need, so nothing is squeezed or scrolls; double-click that edge to go back), or click it and press the garbage can that appears low inside it to put it away. The gear's **Customize layout** mode still lists every board, hidden ones included, so you can restore them. | Saved layout, more widget types, per-skill goals |
| **Streaks** | Add a tracker, pick its start date on a React calendar, see days kept, progress to the next milestone (7, 30, 60, 100, 180, 365...), reset, delete. Start dates are marked on the calendar. | Longest-streak history, notes, icons |
| **Goals** | Add goals (name, category, priority, start date, a deadline for the whole goal, an optional budget and planned time) and break each into steps. Every step has its own deadline, cost and time, and can be ticked off, edited or removed. Each goal shows progress, cost and time done against the total, what is overdue, and a warning when the steps cost more than the budget, take more time than planned or are due after the goal's deadline. The top shows active goals, steps left, cost and time to go, and the next deadline; goals can be paused, marked done and reopened. Time is typed as `90`, `1.5h` or `1h 30m`. The overview figures and every goal are boards: press one and drag it, pull its sides to resize it, or click it to put it away (the filter icon brings it back). | Reminders for deadlines |
| **Finances** | Add income and expenses, per-category budget bars, income/spent/net totals, delete transactions. | Date picker per entry, monthly filtering, charts, recurring items |
| **Fitness** | Daily calorie goal, log meals (kcal, protein, carbs, fat) and workouts, remaining calories (goal - eaten + burned), macro totals. | Per-day history, body-weight trend, editable goal |
| **Time** | Start/stop timer with label and category, live clock, today's entries and totals by category. | Manual entries, weekly view, editing |
| **Calendar** | Month calendar with events, plus tracker start dates. Click a day to see its events and which trackers were running (and their day count). | Week/day views, editing events, workouts and time overlay |

---

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | React 19 |
| Language | TypeScript |
| Build tool | Vite |
| Calendar UI | [`react-calendar`](https://www.npmjs.com/package/react-calendar) |
| Dates | [`date-fns`](https://date-fns.org/) |
| Styling | Plain CSS with variables (`src/index.css`), light and dark via `prefers-color-scheme` |
| Linting | ESLint (typescript-eslint, react-hooks, react-refresh) |
| Backend | Node.js, Express 5, TypeScript (`server/`) |
| Database | MongoDB via Mongoose |
| Validation | Zod |
| Backend tests | `node:test` with `mongodb-memory-server` (no local MongoDB needed) |

There is no router. `App.tsx` switches screens with a piece of state, which is enough for five tabs.

---

## Prerequisites

- [Node.js](https://nodejs.org/) 20.19 or newer (22+ recommended)
- npm (bundled with Node)
- MongoDB, only to run the backend: either a local install ([Community Server](https://www.mongodb.com/try/download/community)) or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster. The backend tests don't need it.

---

## Getting started

### Run everything

```bash
npm install
npm run server:install              # installs server/ dependencies (once)
cp .env.example .env                # Windows PowerShell: Copy-Item .env.example .env
# edit .env: set MONGODB_URI (local or Atlas)
npm run n                           # frontend + API together
```

`npm run n` starts the Vite dev server (`http://localhost:5173`, which proxies `/api`) and the API (`http://localhost:4000`) side by side, with colour-coded `web` and `api` output. Press Ctrl+C once to stop both. The API reads `.env` from the project root. If MongoDB isn't reachable yet, the API keeps retrying every 5 seconds and connects as soon as it comes up, so start order doesn't matter.

Check the API at `http://localhost:4000/api/health`, which returns `{"status":"ok","db":true}` when MongoDB is connected.

You can also run them separately: `npm run dev` for the frontend and `npm run server` for the API.

The database starts empty, so the Dashboard shows no skills at first. Add some in the Skills widget, or run `npm run seed` inside `server/` to add the defaults (Exercise, Calories, Finances) with sample history. The seed does nothing if skills already exist.

**No MongoDB installed?** Run `npm run dev:memory` inside `server/` instead of `npm run server`. It starts the API on a temporary in-memory database, with a demo account (`demo@valkyrie.local` / `demo-password-1`) and the default skills. Data is lost when you stop it. The first run downloads a MongoDB binary.

If the backend isn't reachable, the Dashboard shows an error banner with a Retry button. By default the frontend calls `/api` (proxied by Vite in development). To point it at an API on another host, set `VITE_API_URL` (for example `https://api.example.com/api`) when building, and set `CLIENT_ORIGIN` on the server to the frontend's URL.

Backend scripts (run inside `server/`, or from the root with the `server:*` scripts):

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the API with auto-restart on changes |
| `npm run dev:memory` | Start the API on a temporary in-memory MongoDB, with a demo account (`demo@valkyrie.local` / `demo-password-1`) and the default skills |
| `npm run seed` | Add the default skills to your database if it has none |
| `npm run build` | Compile to `server/dist/` |
| `npm start` | Run the compiled build |
| `npm run typecheck` | Type-check the backend |
| `npm test` | Run the API tests against an in-memory MongoDB (first run downloads a MongoDB binary) |

### Scripts

| Command | What it does |
| --- | --- |
| `npm run n` | Start the frontend and the API together |
| `npm run dev` | Start the Vite dev server with hot reload |
| `npm run server` | Start the API only |
| `npm run build` | Type-check (`tsc -b`) and create a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint over the project |

---

## Building for production

```bash
npm run build
npm run preview   # optional: check the build locally
```

The output in `dist/` is a static site. Host it on Netlify, Vercel, GitHub Pages, Cloudflare Pages, or any static file server.

---

## Project structure

```
Valkyrie/
├── public/
│   └── favicon.svg
├── src/
│   ├── main.tsx                      # Entry point (imports react-calendar CSS before index.css)
│   ├── App.tsx                       # Sidebar, screen switching, theme, shared tracker/event state
│   ├── index.css                     # Theme, layout, shared components, react-calendar overrides
│   ├── types.ts                      # Shared TypeScript types
│   ├── components/
│   │   └── AccountMenu.tsx           # Profile at the bottom of the sidebar: Settings and Log out menu
│   ├── lib/
│   │   ├── dates.ts                  # Date, money and duration helpers
│   │   ├── api.ts                    # fetch wrapper and skills API calls
│   │   └── writeQueue.ts             # Runs API writes one at a time, in order
│   └── features/
│       ├── dashboard/
│       │   ├── DashboardPage.tsx     # Widget layout, drag and drop, skill state
│       │   ├── widgets.tsx           # Skills, Calendar, Streak, Days on/off, Average widgets
│       │   └── skillStats.ts         # Streak, days on/off and weekly average calculations
│       ├── connections/ConnectModal.tsx  # The Connect dialog
│       ├── streaks/StreaksPage.tsx
│       ├── finance/FinancePage.tsx
│       ├── fitness/FitnessPage.tsx
│       ├── goals/GoalsPage.tsx          # Goals and their steps, each a Board panel (goalMath.ts: progress, cost, time, deadlines)
│       ├── time/TimePage.tsx
│       └── calendar/CalendarPage.tsx
├── server/                           # Node + MongoDB backend (its own package.json)
│   ├── src/
│   │   ├── index.ts                  # Connects to MongoDB, starts the server
│   │   ├── app.ts                    # Express app (CORS, JSON, routes, error handling)
│   │   ├── config.ts                 # PORT, MONGODB_URI, CLIENT_ORIGIN from env
│   │   ├── db.ts                     # Mongoose connection
│   │   ├── models.ts                 # Mongoose models
│   │   ├── validation.ts             # Zod request schemas
│   │   ├── routes.ts                 # Resource routes
│   │   ├── integrations/             # registry.ts (the list of services) and routes.ts
│   │   ├── seed.ts                   # Default skills (used by the seed and dev:memory scripts)
│   │   └── lib/
│   │       ├── crud.ts               # Reusable list/get/create/update/delete router
│   │       └── errors.ts             # HttpError and the JSON error handler
│   ├── scripts/                      # seed.ts and dev-memory.ts
│   └── test/api.test.ts              # API tests
├── .env.example                      # Copy to .env (MONGODB_URI, PORT, CLIENT_ORIGIN)
├── index.html
├── package.json
└── vite.config.ts                    # Also proxies /api to the backend
```

Each folder under `features/` is one screen. Trackers and calendar events are held in `App.tsx` because the calendar displays tracker start dates. The other screens keep their own local state. All screens stay mounted and are only hidden when inactive, so switching tabs doesn't lose state (for example a running timer).

### How the skill numbers are calculated

- **Days on:** days logged for the skill. **Days off:** days since the start date that weren't logged. Today only counts as off once it has passed.
- **Current streak:** consecutive logged days ending today, or yesterday if today isn't logged yet.
- **Weekly average:** days on in the last N rolling 7-day weeks, divided by the number of weeks. If the skill is newer than N weeks, only the weeks since its start date are used. N is set per skill (1 to 52, default 12).
- Logging a day before a skill's start date moves the start date back to that day.

---

## API

Base URL `http://localhost:4000/api`. All bodies are JSON. Documents are returned with a string `id` (no `_id` or `__v`) plus `createdAt` and `updatedAt`. Invalid input returns `400` with `{ "error": "...", "issues": [...] }`, a missing document returns `404`, and unknown fields in a request body are rejected.

**Everything except /health and /auth/* requires a signed-in user** (otherwise 401), and every query is limited to that user's own documents. Another user's document looks like it doesn't exist (404).

Every resource below supports `GET /`, `GET /:id`, `POST /`, `PATCH /:id` (send only the fields to change), and `DELETE /:id` (returns `204`).

| Resource | Path | Extra query filters |
| --- | --- | --- |
| Skills | `/skills` | none |
| Trackers (Streaks screen) | `/trackers` | none |
| Transactions | `/transactions` | `type`, `category`, `from`, `to` (`YYYY-MM-DD`, inclusive) |
| Meals | `/meals` | `from`, `to` |
| Workouts | `/workouts` | `type`, `from`, `to` |
| Time entries | `/time-entries` | `category`, `from`, `to` (full ISO timestamps, so the client controls its own day boundaries) |
| Calendar events | `/events` | `from`, `to` |

Other endpoints:

- Accounts: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/me` (change your name). Sign-in sets an httpOnly session cookie.
- `GET /integrations` lists the planned integrations with their connection state; `POST /integrations/:id/connect` starts connecting (returns `501` until that integration is built); `DELETE /integrations/:id/connection` disconnects.
- `GET /health` returns `{ "status": "ok", "db": true }`.
- `POST /skills/:id/logs/:date/toggle` turns a day on or off for a skill (the dashboard calendar click). Logging a day before the start date moves the start date back.

Meals and workouts default `date` to today when it isn't sent. A running timer is a time entry with no `end`; stop it with `PATCH /time-entries/:id` and an `end`.

### Accounts and security

- Passwords are hashed with scrypt (never stored or logged). Sign-in errors are identical for a wrong password and an unknown email, and repeated failures are rate limited (in memory, per email and address).
- Sessions are random tokens in an httpOnly, SameSite=Lax cookie (Secure in production). Only a hash of the token is stored in MongoDB, and sessions expire after 30 days of inactivity.
- Writes from any browser origin other than CLIENT_ORIGIN are refused, and the API listens on 127.0.0.1 only (HOST to change).
- **The first account created adopts any data saved before accounts existed.** After that, set ALLOW_REGISTRATION=false in .env if you don't want anyone else to sign up.
- Not built yet: password change/reset and email verification. Browse the app at http://localhost:5173 (not 127.0.0.1), because that is the allowed origin.

---

## Integrations

The Dashboard's **Connect** button lists the outside services we want to pull data from (the `Todo` file). They are built one at a time. Each is defined in `server/src/integrations/registry.ts` with `implemented: false` until its connection flow works, and the UI shows it as "Coming soon" until then.

| Service | Kind | Status |
| --- | --- | --- |
| Google Calendar | Official API (OAuth) | Not started |
| Plaid (bank accounts) | Official API (Plaid Link) | **Built** (Sandbox tested; see below) |
| MyFitnessPal | Likely partner-only API | Not started, may not be possible |
| Crunch Fitness | Unofficial (no public API). Connect opens https://members.crunch.com/ in a new tab; you sign in there and click a "Send to Valkyrie" bookmark, which sends the same data the My Profile page shows. Optionally Valkyrie can sign in for you instead (password stored encrypted; needs INTEGRATION_ENCRYPTION_KEY) so it refreshes by itself | Built: check-in progress and history, class history, payment history on the Fitness page |
| Android phone screen time | Unofficial (Android has no outside API). The Valkyrie app in `android/` reads it on the phone and sends daily totals to this server over your Wi-Fi. Pair it from the Screen Time page | Built (see below) |
| ActivityWatch | Free open-source tracker on this PC. Valkyrie reads its daily per-app and per-website totals from its local API (`localhost:5600`) and keeps only names and seconds. Connect from the Screen Time page. It also keeps *when* each app and website was on screen, by quarter hour (names and seconds only) | Built |

### When each app was on screen (the day timeline)

Click a day on the Screen Time calendar and under its totals is an hour-by-hour view: every hour is four squares (the first 15 minutes, 15 to 30, 30 to 45, 45 to 60), shaded in four steps by how much of those 15 minutes a screen was on (lightest for a little, darkest for all of it). Four darkest squares in a row is a full hour on screen. Click a square to see which apps and websites were on in that quarter, and below it each app and website lists the stretches it was open (for example "9:00 AM – 9:45 AM"). **All / Computer / Phone** switches whose screen counts when both have data, and the device view at the top of the page is respected. Two screens on at once are not added together (a quarter hour can't hold more than 15 minutes), only apps count towards the shade (a website is inside the browser app), and websites are listed separately.

- Computers: ActivityWatch's window and browser-tab events are cut into quarter hours on each sync (`ScreenTimeSlot` in `server/src/models.ts`, `server/src/lib/slots.ts`).
- Phone: the app cuts Android's usage log into quarter hours (`UsageMath.slots`) and sends them with each day. Android only keeps that detailed log for about a week, so older days have totals but no timeline. A day is only replaced when the phone sends times for it.
- Precision is 15 minutes. Nothing but app/site names and seconds is stored; it goes away with the rest when a device is removed or ActivityWatch is disconnected. API: `GET /api/integrations/screen-time/slots?day=YYYY-MM-DD` (phone key: `GET /api/phone/app/screen-time/slots?day=`).
### Strong workouts (CSV import and Health Connect)

Android won't let one app read another's data, so Strong's workouts come in two ways, both ending up as ordinary workouts in the Fitness page and calendar:

- **Strong's export.** Strong > Profile > Settings > Export Strong Data makes a CSV with one row per set. Pick it on the website's Fitness page (**Strong and phone workouts**) or in the phone app's Fitness screen. Each workout keeps its exercises, sets, reps and weights (in the unit the export used). The reader is `server/src/integrations/strong.ts` (it copes with comma and semicolon files, units in the headings and different duration styles). Importing the same file again changes nothing, and calories typed in by hand stay.
- **Health Connect (phone app only).** With the exercise permission allowed (Fitness screen > Read workouts from Health Connect, or Health Connect's own settings) the app sends each exercise session (name, day, minutes, which app wrote it) to `/api/phone/app/workouts/health`. It reads the last 30 days. For Strong to write to Health Connect, allow it in Strong's settings. A Health Connect copy of a Strong workout is dropped when the export already has that day, and replaced if the export arrives later.
### Phone screen time (the Android app)

`android/` is a small Kotlin app (no libraries beyond WorkManager and the drawer menu). Android only lets an app on the phone read screen time, with the **Usage access** permission the person switches on in Settings.

Build and install (needs Android Studio's SDK and JDK 17, both already on this machine):

```
cd android
.\gradlew.bat testDebugUnitTest assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

`adb install` works over USB with USB debugging on, or copy `app-debug.apk` to the phone and open it (allow installs from that source). You can also open the `android` folder in Android Studio and press Run.

Make the server reachable from the phone (same Wi-Fi). In `.env` set `HOST=0.0.0.0` and `ALLOW_REGISTRATION=false` (so nobody else on the network can sign up), restart the API, and allow the port through Windows Firewall for private networks:

```
New-NetFirewallRule -DisplayName "Valkyrie API" -Direction Inbound -Protocol TCP -LocalPort 4000 -Profile Private -Action Allow
```

Then on the Screen Time page press **Pair a phone**. It shows this computer's address and a one-time code (good for ten minutes). Type both into the app, after allowing usage access. The phone then gets its own key (only a hash is kept here, so **Remove** on the page revokes it) and never sees your password.

How it works:

- The app works out seconds per app per day from Android's app-opened/closed events (the home screen and the screen being off are not counted), and sends the last 3 days every 30 minutes. The first sync after pairing (and the **Send all history again** button) also takes in everything Android really has: it keeps daily totals for only about 10 days (it also keeps weekly and monthly totals, but those are not per day, so they are not used; nothing is estimated). Because every synced day is kept on the server, history grows from the day you pair. Digital Wellbeing's own longer history is stored by Samsung's app and can't be read by other apps. Syncs also happen when the app is opened and on **Sync now**. Each sync replaces those days, so repeats are harmless.
- It also sends a small icon for each app, which the Most used apps panel shows. Only app names, icons and seconds ever leave the phone.
- Traffic is plain `http` on your home network (the key is not protected from someone else on your Wi-Fi). Away from home the phone can't reach the server, so it catches up on the next sync at home, up to a week back.
- The numbers are stored with the computer's, marked `source: 'phone'` and filed under the phone's name. The sync logic and tests are in `server/src/integrations/phone.ts`; the reading logic and its unit tests are in `android/app/src/main/java/app/valkyrie/phone/UsageMath.kt`.
- The app is more than the sender: a left menu opens **Dashboard**, **Habits** (add, tick off any of the last five weeks, streaks, best streak, days on and off, rename, archive, delete), **Diet** and **Fitness** (today's calories against the 2200 goal, add and remove meals and workouts, the last 7 days; Fitness also lists the fitness connectors and shows Crunch's check-in progress, check-in, class and payment history, with a Sync now button; and a Strong panel: pick a Strong export (Strong's Settings > Export Strong Data) to bring in every workout with its exercises and sets, or read the workouts other apps saved to Health Connect, which Strong does when you allow it in Strong's settings, giving the day and length but not the sets. Health Connect is read again each time the app opens once it is allowed. The same Strong export can be imported on the website's Fitness page, and a workout is never added twice) (habits with streaks and the last seven days, tap a day to put it on or off, plus today's habits, screen time and this month's spending), **Goals** (add a goal with its deadline, budget and planned time; each step has a deadline, cost and time; tick steps off, see progress and what is overdue; the same goals as the website, from `/api/phone/app/goals`) and **Screen Time** (apps and websites from the phone and computer in one Most used list, with categories you can change by tapping, time by category, unlocks, notifications and each day, for today, 7 or 30 days, and one device or all) and **Finances** (net worth, accounts, a month's income and spending with month buttons that stay pinned at the top while you scroll, where it went, latest transactions). On every screen, **hold a card and drag it** to move it; it lands where you let go and stays there (saved on the phone and sent to your account as pages named phone-*, so it survives a reinstall and the website's own layouts are untouched; Settings has a button to put every board back). The left menu ends with your profile (picture, name and email, read from `/api/phone/app/me`); tapping it opens **Settings**, a list in the style of the website's account menu: Color mode (System, Light, Dark; System follows the phone), Boards, Usage access, Valkyrie connection (pairing and sync buttons) and a red Log out, which unpairs the phone. Each row opens its own view with a back arrow, and the back button steps out of it. These read from the server through the phone's own key (/api/phone/app/*, in server/src/integrations/phoneData.ts), so they show exactly what the website shows. Categories picked on the phone are the same ones the website uses. The sums behind them are in PhoneMath.kt; the website's category guesses are copied into Guesses.kt (regenerate it when categories.ts changes).
- Samsung phones may pause apps you don't open. If syncs stop, set Valkyrie's battery use to Unrestricted (the app has a button for that).

### Plaid (bank accounts)

Set these in the root `.env` (see `.env.example`): `PLAID_CLIENT_ID`, `PLAID_ENV` (`sandbox` or `production`), the matching secret (`PLAID_SANDBOX_SECRET` or `PLAID_PRODUCTION_SECRET`), and `INTEGRATION_ENCRYPTION_KEY` (32 random bytes, base64). **Back the key up: if you lose it you have to reconnect your banks.** Restart the API after changing `.env`.

How it works:

1. **Connect** (Dashboard) asks the server for a one-time link token and opens Plaid Link in the browser.
2. When you finish, Link gives the browser a one-time `public_token`, which the server trades for a long-lived `access_token`. The access token is stored **AES-256-GCM encrypted** in MongoDB (`PlaidItem`) and is never sent to the browser.
3. The server imports your history with Plaid's cursor-based `/transactions/sync` (up to 365 days) and saves it as normal `Transaction`s marked `source: 'plaid'`. Syncing again never duplicates, and picks up changes and removals. **Sync banks** (Finances) and **Sync now** (Connect dialog) fetch the latest. There are no webhooks yet, so nothing syncs by itself.
4. Plaid says money out is positive. Valkyrie turns that into expense/income, maps Plaid's categories onto the Finances budgets (Food, Rent, Transport, Fun, Other), and **skips transfers between your accounts and credit card payments** so nothing counts twice.
5. **Disconnect** revokes access at Plaid, deletes the stored token, and removes the imported transactions (ones you typed in stay).

Testing with fake banks: in Sandbox, Plaid Link accepts the username `user_good` and password `pass_good` (use `1234` if asked for a code). A fresh link can take several seconds before transactions show up; the Connect dialog keeps checking for about 25 seconds.

Going to real banks: Plaid's Trial plan uses `PLAID_ENV=production` with your Production secret and allows 10 linked banks in total (removing one does not free a slot). Banks that sign in through their own site or app (OAuth), like Citi, need an **https** `PLAID_REDIRECT_URI` ending in `/plaid-oauth`, registered under Developers > API > Allowed redirect URIs in the Plaid dashboard (Link otherwise exits with `REQUIRES_OAUTH`). Some of those banks also need Plaid's OAuth registration approved for your account (Dashboard > Settings > OAuth institutions / production access). To use it locally:

1. Start an https tunnel to the dev server: `ngrok http 5173` (it prints an `https://...` address).
2. In `.env` set `PLAID_REDIRECT_URI=https://<that address>/plaid-oauth` and `CLIENT_ORIGIN=https://<that address>`, add the same redirect URI in the Plaid dashboard, and restart `npm run n`.
3. Open Valkyrie at the tunnel address (not localhost), sign in (the cookie is per address, same account and data), then Connect > Add a bank. After you approve on the bank's site it returns to `/plaid-oauth`, which finishes the link and imports the transactions.

---

## Data model

See `src/types.ts` for the full types: `Skill`, `Tracker`, `Transaction`, `Meal`, `Workout`, `TimeEntry`, and `CalendarEvent`.

- Calendar days are stored as `YYYY-MM-DD` strings. Parse them with `date-fns` `parseISO`, not `new Date('YYYY-MM-DD')`, which is read as UTC and can shift the day.
- Money is stored as integer cents.
- A running timer is a `TimeEntry` with no `end`. Elapsed time is computed from the stored start timestamp.

---

## Roadmap

1. ~~UI for all five screens~~ (done)
2. ~~Backend: Node + MongoDB API for all resources~~ (done)
3. **Connect the remaining screens to the API** (Streaks, Finances, Fitness, Time, Calendar). ~~Dashboard~~ is done. Also save the dashboard layout and theme (`localStorage` or a user settings document).
4. ~~Auth and per-user data: accounts, sessions, and a `userId` on every document~~ (done). Password change/reset and email verification are still to do.
5. **Calendar:** week and day views, event editing, overlay of workouts and time entries.
6. **Streaks:** reset history and longest streak.
7. **Finance and fitness:** choose a date per entry, add monthly/daily history, and add charts (e.g. `recharts`).
8. **Integrations** (see the `Todo` file): Google Calendar, Plaid, MyFitnessPal, gym and screen-time sources.
9. **Export/import** your data as JSON.

---

## Conventions

- TypeScript everywhere; avoid `any`.
- Function components and hooks only.
- Keep each screen's code in `src/features/<name>/`.
- Run `npm run lint` and `npm run build` before committing. For backend changes also run `npm run typecheck` and `npm test` in `server/`.
- Never commit `.env` files. Use `.env.example` as the template.
- Never store money as floating-point dollars. Use integer cents.

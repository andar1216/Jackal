# Jackal

Jackal is a personal "track anything in life" app. It combines streak tracking, finances, fitness and calories, time tracking, and a calendar in one React app.

> **Status:** the frontend UI is built and interactive, and a Node + MongoDB backend API (`server/`) is set up and tested. **The Dashboard is connected to the API**: skills, logged days and per-skill average weeks are saved in MongoDB. The other screens (Streaks, Finances, Fitness, Time, Calendar) are not connected yet. They keep state in memory, reset on refresh, and start with sample data. The dashboard widget layout and the theme are also not saved yet.

---

## Features

The app has a **top bar** with a **Settings** menu (theme: system/light/dark, display name) and a **profile** menu at the top right. Account actions are placeholders for now.

| Screen | What it does today (UI) | Planned |
| --- | --- | --- |
| **Dashboard** (default tab) | Drag-and-drop widgets for **Skills** you're working on. Widgets: Skills list (mark today, add, delete), Calendar (click days to log them), Streak (current and best), Days on / off, and Weekly average (average days per week over a configurable number of weeks, set per skill, with a per-week bar chart). Click a skill to show it in the other widgets. A **Connect** button above the widgets opens the list of outside services to link (see Integrations below). Widgets can be reordered by dragging the header (or arrow keys on the handle), resized between half and full width, hidden, and restored. | Saved layout, more widget types, per-skill goals |
| **Streaks** | Add a tracker, pick its start date on a React calendar, see days kept, progress to the next milestone (7, 30, 60, 100, 180, 365...), reset, delete. Start dates are marked on the calendar. | Longest-streak history, notes, icons |
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

**No MongoDB installed?** Run `npm run dev:memory` inside `server/` instead of `npm run server`. It starts the API on a temporary in-memory database, already seeded with the default skills. Data is lost when you stop it. The first run downloads a MongoDB binary.

If the backend isn't reachable, the Dashboard shows an error banner with a Retry button. By default the frontend calls `/api` (proxied by Vite in development). To point it at an API on another host, set `VITE_API_URL` (for example `https://api.example.com/api`) when building, and set `CLIENT_ORIGIN` on the server to the frontend's URL.

Backend scripts (run inside `server/`, or from the root with the `server:*` scripts):

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the API with auto-restart on changes |
| `npm run dev:memory` | Start the API on a temporary in-memory MongoDB, seeded with the default skills |
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
Jackal/
├── public/
│   └── favicon.svg
├── src/
│   ├── main.tsx                      # Entry point (imports react-calendar CSS before index.css)
│   ├── App.tsx                       # Sidebar, top bar, screen switching, theme, shared tracker/event state
│   ├── index.css                     # Theme, layout, shared components, react-calendar overrides
│   ├── types.ts                      # Shared TypeScript types
│   ├── components/
│   │   └── TopBar.tsx                # Settings and profile menus (top right)
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

- `GET /integrations` lists the planned integrations with their connection state; `POST /integrations/:id/connect` starts connecting (returns `501` until that integration is built); `DELETE /integrations/:id/connection` disconnects.
- `GET /health` returns `{ "status": "ok", "db": true }`.
- `POST /skills/:id/logs/:date/toggle` turns a day on or off for a skill (the dashboard calendar click). Logging a day before the start date moves the start date back.

Meals and workouts default `date` to today when it isn't sent. A running timer is a time entry with no `end`; stop it with `PATCH /time-entries/:id` and an `end`.

**Not built yet:** authentication and per-user data. Right now there is a single shared dataset, so don't expose the API publicly. The profile menu in the UI is a placeholder for this.

---

## Integrations

The Dashboard's **Connect** button lists the outside services we want to pull data from (the `Todo` file). They are built one at a time. Each is defined in `server/src/integrations/registry.ts` with `implemented: false` until its connection flow works, and the UI shows it as "Coming soon" until then.

| Service | Kind | Status |
| --- | --- | --- |
| Google Calendar | Official API (OAuth) | Not started |
| Plaid (bank accounts) | Official API (Plaid Link) | Not started |
| MyFitnessPal | Likely partner-only API | Not started, may not be possible |
| Crunch Fitness | Unofficial, can break | Not started |
| Samsung S23 screen time | No public API, needs a companion app | Not started |
| Windows screen time | Needs a local background agent | Not started |

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
4. **Auth and per-user data:** accounts, sessions, and a `userId` on every document.
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

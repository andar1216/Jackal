import { useEffect, useState, type ReactNode } from 'react'
import { Activity, CircleGauge, Landmark, Soup } from 'lucide-react'
import { subDays } from 'date-fns'
import TopBar, { type Theme } from './components/TopBar'
import CalendarPage from './features/calendar/CalendarPage'
import PlaidOAuthReturn from './features/connections/PlaidOAuthReturn'
import { PLAID_OAUTH_PATH } from './features/connections/plaidImport'
import DashboardPage from './features/dashboard/DashboardPage'
import DietPage from './features/diet/DietPage'
import FinancePage from './features/finance/FinancePage'
import FitnessPage from './features/fitness/FitnessPage'
import StreaksPage from './features/streaks/StreaksPage'
import TimePage from './features/time/TimePage'
import AuthPage from './auth/AuthPage'
import { useAuth } from './auth/context'
import { toDateKey, todayKey } from './lib/dates'
import type { CalendarEvent, Meal, Tracker, User } from './types'

const ICON_SIZE = 18

// A page with hidden: true is kept in the code but left out of the menu and not shown. Remove the flag to bring it back.
const PAGES: { id: string; label: string; icon: ReactNode; hidden?: boolean }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <CircleGauge size={ICON_SIZE} /> },
  { id: 'streaks', label: 'Streaks', icon: '🔥', hidden: true },
  { id: 'finance', label: 'Finances', icon: <Landmark size={ICON_SIZE} /> },
  { id: 'diet', label: 'Diet', icon: <Soup size={ICON_SIZE} /> },
  { id: 'fitness', label: 'Fitness', icon: <Activity size={ICON_SIZE} /> },
  { id: 'time', label: 'Time', icon: '⏱️', hidden: true },
  { id: 'calendar', label: 'Calendar', icon: '📅', hidden: true },
]

const isShown = (id: PageId) => !PAGES.find((p) => p.id === id)?.hidden

type PageId = 'dashboard' | 'streaks' | 'finance' | 'diet' | 'fitness' | 'time' | 'calendar'

const SEED_TRACKERS: Tracker[] = [
  { id: 't1', name: 'Daily reading', startDate: toDateKey(subDays(new Date(), 12)), color: '#4f46e5' },
  { id: 't2', name: 'No soda', startDate: toDateKey(subDays(new Date(), 45)), color: '#db2777' },
]

const SEED_MEALS: Meal[] = [
  { id: 'm1', name: 'Oatmeal & banana', calories: 380, protein: 12, carbs: 68, fat: 7 },
  { id: 'm2', name: 'Chicken burrito bowl', calories: 720, protein: 48, carbs: 70, fat: 24 },
]

const SEED_EVENTS: CalendarEvent[] = [{ id: 'e1', title: 'Dentist', date: todayKey() }]

export default function App() {
  const { status, user, retry } = useAuth()
  const [theme, setTheme] = useState<Theme>('system')
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  if (status === 'loading' || status === 'error') {
    return (
      <div className="auth-status">
        <div className="brand">Jackal</div>
        {status === 'error' ? (
          <>
            <p className="muted">Can't reach the server. Is the backend running? Trying again...</p>
            <div>
              <button onClick={retry}>Retry now</button>
            </div>
          </>
        ) : (
          <p className="muted">Loading...</p>
        )}
      </div>
    )
  }

  if (!user) return <AuthPage />

  // A bank like Citi sends the person back here after they approve access on the bank's own site.
  if (window.location.pathname === PLAID_OAUTH_PATH) return <PlaidOAuthReturn />

  // Keyed by user so signing out and in as someone else never shows the previous person's screens.
  return <Shell key={user.id} user={user} theme={theme} onThemeChange={setTheme} />
}

type ShellProps = { user: User; theme: Theme; onThemeChange: (theme: Theme) => void }

function Shell({ user, theme, onThemeChange }: ShellProps) {
  const { updateName, signOut } = useAuth()
  const [page, setPage] = useState<PageId>('dashboard')
  // Trackers and events are shared so the calendar can show them.
  const [trackers, setTrackers] = useState<Tracker[]>(SEED_TRACKERS)
  const [events, setEvents] = useState<CalendarEvent[]>(SEED_EVENTS)
  // Meals are logged on Diet and also counted on Fitness (calories left after exercise).
  const [meals, setMeals] = useState<Meal[]>(SEED_MEALS)

  // Every page stays mounted (just hidden) so switching tabs doesn't lose
  // in-memory state, such as a running timer or the dashboard layout.
  const show = (id: PageId) => ({ hidden: page !== id })

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">Jackal</div>
        {PAGES.filter((p) => !p.hidden).map((p) => (
          <button
            key={p.id}
            className={`nav-item ${page === p.id ? 'active' : ''}`}
            onClick={() => setPage(p.id as PageId)}
            aria-current={page === p.id ? 'page' : undefined}
          >
            <span aria-hidden className="nav-icon">
              {p.icon}
            </span>
            {p.label}
          </button>
        ))}
      </nav>

      <div className="main-col">
        <TopBar
          theme={theme}
          onThemeChange={onThemeChange}
          user={user}
          onNameChange={updateName}
          onSignOut={signOut}
        />
        <main className="content">
          <div {...show('dashboard')}>
            <DashboardPage />
          </div>
          {isShown('streaks') && (
            <div {...show('streaks')}>
              <StreaksPage trackers={trackers} setTrackers={setTrackers} />
            </div>
          )}
          <div {...show('finance')}>
            <FinancePage />
          </div>
          <div {...show('diet')}>
            <DietPage meals={meals} setMeals={setMeals} />
          </div>
          <div {...show('fitness')}>
            <FitnessPage meals={meals} />
          </div>
          {isShown('time') && (
            <div {...show('time')}>
              <TimePage />
            </div>
          )}
          {isShown('calendar') && (
            <div {...show('calendar')}>
              <CalendarPage trackers={trackers} events={events} setEvents={setEvents} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

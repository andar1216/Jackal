import { useEffect, useRef, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

type Props = {
  theme: Theme
  onThemeChange: (theme: Theme) => void
  displayName: string
  onDisplayNameChange: (name: string) => void
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

export default function TopBar({ theme, onThemeChange, displayName, onDisplayNameChange }: Props) {
  const [open, setOpen] = useState<'settings' | 'profile' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Close the open menu on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (menu: 'settings' | 'profile') => setOpen((cur) => (cur === menu ? null : menu))
  const name = displayName.trim() || 'Guest'

  return (
    <header className="topbar">
      <div className="topbar-actions" ref={ref}>
        <div className="menu-wrap">
          <button
            className="icon-btn"
            aria-label="Settings"
            aria-haspopup="dialog"
            aria-expanded={open === 'settings'}
            onClick={() => toggle('settings')}
          >
            ⚙️
          </button>
          {open === 'settings' && (
            <div className="popover" role="dialog" aria-label="Settings">
              <h3>Settings</h3>
              <div className="field">
                <span className="stat-label">Theme</span>
                <div className="segmented" role="group" aria-label="Theme">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      className={theme === t.id ? 'active' : ''}
                      aria-pressed={theme === t.id}
                      onClick={() => onThemeChange(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span className="stat-label">Display name</span>
                <input value={displayName} onChange={(e) => onDisplayNameChange(e.target.value)} placeholder="Guest" />
              </label>
            </div>
          )}
        </div>

        <div className="menu-wrap">
          <button
            className="profile-btn"
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={open === 'profile'}
            onClick={() => toggle('profile')}
          >
            <span className="avatar">{initials(name)}</span>
            <span className="profile-name">{name}</span>
          </button>
          {open === 'profile' && (
            <div className="popover" role="menu" aria-label="Account">
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="avatar">{initials(name)}</span>
                <div>
                  <strong>{name}</strong>
                  <div className="stat-label">Local profile</div>
                </div>
              </div>
              <button role="menuitem" disabled title="Coming soon">
                Manage account
              </button>
              <button role="menuitem" disabled title="Coming soon">
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

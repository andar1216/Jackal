import { useEffect, useRef, useState } from 'react'
import { ChevronUp, LogOut, Settings } from 'lucide-react'
import type { User } from '../types'

export type Theme = 'system' | 'light' | 'dark'

type Props = {
  theme: Theme
  onThemeChange: (theme: Theme) => void
  user: User
  onNameChange: (name: string) => Promise<void>
  onSignOut: () => Promise<void>
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

/**
 * The person at the bottom of the left menu: their picture (initials), name and email. Pressing it opens a menu with
 * the settings (theme, display name) and sign out.
 */
export default function AccountMenu({ theme, onThemeChange, user, onNameChange, onSignOut }: Props) {
  const [open, setOpen] = useState(false)
  // The name box is edited freely and saved when you leave it (or press Enter).
  const [draftName, setDraftName] = useState(user.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const saveName = async () => {
    const next = draftName.trim()
    if (next === user.name) return setNameError(null)
    if (!next) {
      setDraftName(user.name)
      return setNameError(null)
    }
    try {
      await onNameChange(next)
      setNameError(null)
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Couldn't save the name.")
    }
  }

  return (
    <div className="account" ref={ref}>
      {open && (
        <div className="account-menu" role="menu" aria-label="Account">
          <div className="account-email">{user.email}</div>

          <div className="account-section">
            <div className="account-heading">
              <Settings size={16} aria-hidden /> Settings
            </div>
            <div className="field">
              <span className="stat-label">Theme</span>
              <div className="segmented" role="group" aria-label="Theme">
                {THEMES.map((t) => (
                  <button key={t.id} className={theme === t.id ? 'active' : ''} aria-pressed={theme === t.id} onClick={() => onThemeChange(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span className="stat-label">Display name</span>
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                maxLength={80}
              />
              {nameError && <span className="muted">{nameError}</span>}
            </label>
          </div>

          <button className="account-item" role="menuitem" onClick={onSignOut}>
            <LogOut size={16} aria-hidden /> Log out
          </button>
        </div>
      )}

      <button className="account-btn" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="avatar">{initials(user.name)}</span>
        <span className="account-text">
          <span className="account-name">{user.name}</span>
        </span>
        <ChevronUp size={16} aria-hidden className="account-chevron" />
      </button>
    </div>
  )
}

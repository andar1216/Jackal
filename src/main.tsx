import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Library CSS first so our theme overrides in index.css win.
import 'react-calendar/dist/Calendar.css'
import './index.css'
import App from './App.tsx'
import AuthProvider from './auth/AuthProvider.tsx'

// The app used to be called Jackal. Carry the saved settings over to the new name, once.
for (const key of Object.keys(localStorage)) {
  if (!key.startsWith('jackal.')) continue
  const next = 'valkyrie.' + key.slice('jackal.'.length)
  if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key) ?? '')
  localStorage.removeItem(key)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)

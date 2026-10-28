import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Library CSS first so our theme overrides in index.css win.
import 'react-calendar/dist/Calendar.css'
import './index.css'
import App from './App.tsx'
import AuthProvider from './auth/AuthProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)

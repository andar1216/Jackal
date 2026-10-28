import type { Skill } from '../types'

// Dev: Vite proxies /api to the backend. For a separate API host, set VITE_API_URL.
const BASE = import.meta.env.VITE_API_URL ?? '/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, "Can't reach the server. Is the backend running?")
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // Not JSON (for example an HTML error page from a proxy).
  }

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : res.status >= 500
          ? "Can't reach the server. Is the backend running?"
          : `Request failed (${res.status})`
    throw new ApiError(res.status, message)
  }
  return data as T
}

export type NewSkill = Pick<Skill, 'name' | 'color' | 'startDate'>

export const skillsApi = {
  list: () => request<Skill[]>('GET', '/skills'),
  create: (skill: NewSkill) => request<Skill>('POST', '/skills', skill),
  update: (id: string, changes: Partial<Pick<Skill, 'name' | 'color' | 'avgWeeks'>>) =>
    request<Skill>('PATCH', `/skills/${id}`, changes),
  remove: (id: string) => request<void>('DELETE', `/skills/${id}`),
  toggleDay: (id: string, dateKey: string) => request<Skill>('POST', `/skills/${id}/logs/${dateKey}/toggle`),
}

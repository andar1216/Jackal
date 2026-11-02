/**
 * Crunch Fitness has no public API. This signs in to the members site the way a browser does and reads the same
 * JSON the "My Profile" page loads (check-ins, class history, billing history). That is an unofficial route:
 * it can stop working whenever Crunch changes their site, so every step reports a clear error instead of guessing.
 * Tests swap in a fake (see `setCrunchGateway`).
 */

const BASE = 'https://members.crunch.com'
const UA = 'Valkyrie/1.0 (personal tracker; reads your own Crunch member data)'
const TIMEOUT_MS = 20_000
/** Crunch's own history pages start no earlier than this. Asking for everything keeps the data complete. */
const HISTORY_FROM = '2015-01-01'

export type CrunchCheckIn = {
  id: string
  /** ISO time (UTC). */
  at: string
  club: string
}

export type CrunchClass = {
  program: string
  /** Local club time as Crunch shows it: `YYYY-MM-DDTHH:mm`. */
  startsAt: string
  club: string
  /** "attended", "cancelled", "no-show" and so on, as Crunch words it. */
  status: string
  feeCents?: number
}

export type CrunchPayment = {
  service: string
  /** Positive for charges, negative for payments and credits. */
  amountCents: number
  /** YYYY-MM-DD */
  date: string
  club?: string
}

export type CrunchSnapshot = {
  memberId: string
  /** The weekly check-in goal the person set on Crunch's site. */
  workoutGoal?: number
  checkIns: CrunchCheckIn[]
  classes: CrunchClass[]
  payments: CrunchPayment[]
  /** What Crunch says is still owed, in cents. */
  balanceCents?: number
}

export class CrunchError extends Error {
  code: 'BAD_LOGIN' | 'UNEXPECTED' | 'UNREACHABLE'
  constructor(code: CrunchError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export type CrunchGateway = {
  /** Signs in and reads everything. Credentials are used for this one call and not kept here. */
  fetchAll(email: string, password: string): Promise<CrunchSnapshot>
}

/* ---------- Reading what Crunch returns (kept apart so it can be tested without the network) ---------- */

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export const toCents = (v: unknown): number | undefined => {
  const text = typeof v === 'number' ? String(v) : str(v).replace(/[$,\s]/g, '')
  if (text === '') return undefined
  const n = Number(text)
  return Number.isFinite(n) ? Math.round(n * 100) : undefined
}

/** `MM/DD/YY` (or `MM/DD/YYYY`) to `YYYY-MM-DD`. */
export const parseBillingDate = (v: unknown): string | undefined => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(str(v).trim())
  if (!m) return undefined
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

/** `2026-10-05 06:30pm` to `2026-10-05T18:30`. */
export const parseClassTime = (v: unknown): string | undefined => {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})\s*([ap]m)?$/i.exec(str(v).trim())
  if (!m) return undefined
  let hour = Number(m[2])
  const meridiem = m[4]?.toLowerCase()
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  return `${m[1]}T${String(hour).padStart(2, '0')}:${m[3]}`
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

export function parseCheckIns(json: unknown): CrunchCheckIn[] {
  if (!Array.isArray(json)) throw new CrunchError('UNEXPECTED', 'Crunch sent check-ins in a shape Valkyrie does not recognize.')
  const out: CrunchCheckIn[] = []
  for (const raw of json) {
    const r = asRecord(raw)
    // Crunch tags these times with "Z" even though they are the club's wall-clock time, so read the digits as they are.
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(str(r.checkin_time).trim())
    if (!m) continue
    const at = `${m[1]}T${m[2]}`
    out.push({ id: String(r.mms_checkin_id ?? r.id ?? at), at, club: str(r.location) })
  }
  return out
}

export function parseClasses(json: unknown): CrunchClass[] {
  if (!Array.isArray(json)) throw new CrunchError('UNEXPECTED', 'Crunch sent class history in a shape Valkyrie does not recognize.')
  const out: CrunchClass[] = []
  for (const raw of json) {
    const r = asRecord(raw)
    const startsAt = parseClassTime(r.occurrence_start_time)
    if (!startsAt) continue
    const club = asRecord(r.club)
    out.push({
      program: str(r.program_name) || 'Class',
      startsAt,
      club: str(club.name),
      status: str(r.status) || 'unknown',
      feeCents: toCents(r.fee_amount),
    })
  }
  return out
}

export function parseBilling(json: unknown): { payments: CrunchPayment[]; balanceCents?: number } {
  const r = asRecord(json)
  if (!Array.isArray(r.invoices)) throw new CrunchError('UNEXPECTED', 'Crunch sent billing history in a shape Valkyrie does not recognize.')
  const payments: CrunchPayment[] = []
  for (const raw of r.invoices) {
    const i = asRecord(raw)
    const date = parseBillingDate(i.purchase_date)
    const amountCents = toCents(i.amount)
    if (!date || amountCents === undefined) continue
    payments.push({ service: str(i.service_name) || 'Charge', amountCents, date, club: str(i.mms_club_id) || undefined })
  }
  return { payments, balanceCents: toCents(r.total_balance) }
}

/** The profile page carries the member id and weekly goal as data attributes. */
export function parseProfile(html: string): { memberId: string; workoutGoal?: number } | undefined {
  const id = /data-member-id="(\d+)"/.exec(html)?.[1] ?? /\/members\/(\d+)\//.exec(html)?.[1]
  if (!id) return undefined
  const goal = Number(/data-workout-goal="(\d+)"/.exec(html)?.[1])
  return { memberId: id, workoutGoal: goal > 0 ? goal : undefined }
}

/* ---------- Talking to the site ---------- */

class Session {
  private cookies = new Map<string, string>()

  private absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const eq = pair.indexOf('=')
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }

  /** Follows redirects by hand so cookies set along the way are kept. Returns the last response and its URL. */
  async request(url: string, init: RequestInit = {}, hops = 0): Promise<{ res: Response; url: string }> {
    let res: Response
    try {
      res = await fetch(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
          Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
          ...init.headers,
        },
      })
    } catch {
      throw new CrunchError('UNREACHABLE', "Couldn't reach Crunch. Try again in a bit.")
    }
    this.absorb(res)
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      if (hops >= 6) throw new CrunchError('UNEXPECTED', 'Crunch kept redirecting.')
      await res.arrayBuffer().catch(() => {})
      return this.request(new URL(location, url).toString(), {}, hops + 1)
    }
    return { res, url }
  }

  async json(path: string): Promise<unknown> {
    const { res } = await this.request(`${BASE}${path}`, { headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
    if (res.status === 401 || res.status === 403) throw new CrunchError('UNEXPECTED', 'Crunch stopped the request after signing in.')
    if (!res.ok) throw new CrunchError('UNEXPECTED', `Crunch answered ${res.status} for ${path.split('?')[0]}.`)
    try {
      return await res.json()
    } catch {
      throw new CrunchError('UNEXPECTED', 'Crunch sent something other than data. The site may have changed.')
    }
  }
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

const realGateway: CrunchGateway = {
  async fetchAll(email, password) {
    const session = new Session()

    const form = await session.request(`${BASE}/sign_in`)
    const formHtml = await form.res.text()
    const token = /name="authenticity_token" value="([^"]+)"/.exec(formHtml)?.[1]
    if (!token) throw new CrunchError('UNEXPECTED', "Crunch's sign-in page looks different than expected.")

    const body = new URLSearchParams({
      authenticity_token: token,
      'member[email]': email,
      'member[password]': password,
      commit: 'Login',
    })
    const signedIn = await session.request(`${BASE}/sign_in`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Referer: `${BASE}/sign_in` },
    })
    const html = await signedIn.res.text()
    const profile = parseProfile(html)
    if (!profile) {
      // Landing back on the sign-in form means the details were refused. Anything else is something new
      // (a captcha, a terms page, a changed site), which retrying will not fix.
      if (/id="new_member"|member\[password\]/.test(html)) throw new CrunchError('BAD_LOGIN', "Crunch didn't accept that email and password.")
      throw new CrunchError('UNEXPECTED', 'Crunch showed an unexpected page after sign-in (a captcha or a site change). Sign in on their site once, then try again.')
    }

    const id = profile.memberId
    const today = isoDay(new Date(Date.now() + 24 * 3600 * 1000)) // tomorrow, so today's entries are never cut off by time zones
    const range = `start_date=${HISTORY_FROM}&end_date=${today}`
    const [checkIns, classes, billing] = await Promise.all([
      session.json(`/api/internal/members/${id}/checkins`).then(parseCheckIns),
      session.json(`/api/internal/members/${id}/class_history?${range}`).then(parseClasses),
      session.json(`/api/internal/members/${id}/billing_history?${range}`).then(parseBilling),
    ])

    return {
      memberId: id,
      workoutGoal: profile.workoutGoal,
      checkIns,
      classes,
      payments: billing.payments,
      balanceCents: billing.balanceCents,
    }
  },
}

let gateway: CrunchGateway = realGateway
export const crunchGateway = () => gateway
export const setCrunchGateway = (next: CrunchGateway | undefined) => {
  gateway = next ?? realGateway
}

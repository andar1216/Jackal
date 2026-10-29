import { Router } from 'express'
import { auth } from './auth/routes.js'
import { currentUserId, requireAuth } from './auth/middleware.js'
import { integrations } from './integrations/routes.js'
import { crudRouter, requireId } from './lib/crud.js'
import { HttpError } from './lib/errors.js'
import { CalendarEvent, ManualAccount, Meal, Skill, TimeEntry, Tracker, Transaction, Workout } from './models.js'
import {
  dateString,
  eventSchema,
  manualAccountSchema,
  mealSchema,
  skillSchema,
  timeEntrySchema,
  trackerSchema,
  transactionSchema,
  workoutSchema,
} from './validation.js'

export const api = Router()

// Sign-up and sign-in are public. Everything below this line needs a signed-in user.
api.use('/auth', auth)
api.use(requireAuth)

api.use('/integrations', integrations)

/* ---------- Skills (dashboard) ---------- */

const skills = crudRouter(Skill, { schema: skillSchema, sort: { createdAt: 1 } })

// Toggle one day on or off for a skill, like clicking a day in the dashboard calendar.
// Logging a day before the skill's start date moves the start date back to that day.
skills.post('/:id/logs/:date/toggle', async (req, res) => {
  const date = dateString.parse(req.params.date)
  const skill = await Skill.findOne({ _id: requireId(req.params.id), userId: currentUserId(req) })
  if (!skill) throw new HttpError(404, 'Not found')

  if (skill.logs.includes(date)) {
    skill.logs = skill.logs.filter((d: string) => d !== date)
  } else {
    skill.logs.push(date)
    skill.logs.sort()
    if (date < skill.startDate) skill.startDate = date
  }
  await skill.save()
  res.json(skill)
})

api.use('/skills', skills)

/* ---------- Everything else is plain CRUD ---------- */

api.use('/trackers', crudRouter(Tracker, { schema: trackerSchema, sort: { startDate: 1 } }))

api.use(
  '/transactions',
  crudRouter(Transaction, {
    schema: transactionSchema,
    filters: ['type', 'category'],
    range: { field: 'date', kind: 'day' },
    sort: { date: -1, createdAt: -1 },
  }),
)

api.use('/accounts', crudRouter(ManualAccount, { schema: manualAccountSchema, sort: { createdAt: 1 } }))

api.use(
  '/meals',
  crudRouter(Meal, {
    schema: mealSchema,
    range: { field: 'date', kind: 'day' },
    sort: { date: -1, createdAt: 1 },
  }),
)

api.use(
  '/workouts',
  crudRouter(Workout, {
    schema: workoutSchema,
    filters: ['type'],
    range: { field: 'date', kind: 'day' },
    sort: { date: -1, createdAt: 1 },
  }),
)

// `from` / `to` here are full ISO timestamps, so the client can pass its own local day bounds.
api.use(
  '/time-entries',
  crudRouter(TimeEntry, {
    schema: timeEntrySchema,
    filters: ['category'],
    range: { field: 'start', kind: 'timestamp' },
    sort: { start: -1 },
  }),
)

api.use(
  '/events',
  crudRouter(CalendarEvent, {
    schema: eventSchema,
    range: { field: 'date', kind: 'day' },
    sort: { date: 1, createdAt: 1 },
  }),
)

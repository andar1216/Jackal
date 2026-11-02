import { z } from 'zod'
import { Workout } from '../models.js'
import { dateString } from '../validation.js'
import { HttpError } from '../lib/errors.js'
import { parseStrong, StrongFileError } from './strong.js'

/** What the Android app's Health Connect package name is for Strong. Its workouts also arrive in Strong exports. */
export const STRONG_PACKAGE = 'io.strongapp.strong'

export const strongBody = z.strictObject({ csv: z.string().min(1).max(6_000_000) })

/** importStrong for a request: a file that isn't a Strong export is the person's mistake (400), not a crash. */
export async function importStrongFile(userId: string, body: unknown): Promise<ImportResult> {
  const { csv } = strongBody.parse(body)
  try {
    return await importStrong(userId, csv)
  } catch (e) {
    if (e instanceof StrongFileError) throw new HttpError(400, e.message)
    throw e
  }
}

/** How many were new, how many it already had (and refreshed), and how many it left out on purpose. */
export type ImportResult = { added: number; updated: number; skipped: number }

/**
 * Files the workouts of a Strong export under this person. A workout read before is updated (so importing the same file
 * twice changes nothing). The calories a person added to it by hand stay.
 */
export async function importStrong(userId: string, csv: string): Promise<ImportResult> {
  const workouts = parseStrong(csv)
  if (workouts.length === 0) return { added: 0, updated: 0, skipped: 0 }

  const result = await Workout.bulkWrite(
    workouts.map((w) => ({
      updateOne: {
        filter: { userId, source: 'strong', externalId: w.externalId },
        update: {
          $set: { type: w.type, durationMin: w.durationMin, date: w.date, exercises: w.exercises, ...(w.unit ? { unit: w.unit } : {}) },
          $setOnInsert: { caloriesBurned: 0 },
        },
        upsert: true,
      },
    })),
  )

  // Strong may also have told Health Connect about the same workouts. The export knows more, so it replaces those.
  const days = [...new Set(workouts.map((w) => w.date))]
  await Workout.deleteMany({ userId, source: 'health-connect', app: STRONG_PACKAGE, date: { $in: days } })

  return { added: result.upsertedCount, updated: result.matchedCount, skipped: 0 }
}

/** An exercise session read from Health Connect on the phone. */
export const healthSessions = z.strictObject({
  sessions: z
    .array(
      z.strictObject({
        id: z.string().trim().min(1).max(200),
        type: z.string().trim().min(1).max(100),
        date: dateString, // the day it began, on the phone
        durationMin: z.number().int().min(1).max(24 * 60),
        app: z.string().trim().max(200).optional(),
      }),
    )
    .max(1000),
})

/** Files the exercise sessions the phone read from Health Connect. One read before is left alone. */
export async function importHealth(userId: string, body: unknown): Promise<ImportResult> {
  const { sessions } = healthSessions.parse(body)
  if (sessions.length === 0) return { added: 0, updated: 0, skipped: 0 }

  // A Strong workout already imported from its export has the sets. Its Health Connect twin would only repeat it.
  const strongDays = new Set(
    (await Workout.find({ userId, source: 'strong', date: { $in: [...new Set(sessions.map((s) => s.date))] } }, { date: 1 }).lean()).map((w) => w.date),
  )
  const wanted = sessions.filter((s) => !(s.app === STRONG_PACKAGE && strongDays.has(s.date)))

  let added = 0
  let updated = 0
  if (wanted.length > 0) {
    const result = await Workout.bulkWrite(
      wanted.map((s) => ({
        updateOne: {
          filter: { userId, source: 'health-connect', externalId: s.id },
          update: {
            $set: { type: s.type, durationMin: s.durationMin, date: s.date, ...(s.app ? { app: s.app } : {}) },
            $setOnInsert: { caloriesBurned: 0 },
          },
          upsert: true,
        },
      })),
    )
    added = result.upsertedCount
    updated = result.matchedCount
  }
  return { added, updated, skipped: sessions.length - wanted.length }
}

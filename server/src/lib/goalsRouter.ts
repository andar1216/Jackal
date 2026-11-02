import { Router, type Request, type Response } from 'express'
import { Goal } from '../models.js'
import { goalSchema, goalTaskSchema } from '../validation.js'
import { requireId } from './crud.js'
import { HttpError } from './errors.js'

/** Sets what was sent. A null takes the value away; a missing one is left alone. */
const apply = (target: { set: (path: string, value: unknown) => unknown }, changes: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) target.set(key, undefined)
    else if (value !== undefined) target.set(key, value)
  }
}

/** A step is done now, or not done any more. */
const markDone = (task: { done?: boolean | null; doneAt?: Date | null }, done: boolean) => {
  if (done && !task.done) task.doneAt = new Date()
  if (!done) task.doneAt = undefined
  task.done = done
}

/**
 * The goals and their steps. The website and the phone each mount this for their own way of knowing who is asking,
 * so both see and change the same goals. Every answer is the whole goal, steps included.
 */
export function goalsRouter(ownerOf: (req: Request, res: Response) => string) {
  const router = Router()

  const find = async (req: Request, res: Response) => {
    const goal = await Goal.findOne({ _id: requireId(String(req.params.id)), userId: ownerOf(req, res) })
    if (!goal) throw new HttpError(404, 'Not found')
    return goal
  }

  const requireDeadlineAfterStart = (goal: { get: (path: string) => unknown }) => {
    const due = goal.get('dueDate') as string | undefined
    const start = goal.get('startDate') as string | undefined
    if (due && start && due < start) {
      throw new HttpError(400, "The deadline can't be before the start date.")
    }
  }

  router.get('/', async (req, res) => {
    res.json(await Goal.find({ userId: ownerOf(req, res) }).sort({ createdAt: 1, _id: 1 }))
  })

  router.post('/', async (req, res) => {
    const { tasks = [], ...fields } = goalSchema.parse(req.body)
    const goal = new Goal({ userId: ownerOf(req, res) })
    apply(goal, fields)
    for (const { done, ...step } of tasks) {
      goal.tasks.push({})
      const task = goal.tasks[goal.tasks.length - 1]
      apply(task, step)
      markDone(task, !!done)
    }
    if (goal.status === 'done') goal.completedAt = new Date()
    requireDeadlineAfterStart(goal)
    await goal.save()
    res.status(201).json(goal)
  })

  router.patch('/:id', async (req, res) => {
    const { tasks: _tasks, ...changes } = goalSchema.partial().parse(req.body)
    const goal = await find(req, res)
    const before = goal.status
    apply(goal, changes)
    if (goal.status !== before) goal.completedAt = goal.status === 'done' ? new Date() : undefined
    requireDeadlineAfterStart(goal)
    await goal.save()
    res.json(goal)
  })

  router.delete('/:id', async (req, res) => {
    const gone = await Goal.deleteOne({ _id: requireId(String(req.params.id)), userId: ownerOf(req, res) })
    if (gone.deletedCount === 0) throw new HttpError(404, 'Not found')
    res.status(204).end()
  })

  /* ---------- Steps ---------- */

  router.post('/:id/tasks', async (req, res) => {
    const { done, ...step } = goalTaskSchema.parse(req.body)
    const goal = await find(req, res)
    if (goal.tasks.length >= 200) throw new HttpError(400, 'A goal can have up to 200 steps.')
    goal.tasks.push({})
    const task = goal.tasks[goal.tasks.length - 1]
    apply(task, step)
    markDone(task, !!done)
    await goal.save()
    res.status(201).json(goal)
  })

  router.patch('/:id/tasks/:taskId', async (req, res) => {
    const { done, ...changes } = goalTaskSchema.partial().parse(req.body)
    const goal = await find(req, res)
    const task = goal.tasks.find((t: { id: string }) => t.id === req.params.taskId)
    if (!task) throw new HttpError(404, 'Not found')
    apply(task, changes)
    if (done !== undefined) markDone(task, done)
    await goal.save()
    res.json(goal)
  })

  router.delete('/:id/tasks/:taskId', async (req, res) => {
    const goal = await find(req, res)
    const at = goal.tasks.findIndex((t: { id: string }) => t.id === req.params.taskId)
    if (at < 0) throw new HttpError(404, 'Not found')
    goal.tasks.splice(at, 1)
    await goal.save()
    res.json(goal)
  })

  return router
}
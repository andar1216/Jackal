package app.valkyrie.phone

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** One step towards a goal, with its own deadline, cost and time. Cost is in cents, time in minutes. */
data class GoalStep(
    val id: String,
    val title: String,
    val notes: String?,
    val due: String?,
    val cents: Long?,
    val minutes: Int?,
    val done: Boolean,
)

/** A goal: something to reach by a date, in steps. `status` is active, paused or done. */
data class GoalItem(
    val id: String,
    val title: String,
    val notes: String?,
    val category: String,
    val priority: String,
    val color: String,
    val start: String,
    val due: String?,
    val budgetCents: Long?,
    val budgetMinutes: Int?,
    val status: String,
    val steps: List<GoalStep>,
)

object GoalData {
    fun parse(list: JSONArray): List<GoalItem> = (0 until list.length()).map { parse(list.getJSONObject(it)) }

    fun parse(g: JSONObject): GoalItem {
        val tasks = g.optJSONArray("tasks") ?: JSONArray()
        return GoalItem(
            id = g.getString("id"),
            title = g.getString("title"),
            notes = text(g, "notes"),
            category = g.optString("category"),
            priority = g.optString("priority", "medium"),
            color = g.optString("color", "#4f46e5"),
            start = g.optString("startDate"),
            due = text(g, "dueDate"),
            budgetCents = number(g, "budgetCents"),
            budgetMinutes = number(g, "budgetMinutes")?.toInt(),
            status = g.optString("status", "active"),
            steps = (0 until tasks.length()).map { step(tasks.getJSONObject(it)) },
        )
    }

    private fun step(t: JSONObject) = GoalStep(
        id = t.getString("id"),
        title = t.getString("title"),
        notes = text(t, "notes"),
        due = text(t, "dueDate"),
        cents = number(t, "costCents"),
        minutes = number(t, "minutes")?.toInt(),
        done = t.optBoolean("done"),
    )

    private fun text(o: JSONObject, key: String): String? = if (o.has(key) && !o.isNull(key)) o.getString(key).ifBlank { null } else null
    private fun number(o: JSONObject, key: String): Long? = if (o.has(key) && !o.isNull(key)) o.getLong(key) else null
}

/** What was typed into a box: whether it made sense, and the value (null when the box was left empty). */
class Reading<T>(val ok: Boolean, val value: T?)

object GoalMath {
    fun daysUntil(day: String, today: LocalDate): Long = ChronoUnit.DAYS.between(today, LocalDate.parse(day))

    /** "Due today", "Due in 3 days", "2 days overdue". */
    fun dueText(day: String, today: LocalDate): String {
        val n = daysUntil(day, today)
        return when {
            n == 0L -> "Due today"
            n == 1L -> "Due tomorrow"
            n > 1 -> "Due in $n days"
            n == -1L -> "1 day overdue"
            else -> "${-n} days overdue"
        }
    }

    class Stats(
        val total: Int,
        val done: Int,
        val percent: Int,
        val costTotal: Long,
        val costDone: Long,
        val minutesTotal: Int,
        val minutesDone: Int,
        val overdue: Int,
        val late: Boolean,
    )

    fun stats(goal: GoalItem, today: LocalDate): Stats {
        val finished = goal.steps.filter { it.done }
        val open = goal.steps.filter { !it.done }
        val day = today.toString()
        return Stats(
            total = goal.steps.size,
            done = finished.size,
            percent = when {
                goal.status == "done" -> 100
                goal.steps.isEmpty() -> 0
                else -> Math.round(finished.size * 100f / goal.steps.size)
            },
            costTotal = goal.steps.sumOf { it.cents ?: 0L },
            costDone = finished.sumOf { it.cents ?: 0L },
            minutesTotal = goal.steps.sumOf { it.minutes ?: 0 },
            minutesDone = finished.sumOf { it.minutes ?: 0 },
            overdue = open.count { it.due != null && it.due < day },
            late = goal.status != "done" && goal.due != null && goal.due < day,
        )
    }

    /** Anything that doesn't add up, in words. */
    fun warnings(goal: GoalItem, stats: Stats): List<String> {
        val out = mutableListOf<String>()
        if (goal.budgetCents != null && stats.costTotal > goal.budgetCents) out += "The steps cost more than the budget."
        if (goal.budgetMinutes != null && stats.minutesTotal > goal.budgetMinutes) out += "The steps take more time than planned."
        val after = if (goal.due == null) 0 else goal.steps.count { !it.done && it.due != null && it.due > goal.due }
        if (after == 1) out += "A step is due after the goal's deadline." else if (after > 1) out += "$after steps are due after the goal's deadline."
        return out
    }

    /** Unfinished steps first, soonest deadline first (no deadline last), then the finished ones. */
    fun orderedSteps(steps: List<GoalStep>): List<GoalStep> = steps.sortedWith(compareBy({ it.done }, { it.due ?: "9999" }))

    /** Soonest deadline first (no deadline last). */
    fun orderedGoals(goals: List<GoalItem>): List<GoalItem> = goals.sortedBy { it.due ?: "9999" }

    private val CLOCK = Regex("^(\\d+):(\\d{1,2})$")
    private val PLAIN = Regex("^\\d+$")
    private val PARTS = Regex("^(?:(\\d+(?:\\.\\d+)?)\\s*(?:h|hr|hrs|hour|hours))?\\s*(?:(\\d+)\\s*(?:m|min|mins|minute|minutes)?)?$")

    /** "90", "45m", "1.5h", "1h 30m", "2 hr", "1:30" are minutes. Empty is none. Anything else is not ok. */
    fun parseMinutes(text: String): Reading<Int> {
        val s = text.trim().lowercase()
        if (s.isEmpty()) return Reading(true, null)
        CLOCK.find(s)?.let { return Reading(true, it.groupValues[1].toInt() * 60 + it.groupValues[2].toInt()) }
        if (PLAIN.matches(s)) return s.toIntOrNull()?.let { Reading(true, it) } ?: Reading(false, null)
        val parts = PARTS.find(s) ?: return Reading(false, null)
        val hours = parts.groups[1]?.value
        val minutes = parts.groups[2]?.value
        if (hours == null && minutes == null) return Reading(false, null)
        return Reading(true, Math.round((hours?.toDouble() ?: 0.0) * 60 + (minutes?.toDouble() ?: 0.0)).toInt())
    }

    /** 45 is "45m", 120 is "2h", 90 is "1h 30m". */
    fun formatMinutes(minutes: Int): String {
        val h = minutes / 60
        val m = minutes % 60
        return if (h == 0) "${m}m" else if (m == 0) "${h}h" else "${h}h ${m}m"
    }

    private val MONEY = Regex("^\\d+(\\.\\d{1,2})?$")

    /** "$1,200", "12.50", "80" are cents. Empty is none. Anything else is not ok. */
    fun parseDollars(text: String): Reading<Long> {
        val s = text.trim().removePrefix("$").replace(",", "")
        if (s.isEmpty()) return Reading(true, null)
        if (!MONEY.matches(s)) return Reading(false, null)
        return Reading(true, Math.round(s.toDouble() * 100))
    }

    /** What goes back into a money box when editing: 12000 is "120", 1250 is "12.50". */
    fun dollarsForInput(cents: Long?): String = when {
        cents == null -> ""
        cents % 100 == 0L -> (cents / 100).toString()
        else -> String.format(java.util.Locale.US, "%.2f", cents / 100.0)
    }

    fun minutesForInput(minutes: Int?): String = if (minutes == null) "" else formatMinutes(minutes)
}
package app.valkyrie.phone

import android.app.Activity
import android.app.AlertDialog
import android.app.DatePickerDialog
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Paint
import android.text.InputType
import android.view.View
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import org.json.JSONObject
import java.time.LocalDate

/**
 * Goals: something to reach by a date, broken into steps that each have a deadline, a cost and a time. The same goals
 * as the website's Goals page.
 */
class GoalsScreen(activity: Activity, store: Store) : Screen(activity, store) {
    override val title = "Goals"
    override val icon = R.drawable.ic_goals

    private val content = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private var goals: List<GoalItem> = emptyList()
    private var loaded = false
    private var filter = "active"
    private val collapsed = mutableSetOf<String>() // goals whose steps are folded away

    init {
        column.addView(content)
    }

    override fun show() {
        if (!loaded) content.addView(text("Loading...", color = MUTED))
        load({ server, token -> Api.goals(server, token) }) { result ->
            result.onSuccess {
                loaded = true
                goals = GoalData.parse(it)
                draw()
            }.onFailure {
                content.removeAllViews()
                content.addView(problem(it.message ?: "Couldn't load the goals."))
            }
        }
    }

    private fun draw(message: String? = null) {
        content.removeAllViews()
        if (message != null) content.addView(problem(message))
        val today = LocalDate.now()

        content.addView(summaryCard(today).board("summary"))
        content.addView(button("Add a goal", primary = true) { editGoal(null) })
        content.addView(space(8))
        content.addView(
            row(
                *listOf("active" to "Active", "paused" to "Paused", "done" to "Done", "all" to "All")
                    .map { (id, label) -> chip(label, filter == id) { filter = id; draw() } }
                    .toTypedArray(),
            ).apply { setPadding(0, 0, 0, dp(10)) },
        )

        val shown = GoalMath.orderedGoals(goals.filter { filter == "all" || it.status == filter })
        if (shown.isEmpty()) {
            content.addView(card(text(if (goals.isEmpty()) "No goals yet. Add one above." else "No goals here.", color = MUTED)))
        }
        shown.forEach { content.addView(goalCard(it, today).board("goal:${it.id}")) }
        arrange("phone-goals", content)
    }

    /* ---------- The overview ---------- */

    private fun summaryCard(today: LocalDate): View {
        val active = goals.filter { it.status == "active" }
        val open = active.flatMap { g -> g.steps.filter { !it.done } }
        val costToGo = open.sumOf { it.cents ?: 0L }
        val timeToGo = open.sumOf { it.minutes ?: 0 }
        val deadlines = active.flatMap { g ->
            listOfNotNull(g.due?.let { it to g.title }) + g.steps.filter { !it.done && it.due != null }.map { it.due!! to it.title }
        }
        val next = deadlines.minByOrNull { it.first }
        return card(
            figures("Active goals" to "${active.size}", "Steps left" to "${open.size}", "Cost to go" to FinanceMath.money(costToGo)),
            text("Time to go ${GoalMath.formatMinutes(timeToGo)}", 12f, color = MUTED),
            text(
                if (next == null) "No deadlines yet" else "Next: ${next.second}, ${GoalMath.dueText(next.first, today).lowercase()} (${next.first})",
                12f,
                color = MUTED,
            ),
        )
    }

    /* ---------- One goal ---------- */

    private fun goalCard(goal: GoalItem, today: LocalDate): View {
        val stats = GoalMath.stats(goal, today)
        val color = runCatching { Color.parseColor(goal.color) }.getOrDefault(Palette.accent)
        val folded = goal.id in collapsed
        val finished = goal.status == "done"

        val head = row(
            text(goal.title, 17f, bold = true).apply { layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) },
            text(if (folded) "\u25B8" else "\u25BE", 16f, color = MUTED),
        ).apply {
            setOnClickListener {
                if (!collapsed.remove(goal.id)) collapsed.add(goal.id)
                draw()
            }
        }
        val tags = listOfNotNull(
            goal.category.ifBlank { null },
            "${goal.priority.replaceFirstChar { it.uppercase() }} priority",
            if (goal.status == "active") null else goal.status.replaceFirstChar { it.uppercase() },
        ).joinToString(" \u00B7 ")

        val parts = mutableListOf<View>(head, text(tags, 12f, color = MUTED))
        goal.due?.let {
            val label = if (finished) "Deadline $it" else "${GoalMath.dueText(it, today)} \u00B7 $it"
            parts += text(label, 13f, color = if (stats.late) BAD else MUTED)
        }
        goal.notes?.let { parts += text(it, 13f, color = MUTED).apply { setPadding(0, dp(4), 0, 0) } }
        parts += space(8)
        parts += bar(stats.percent.toLong(), 100, color)
        parts += text("${stats.done} of ${stats.total} steps", 13f, bold = true)
        parts += text(
            "Cost ${FinanceMath.money(stats.costDone)} of ${FinanceMath.money(stats.costTotal)}" +
                (goal.budgetCents?.let { " \u00B7 budget ${FinanceMath.money(it)}" } ?: ""),
            12f,
            color = MUTED,
        )
        parts += text(
            "Time ${GoalMath.formatMinutes(stats.minutesDone)} of ${GoalMath.formatMinutes(stats.minutesTotal)}" +
                (goal.budgetMinutes?.let { " \u00B7 planned ${GoalMath.formatMinutes(it)}" } ?: ""),
            12f,
            color = MUTED,
        )
        if (stats.overdue > 0) parts += text("${stats.overdue} overdue", 12f, color = BAD)
        GoalMath.warnings(goal, stats).forEach { parts += text(it, 12f, color = BAD) }

        if (!folded) {
            parts += space(6)
            if (goal.steps.isEmpty()) parts += text("No steps yet. Add the first thing to do.", 13f, color = MUTED)
            GoalMath.orderedSteps(goal.steps).forEach { parts += stepRow(goal, it, today) }
        }

        parts += space(8)
        parts += row(
            button("Add step") { editStep(goal, null) }.share(),
            button("Edit") { editGoal(goal) }.share(),
        )
        parts += row(
            (if (goal.status == "paused") button("Resume") { setStatus(goal, "active") } else if (finished) space(0) else button("Pause") { setStatus(goal, "paused") }).share(),
            button(if (finished) "Reopen" else "Mark done", primary = !finished) { setStatus(goal, if (finished) "active" else "done") }.share(),
        )
        return card(*parts.toTypedArray())
    }

    private fun <V : View> V.share(): V {
        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        return this
    }

    private fun stepRow(goal: GoalItem, step: GoalStep, today: LocalDate): View {
        val late = !step.done && step.due != null && step.due < today.toString()
        val afterGoal = !step.done && step.due != null && goal.due != null && step.due > goal.due
        val title = text(step.title, 15f).apply {
            if (step.done) {
                paintFlags = paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
                setTextColor(MUTED)
            }
        }
        val meta = listOfNotNull(
            step.due?.let { if (step.done) it else "${GoalMath.dueText(it, today)} \u00B7 $it" },
            step.cents?.let { FinanceMath.money(it) },
            step.minutes?.let { GoalMath.formatMinutes(it) },
        ).joinToString(" \u00B7 ")
        val words = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            addView(title)
            if (meta.isNotEmpty()) addView(text(meta, 12f, color = if (late || afterGoal) BAD else MUTED))
            step.notes?.let { addView(text(it, 12f, color = MUTED)) }
            setOnClickListener { editStep(goal, step) }
        }
        val box = CheckBox(activity).apply {
            isChecked = step.done
            buttonTintList = ColorStateList.valueOf(ACCENT)
            setOnClickListener { toggleStep(goal, step, isChecked) }
        }
        return row(box, words).apply { setPadding(0, dp(4), 0, dp(4)) }
    }

    /* ---------- Changing things ---------- */

    private fun run(work: (server: String, token: String) -> Unit) {
        load({ server, token -> work(server, token) }) { result ->
            result.onSuccess { show() }.onFailure { draw(it.message) }
        }
    }

    private fun setStatus(goal: GoalItem, status: String) = run { server, token ->
        Api.updateGoal(server, token, goal.id, JSONObject().put("status", status))
    }

    /** The tick shows at once; if the server doesn't take it, the screen is read again with the reason. */
    private fun toggleStep(goal: GoalItem, step: GoalStep, done: Boolean) {
        goals = goals.map { g ->
            if (g.id != goal.id) g else g.copy(steps = g.steps.map { if (it.id == step.id) it.copy(done = done) else it })
        }
        draw()
        load({ server, token -> Api.updateGoalStep(server, token, goal.id, step.id, JSONObject().put("done", done)) }) { result ->
            result.onFailure {
                draw(it.message)
                show()
            }
        }
    }

    private fun confirmDelete(goal: GoalItem) {
        AlertDialog.Builder(activity)
            .setTitle("Delete \"${goal.title}\"?")
            .setMessage("It and its ${goal.steps.size} steps are removed for good.")
            .setPositiveButton("Delete") { _, _ -> run { server, token -> Api.deleteGoal(server, token, goal.id) } }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /* ---------- The forms ---------- */

    private fun editGoal(goal: GoalItem?) {
        val today = LocalDate.now().toString()
        val name = field("Goal, like Run a half marathon", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES).apply { setText(goal?.title ?: "") }
        val category = field("Category, like Health", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS).apply { setText(goal?.category ?: "") }
        val priority = choices(listOf("high" to "High", "medium" to "Medium", "low" to "Low"), goal?.priority ?: "medium")
        val start = dateField(goal?.start ?: today)
        val due = dateField(goal?.due)
        val budget = field("Most it should cost, in dollars", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL).apply { setText(GoalMath.dollarsForInput(goal?.budgetCents)) }
        val time = field("Time planned, like 40h or 1h 30m", InputType.TYPE_CLASS_TEXT).apply { setText(GoalMath.minutesForInput(goal?.budgetMinutes)) }
        val notes = field("Why it matters (optional)", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES).apply { setText(goal?.notes ?: "") }

        showForm(
            title = if (goal == null) "New goal" else "Edit goal",
            positive = if (goal == null) "Add" else "Save",
            views = listOf(
                name, category,
                labeled("Priority", priority.view),
                labeled("Start", start.view), labeled("Deadline", due.view),
                budget, time, notes,
            ),
            danger = goal?.let { "Delete" to { confirmDelete(it) } },
        ) {
            val title = name.text.toString().trim()
            val cost = GoalMath.parseDollars(budget.text.toString())
            val minutes = GoalMath.parseMinutes(time.text.toString())
            val from = start.value() ?: today
            val until = due.value()
            when {
                title.isEmpty() -> return@showForm "Give the goal a name."
                !cost.ok -> return@showForm "The budget should be an amount like 500 or 12.50."
                !minutes.ok -> return@showForm "The time should look like 90, 1.5h or 1h 30m."
                until != null && until < from -> return@showForm "The deadline can't be before the start date."
            }
            val body = JSONObject()
                .put("title", title)
                .put("category", category.text.toString().trim())
                .put("priority", priority.value())
                .put("startDate", from)
                .put("dueDate", until ?: JSONObject.NULL)
                .put("budgetCents", cost.value ?: JSONObject.NULL)
                .put("budgetMinutes", minutes.value ?: JSONObject.NULL)
                .put("notes", notes.text.toString().trim().ifEmpty { null } ?: JSONObject.NULL)
            if (goal == null) body.put("color", COLORS[goals.size % COLORS.size])
            run { server, token -> if (goal == null) Api.createGoal(server, token, body) else Api.updateGoal(server, token, goal.id, body) }
            null
        }
    }

    private fun editStep(goal: GoalItem, step: GoalStep?) {
        val name = field("Step, like Buy running shoes", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES).apply { setText(step?.title ?: "") }
        val due = dateField(step?.due)
        val cost = field("Cost in dollars", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL).apply { setText(GoalMath.dollarsForInput(step?.cents)) }
        val time = field("Time, like 1h 30m", InputType.TYPE_CLASS_TEXT).apply { setText(GoalMath.minutesForInput(step?.minutes)) }
        val notes = field("Notes (optional)", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES).apply { setText(step?.notes ?: "") }

        showForm(
            title = if (step == null) "New step for ${goal.title}" else "Edit step",
            positive = if (step == null) "Add" else "Save",
            views = listOf(name, labeled("Deadline", due.view), cost, time, notes),
            danger = step?.let { "Delete" to { run { server, token -> Api.deleteGoalStep(server, token, goal.id, it.id) } } },
        ) {
            val title = name.text.toString().trim()
            val money = GoalMath.parseDollars(cost.text.toString())
            val minutes = GoalMath.parseMinutes(time.text.toString())
            when {
                title.isEmpty() -> return@showForm "Say what to do."
                !money.ok -> return@showForm "The cost should be an amount like 40 or 12.50."
                !minutes.ok -> return@showForm "The time should look like 90, 1.5h or 1h 30m."
            }
            val body = JSONObject()
                .put("title", title)
                .put("dueDate", due.value() ?: JSONObject.NULL)
                .put("costCents", money.value ?: JSONObject.NULL)
                .put("minutes", minutes.value ?: JSONObject.NULL)
                .put("notes", notes.text.toString().trim().ifEmpty { null } ?: JSONObject.NULL)
            run { server, token -> if (step == null) Api.addGoalStep(server, token, goal.id, body) else Api.updateGoalStep(server, token, goal.id, step.id, body) }
            null
        }
    }

    /** A form in a dialog. `save` says what is wrong (the dialog stays open) or null when it went through. */
    private fun showForm(title: String, positive: String, views: List<View>, danger: Pair<String, () -> Unit>? = null, save: () -> String?) {
        val error = text("", 13f, color = BAD).apply { visibility = View.GONE; setPadding(0, dp(8), 0, 0) }
        val body = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), dp(0))
            views.forEach { addView(it) }
            addView(error)
        }
        val builder = AlertDialog.Builder(activity)
            .setTitle(title)
            .setView(ScrollView(activity).apply { addView(body) })
            .setPositiveButton(positive, null)
            .setNegativeButton("Cancel", null)
        if (danger != null) builder.setNeutralButton(danger.first, null)
        val dialog = builder.create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val wrong = save()
                if (wrong == null) {
                    dialog.dismiss()
                } else {
                    error.text = wrong
                    error.visibility = View.VISIBLE
                }
            }
            danger?.let { d ->
                dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener {
                    dialog.dismiss()
                    d.second()
                }
            }
        }
        dialog.show()
    }

    private fun labeled(label: String, view: View): View = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(8), 0, 0)
        addView(text(label, 12f, color = MUTED))
        addView(view)
    }

    private class Choice(val view: View, val value: () -> String)

    /** A few pills where one is picked. */
    private fun choices(options: List<Pair<String, String>>, initial: String): Choice {
        val box = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
        var chosen = initial
        fun redraw() {
            box.removeAllViews()
            options.forEach { (id, label) -> box.addView(chip(label, id == chosen) { chosen = id; redraw() }) }
        }
        redraw()
        return Choice(box) { chosen }
    }

    private class DateChoice(val view: View, val value: () -> String?)

    /** A day picked from a calendar, which can also be cleared. */
    private fun dateField(initial: String?): DateChoice {
        var picked = initial
        val shown = button("") {}
        fun redraw() {
            shown.text = picked ?: "Not set"
        }
        shown.setOnClickListener {
            val day = picked?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: LocalDate.now()
            DatePickerDialog(activity, { _, y, m, d ->
                picked = LocalDate.of(y, m + 1, d).toString()
                redraw()
            }, day.year, day.monthValue - 1, day.dayOfMonth).show()
        }
        val clear = text("Clear", 13f, color = Palette.accentText).apply {
            setPadding(dp(16), dp(8), dp(8), dp(8))
            setOnClickListener {
                picked = null
                redraw()
            }
        }
        redraw()
        return DateChoice(row(shown, clear)) { picked }
    }

    private companion object {
        val COLORS = listOf("#4f46e5", "#db2777", "#0891b2", "#16a34a", "#d97706", "#9333ea")
    }
}
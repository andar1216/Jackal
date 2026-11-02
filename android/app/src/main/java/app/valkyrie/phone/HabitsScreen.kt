package app.valkyrie.phone

import android.app.Activity
import android.app.AlertDialog
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import java.time.LocalDate

/**
 * Habits: add, tick off any recent day, see streaks, days on and off, and put habits away or delete them. The same
 * habits as the website's Habits page.
 */
class HabitsScreen(activity: Activity, store: Store) : HabitScreen(activity, store) {
    override val title = "Habits"
    override val icon = R.drawable.ic_habits

    private val content = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private var habits: List<Habit> = emptyList()
    private var loaded = false
    private var showArchived = false
    private var eliminating = false
    private val nameField: EditText = field("New habit, like Read or No soda", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES)

    init {
        column.addView(content)
    }

    override fun show() {
        if (!loaded) content.addView(text("Loading...", color = MUTED))
        val today = LocalDate.now().toString()
        load({ server, token -> Api.habits(server, token, today) }) { result ->
            result.onSuccess {
                loaded = true
                habits = HabitData.parse(it)
                draw()
            }.onFailure {
                content.removeAllViews()
                content.addView(problem(it.message ?: "Couldn't load the habits."))
            }
        }
    }

    private fun draw(message: String? = null) {
        content.removeAllViews()
        if (message != null) content.addView(problem(message))
        val today = LocalDate.now()

        content.addView(addCard())

        val active = habits.filter { !it.archived }
        if (active.isEmpty()) content.addView(card(text("No habits yet. Add one above.", color = MUTED)))
        active.forEach { content.addView(habitCard(it, today)) }

        val archived = habits.filter { it.archived }
        if (archived.isNotEmpty()) {
            content.addView(button(if (showArchived) "Hide archived (${archived.size})" else "Show archived (${archived.size})") { showArchived = !showArchived; draw() })
            if (showArchived) archived.forEach { content.addView(archivedCard(it)) }
        }
        arrange("phone-habits", content)
    }

    /* ---------- Adding ---------- */

    private fun addCard(): View {
        val kind = row(
            chip("Doing something", !eliminating) { eliminating = false; draw() },
            chip("Giving something up", eliminating) { eliminating = true; draw() },
        )
        return panel("Add a habit", nameField, space(6), kind, space(6), button("Add", primary = true) { add() }, id = "add")
    }

    private fun add() {
        val name = nameField.text.toString().trim()
        if (name.isEmpty()) return
        val giveUp = eliminating
        val today = LocalDate.now().toString()
        load({ server, token -> Api.addHabit(server, token, name, giveUp, today) }) { result ->
            result.onSuccess {
                nameField.setText("")
                show()
            }.onFailure { draw(it.message) }
        }
    }

    /* ---------- One habit ---------- */

    private fun habitCard(habit: Habit, today: LocalDate): View {
        val streak = HabitMath.streak(habit.done, today)
        val (on, off) = HabitMath.onOff(habit.done, habit.start, today)
        val head = row(
            text(habit.name, 17f, bold = true).apply { layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) },
            text(if (habit.showStreak) "$streak day streak" else "", 13f, color = MUTED),
        )
        val facts = text("Best streak ${HabitMath.best(habit.done)} days   On $on   Off $off", 12f, color = MUTED).apply { setPadding(0, dp(2), 0, dp(8)) }

        // Five weeks, ending today, in rows of seven.
        val days = HabitMath.lastDays(today, 35)
        val grid = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        days.chunked(7).forEach { week ->
            grid.addView(LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                week.forEach { day ->
                    addView(
                        LinearLayout(activity).apply {
                            gravity = Gravity.CENTER
                            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { topMargin = dp(3); bottomMargin = dp(3) }
                            addView(dayCircle(day, day.toString() in habit.done, habit.color, day == today, 36))
                            setOnClickListener { toggle(habit, day, { draw() }) { draw(it) } }
                        },
                    )
                }
            })
        }

        val actions = row(
            button("Rename") { rename(habit) },
            button("Archive") { setArchived(habit, true) },
        )
        return card(head, facts, grid, space(6), actions).board("habit:${habit.id}")
    }

    private fun archivedCard(habit: Habit): View = card(
        text(habit.name, 16f, bold = true),
        text("${habit.done.size} days done", 12f, color = MUTED),
        space(6),
        row(
            button("Restore") { setArchived(habit, false) },
            button("Delete") { confirmDelete(habit) },
        ),
    )

    private fun setArchived(habit: Habit, archived: Boolean) {
        load({ server, token -> Api.archiveHabit(server, token, habit.id, archived) }) { result ->
            result.onSuccess { show() }.onFailure { draw(it.message) }
        }
    }

    private fun rename(habit: Habit) {
        val input = field("Name", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES).apply { setText(habit.name) }
        AlertDialog.Builder(activity)
            .setTitle("Rename habit")
            .setView(input)
            .setPositiveButton("Save") { _, _ ->
                val name = input.text.toString().trim()
                if (name.isNotEmpty()) load({ server, token -> Api.renameHabit(server, token, habit.id, name) }) { result ->
                    result.onSuccess { show() }.onFailure { draw(it.message) }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun confirmDelete(habit: Habit) {
        AlertDialog.Builder(activity)
            .setTitle("Delete \"${habit.name}\"?")
            .setMessage("It and every day you logged on it are removed for good.")
            .setPositiveButton("Delete") { _, _ ->
                load({ server, token -> Api.deleteHabit(server, token, habit.id) }) { result ->
                    result.onSuccess { show() }.onFailure { draw(it.message) }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
}

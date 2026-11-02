package app.valkyrie.phone

import android.app.Activity
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject

/** The dashboard: a look at today across habits, screen time and money, and the habits to tick off. */
class DashboardScreen(activity: Activity, store: Store) : HabitScreen(activity, store) {
    override val title = "Dashboard"
    override val icon = R.drawable.ic_dashboard

    private val summary = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private val habitsBox = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private var habits: List<Habit> = emptyList()

    private val habitsToday = text("...", 20f, bold = true)
    private val screenToday = text("...", 20f, bold = true)
    private val spentMonth = text("...", 20f, bold = true)

    init {
        column.addView(summary)
        column.addView(habitsBox)
        summary.addView(
            card(
                row(
                    figure(habitsToday, "Habits today"),
                    figure(screenToday, "Screen time today"),
                    figure(spentMonth, "Spent this month"),
                ),
            ),
        )
    }

    private fun figure(value: TextView, label: String) = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        addView(value)
        addView(text(label, 12f, color = MUTED))
    }

    override fun show() {
        loadHabits()
        loadScreenTime()
        loadSpending()
    }

    /* ---------- The three figures on top ---------- */

    private fun loadScreenTime() {
        load({ server, token -> Api.screenTime(server, token) }) { result ->
            result.onSuccess { data ->
                val uses = ScreenData.uses(data)
                val today = LocalDate.now().toString()
                // Apps only: a computer's browser time is also in its websites.
                val seconds = uses.filter { it.day == today && !it.site }.sumOf { it.seconds }
                screenToday.text = if (seconds > 0) duration(seconds) else "None yet"
            }.onFailure { screenToday.text = "-" }
        }
    }

    private fun loadSpending() {
        val month = LocalDate.now().toString().take(7)
        load({ server, token -> Api.finance(server, token, month) }) { result ->
            result.onSuccess { data -> spentMonth.text = FinanceMath.money(data.optLong("spentCents")) }.onFailure { spentMonth.text = "-" }
        }
    }

    /* ---------- Habits ---------- */

    private fun loadHabits() {
        val today = LocalDate.now()
        load({ server, token -> Api.habits(server, token, today.toString()) }) { result ->
            result.onSuccess { list ->
                habits = HabitData.parse(list).filter { !it.archived }
                draw()
            }.onFailure { error ->
                habits = emptyList()
                habitsToday.text = "-"
                habitsBox.removeAllViews()
                habitsBox.addView(problem(error.message ?: "Couldn't load the habits."))
            }
        }
    }

    private fun draw() {
        val today = LocalDate.now()
        habitsBox.removeAllViews()
        habitsToday.text = "${habits.count { today.toString() in it.done }} of ${habits.size}"
        if (habits.isEmpty()) {
            habitsBox.addView(panel("Habits", text("No habits yet. Add one in Habits.", color = MUTED)))
            return
        }
        val days = HabitMath.lastDays(today)
        val views = habits.map { habit ->
            val streak = HabitMath.streak(habit.done, today)
            val title = row(
                text(habit.name, 16f, bold = true).apply { layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) },
                text(if (habit.showStreak) "$streak day streak" else "", 13f, color = MUTED),
            )
            val dayRow = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, dp(8), 0, 0)
                days.forEach { addView(dayButton(habit, it, today)) }
            }
            card(title, dayRow).board("habit:${habit.id}")
        }
        habitsBox.addView(text("Habits", 17f, bold = true).apply { setPadding(dp(4), dp(4), 0, dp(8)) })
        views.forEach { habitsBox.addView(it) }
        arrange("phone-habits", habitsBox)
    }

    /** One of the last seven days: a filled circle when done. Tapping it puts the day on or off. */
    private fun dayButton(habit: Habit, day: LocalDate, today: LocalDate): LinearLayout {
        val on = day.toString() in habit.done
        val letter = text(day.dayOfWeek.name.take(1), 11f, color = MUTED).apply { gravity = Gravity.CENTER }
        return LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            addView(letter)
            addView(dayCircle(day, on, habit.color, day == today))
            setOnClickListener { toggle(habit, day, { draw() }) { habitsBox.addView(problem(it), 0) } }
        }
    }
}
/** Reads what the server sends for Screen Time into the plain types the sums use. */
object ScreenData {
    fun uses(data: JSONObject): List<Use> {
        val usage = data.optJSONArray("usage") ?: JSONArray()
        val sites = data.optJSONArray("sites") ?: JSONArray()
        val apps = (0 until usage.length()).map { usage.getJSONObject(it) }.map {
            Use(it.optString("device"), it.optString("kind") == "phone", it.getString("day"), it.getString("app"), false, it.optLong("seconds"))
        }
        val web = (0 until sites.length()).map { sites.getJSONObject(it) }.map {
            Use(it.optString("device"), false, it.getString("day"), it.getString("site"), true, it.optLong("seconds"))
        }
        return apps + web
    }

    fun filings(data: JSONObject): List<Filing> {
        val list = data.optJSONArray("categories") ?: JSONArray()
        return (0 until list.length()).map { list.getJSONObject(it) }.map {
            Filing(
                it.optString("kind") == "site",
                it.getString("name"),
                if (it.isNull("mine")) null else it.optString("mine"),
                if (it.isNull("phone")) null else it.optString("phone"),
            )
        }
    }
}

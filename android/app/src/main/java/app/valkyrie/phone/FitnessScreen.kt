package app.valkyrie.phone

import android.app.Activity
import android.text.InputType
import android.text.format.DateUtils
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import org.json.JSONObject

/**
 * Fitness: today's workouts and calories burned (meals are read from Diet), add and remove workouts, and everything the
 * connectors bring in. Crunch's check-ins, classes and payments are shown the way the website's Fitness page shows them.
 */
class FitnessScreen(activity: Activity, store: Store) : Screen(activity, store) {
    override val title = "Fitness"
    override val icon = R.drawable.ic_fitness

    private val content = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private var meals: List<MealEntry> = emptyList()
    private var workouts: List<WorkoutEntry> = emptyList()
    private var fitness: JSONObject? = null
    private var loaded = false
    private var syncing = false
    private val expanded = mutableSetOf<String>() // the lists opened up to show everything

    private val type: EditText = field("Type (Run, Lift...)", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES)
    private val minutes: EditText = field("Minutes", InputType.TYPE_CLASS_NUMBER)
    private val burned: EditText = field("Calories burned (kcal)", InputType.TYPE_CLASS_NUMBER)

    init {
        column.addView(content)
    }

    override fun show() {
        if (!loaded) content.addView(text("Loading...", color = MUTED))
        val from = LocalDate.now().minusDays(6).toString()
        load({ server, token ->
            Triple(
                LogData.meals(Api.meals(server, token, from)),
                LogData.workouts(Api.workouts(server, token, from)),
                // The connectors are extra: if they can't be read, the rest still shows.
                runCatching { Api.fitness(server, token) }.getOrNull(),
            )
        }) { result ->
            result.onSuccess { (m, w, f) ->
                loaded = true
                meals = m
                workouts = w
                fitness = f
                draw()
            }.onFailure {
                content.removeAllViews()
                content.addView(problem(it.message ?: "Couldn't load your workouts."))
            }
        }
    }

    private fun draw(message: String? = null) {
        content.removeAllViews()
        if (message != null) content.addView(problem(message))
        val today = LocalDate.now()
        val key = today.toString()
        val todays = workouts.filter { it.day == key }
        val eaten = DietMath.eaten(meals, key)
        val out = DietMath.burned(workouts, key)
        val left = DietMath.remaining(eaten, out)

        content.addView(
            card(
                figures("Eaten (goal $CALORIE_GOAL)" to "$eaten kcal", "Burned" to "$out kcal"),
                bar(eaten.toLong(), CALORIE_GOAL.toLong(), if (eaten > CALORIE_GOAL) BAD else ACCENT),
                figures("Remaining" to "$left kcal", "Workout time" to "${todays.sumOf { it.minutes }} min"),
            ),
        )

        content.addView(panel("Add a workout", type, minutes, burned, space(6), button("Add", primary = true) { add() }))

        content.addView(
            panel(
                "Workouts today",
                *if (todays.isEmpty()) arrayOf<View>(text("No workouts logged today.", color = MUTED)) else todays.map { workoutRow(it) }.toTypedArray(),
            ),
        )

        val crunch = fitness?.optJSONObject("crunch")
        val checkIns = crunch?.optJSONArray("checkIns")?.let { list -> (0 until list.length()).map { list.getJSONObject(it) } } ?: emptyList()
        val gymDays = checkIns.groupingBy { CrunchMath.time(it.getString("at")).toLocalDate().toString() }.eachCount()

        val label = DateTimeFormatter.ofPattern("EEE, MMM d")
        content.addView(
            panel(
                "Last 7 days",
                *DietMath.lastDays(today).map { day ->
                    val spent = workouts.filter { it.day == day }
                    val time = spent.sumOf { it.minutes }
                    val names = spent.map { it.type } + if (gymDays.containsKey(day)) listOf("Gym check-in") else emptyList()
                    line(LocalDate.parse(day).format(label), if (time > 0) "$time min" else "-", names.joinToString(", "))
                }.toTypedArray(),
            ),
        )

        if (crunch != null) crunchPanels(crunch, checkIns, today)
        content.addView(connectorsPanel())
    }

    /* ---------- Crunch ---------- */

    private val dayFormat = DateTimeFormatter.ofPattern("EEE, MMM d, yyyy", Locale.US)
    private val timeFormat = DateTimeFormatter.ofPattern("h:mm a", Locale.US)

    private fun crunchPanels(crunch: JSONObject, checkIns: List<JSONObject>, today: LocalDate) {
        if (!crunch.optBoolean("connected")) return
        val status = crunchStatus(crunch)

        val goal = if (crunch.isNull("workoutGoal")) null else crunch.optInt("workoutGoal")
        val progress = CrunchMath.progress(checkIns.map { CrunchMath.time(it.getString("at")).toLocalDate() }, goal, today)
        val reached = progress.goal != null && progress.thisWeek >= progress.goal
        content.addView(
            panel(
                "Club Check-In Progress",
                text("This week" + if (progress.goal != null) " (goal ${progress.goal})" else "", 12f, color = MUTED),
                text(if (progress.goal != null) "${progress.thisWeek} / ${progress.goal}" else progress.thisWeek.toString(), 24f, bold = true, color = if (reached) GOOD else INK),
                *(if (progress.goal != null) arrayOf<View>(bar(progress.thisWeek.toLong(), progress.goal.toLong(), if (reached) GOOD else ACCENT)) else emptyArray()),
                figures("Average per week (last ${CrunchMath.AVERAGE_WEEKS})" to String.format(Locale.US, "%.2f", progress.average), "Best week" to progress.best.toString()),
                text("Check-ins can take 24 to 48 hours to show up on Crunch's side.", 12f, color = MUTED),
                status,
            ),
        )

        content.addView(
            panel(
                "Club Check-In History",
                *more("checkins", checkIns, "No check-ins yet.") {
                    val at = CrunchMath.time(it.getString("at"))
                    line(at.format(dayFormat), "", at.format(timeFormat) + it.optString("club").let { club -> if (club.isBlank()) "" else " - $club" })
                },
            ),
        )

        val classes = crunch.optJSONArray("classes")?.let { list -> (0 until list.length()).map { list.getJSONObject(it) } } ?: emptyList()
        content.addView(
            panel(
                "Class History",
                *more("classes", classes, "No classes yet.") {
                    val at = CrunchMath.time(it.getString("startsAt"))
                    val fee = if (it.isNull("feeCents") || it.optLong("feeCents") == 0L) "" else FinanceMath.money(it.optLong("feeCents")) + "  "
                    val attended = it.optString("status").equals("attended", ignoreCase = true)
                    line(
                        it.optString("program"),
                        fee + it.optString("status"),
                        at.format(dayFormat) + " - " + at.format(timeFormat) + it.optString("club").let { club -> if (club.isBlank()) "" else " - $club" },
                        rightColor = if (attended) GOOD else INK,
                    )
                },
            ),
        )

        val payments = crunch.optJSONArray("payments")?.let { list -> (0 until list.length()).map { list.getJSONObject(it) } } ?: emptyList()
        val balance = if (crunch.isNull("balanceCents")) null else crunch.optLong("balanceCents")
        content.addView(
            panel(
                "Payment History",
                *(if (balance != null) arrayOf<View>(text("Balance: ${FinanceMath.money(balance)}", 13f, color = if (balance > 0) BAD else MUTED)) else emptyArray()),
                *more("payments", payments, "No payments yet.") {
                    val cents = it.optLong("amountCents")
                    line(it.optString("service"), FinanceMath.money(cents), it.optString("date"), rightColor = if (cents < 0) GOOD else INK)
                },
            ),
        )
    }

    /** Synced when, and a button to refresh (or how to, when the data was sent from the browser). */
    private fun crunchStatus(crunch: JSONObject): View {
        val problem = crunch.optString("lastError").takeIf { !crunch.isNull("lastError") && it.isNotBlank() }
        val synced = crunch.optString("lastSyncedAt").takeIf { !crunch.isNull("lastSyncedAt") && it.isNotBlank() }
        val ago = synced?.let { "Synced " + DateUtils.getRelativeTimeSpanString(Instant.parse(it).toEpochMilli(), System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS) } ?: "Not synced yet"
        val email = crunch.optString("email").takeIf { !crunch.isNull("email") && it.isNotBlank() }
        val box = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        if (problem != null) box.addView(text(problem, 12f, color = BAD))
        box.addView(text(ago + if (email != null) " - $email" else "", 12f, color = MUTED))
        if (crunch.optBoolean("autoSync", true)) {
            box.addView(button(if (syncing) "Syncing..." else "Sync now") { syncCrunch() }.apply { isEnabled = !syncing })
        } else {
            box.addView(text("To refresh, click your \"Send to Valkyrie\" bookmark on the Crunch tab in the browser.", 12f, color = MUTED))
        }
        return box.apply { setPadding(0, dp(6), 0, 0) }
    }

    private fun syncCrunch() {
        syncing = true
        draw()
        load({ server, token -> Api.syncCrunch(server, token) }) { result ->
            syncing = false
            result.onSuccess { show() }.onFailure { draw(it.message) }
        }
    }

    /** A list that shows the first ten, with a button for the rest. */
    private fun <T> more(id: String, items: List<T>, empty: String, render: (T) -> View): Array<View> {
        if (items.isEmpty()) return arrayOf(text(empty, color = MUTED))
        val all = id in expanded
        val shown = (if (all) items else items.take(10)).map(render)
        val button = if (items.size > 10) {
            listOf(button(if (all) "Show fewer" else "Show all ${items.size}") { if (all) expanded.remove(id) else expanded.add(id); draw() })
        } else emptyList()
        return (shown + button).toTypedArray()
    }

    /* ---------- Connectors ---------- */

    private fun connectorsPanel(): View {
        val list = fitness?.optJSONArray("connectors")
            ?: return panel("Connectors", text("Couldn't read the connectors right now.", color = MUTED))
        val rows = (0 until list.length()).map { list.getJSONObject(it) }.map {
            val connected = it.optString("status") == "connected"
            val state = when {
                connected -> "Connected"
                it.optBoolean("available") -> "Not connected"
                else -> "Not available yet"
            }
            val account = it.optString("accountLabel").takeIf { label -> !it.isNull("accountLabel") && label.isNotBlank() }
            LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, dp(4), 0, dp(4))
                addView(line(it.getString("name"), state, it.optString("description"), rightColor = if (connected) GOOD else MUTED))
                if (account != null) addView(text(account, 12f, color = MUTED))
            }
        }
        return panel("Connectors", *rows.toTypedArray(), text("Connect or disconnect them from the Connectors button on the website's Fitness page.", 12f, color = MUTED))
    }

    /* ---------- Workouts ---------- */

    private fun number(field: EditText) = field.text.toString().trim().toIntOrNull()?.coerceAtLeast(0) ?: 0

    private fun add() {
        val kind = type.text.toString().trim()
        val time = number(minutes)
        if (kind.isEmpty() || time < 1) {
            draw("Type the kind of workout and how many minutes.")
            return
        }
        val kcal = number(burned)
        val today = LocalDate.now().toString()
        load({ server, token -> Api.addWorkout(server, token, kind, time, kcal, today) }) { result ->
            result.onSuccess {
                listOf(type, minutes, burned).forEach { it.setText("") }
                show()
            }.onFailure { draw(it.message) }
        }
    }

    private fun workoutRow(workout: WorkoutEntry): View = row(
        line(workout.type, "${workout.burned} kcal", "${workout.minutes} min").apply { layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) },
        text("  Remove", 13f, color = BAD).apply {
            setPadding(dp(8), dp(8), 0, dp(8))
            setOnClickListener {
                load({ server, token -> Api.deleteWorkout(server, token, workout.id) }) { result ->
                    result.onSuccess { show() }.onFailure { draw(it.message) }
                }
            }
        },
    )
}

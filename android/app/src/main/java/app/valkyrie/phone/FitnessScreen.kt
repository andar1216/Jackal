package app.valkyrie.phone

import android.app.Activity
import android.text.InputType
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/** Fitness: today's workouts and calories burned (meals are read from Diet), add and remove workouts, and the last week. */
class FitnessScreen(activity: Activity, store: Store) : Screen(activity, store) {
    override val title = "Fitness"
    override val icon = R.drawable.ic_fitness

    private val content = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private var meals: List<MealEntry> = emptyList()
    private var workouts: List<WorkoutEntry> = emptyList()
    private var loaded = false

    private val type: EditText = field("Type (Run, Lift...)", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES)
    private val minutes: EditText = field("Minutes", InputType.TYPE_CLASS_NUMBER)
    private val burned: EditText = field("Calories burned (kcal)", InputType.TYPE_CLASS_NUMBER)

    init {
        column.addView(content)
    }

    override fun show() {
        if (!loaded) content.addView(text("Loading...", color = MUTED))
        val from = LocalDate.now().minusDays(6).toString()
        load({ server, token -> LogData.meals(Api.meals(server, token, from)) to LogData.workouts(Api.workouts(server, token, from)) }) { result ->
            result.onSuccess { (m, w) ->
                loaded = true
                meals = m
                workouts = w
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

        val label = DateTimeFormatter.ofPattern("EEE, MMM d")
        content.addView(
            panel(
                "Last 7 days",
                *DietMath.lastDays(today).map { day ->
                    val spent = workouts.filter { it.day == day }
                    val time = spent.sumOf { it.minutes }
                    line(LocalDate.parse(day).format(label), if (time > 0) "$time min" else "-", if (spent.isEmpty()) "" else spent.joinToString(", ") { it.type })
                }.toTypedArray(),
            ),
        )
    }

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
